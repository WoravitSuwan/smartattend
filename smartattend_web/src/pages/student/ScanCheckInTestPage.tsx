import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as tf from '@tensorflow/tfjs';
import MobileLayout from '@/components/MobileLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { loadSharedModel } from '@/lib/face-model-store';
import { Loader2, CheckCircle2, Camera, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface SessionInfo {
  id: string;
  course_id: string;
  code: string;
  name: string;
  section: string | null;
}

interface ClassMapEntry {
  classIndex: number;
  studentId: string;
  studentCode: string | null;
  studentName: string | null;
}

const SCAN_DURATION_MS = 5000;
const SCAN_INTERVAL_MS = 300;
const EARLY_STOP_CONF = 0.95;
const MIN_MATCH_CONF = 0.6;
const GOOD_CONF = 0.85;
const IMG_SIZE = 64;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const digitsOnly = (s?: string | null) => (s ?? '').replace(/\D/g, '');

type ConfTier = 'low' | 'mid' | 'high';
function tierOf(conf: number, isBackground: boolean): ConfTier {
  if (isBackground || conf < MIN_MATCH_CONF) return 'low';
  if (conf < GOOD_CONF) return 'mid';
  return 'high';
}
const TIER_COLOR: Record<ConfTier, string> = {
  low: '#EF4444',
  mid: '#F59E0B',
  high: '#22C55E',
};


async function findLatestModel(): Promise<{ model: tf.LayersModel; classMap: ClassMapEntry[] } | null> {
  // 1) Shared model from the backend — works on any device (phone, Pi, other browser).
  const shared = await loadSharedModel();
  if (shared) return shared;

  // 2) Fallback: a model trained locally in this very browser.
  try {
    const models = await tf.io.listModels();
    const paths = Object.keys(models)
      .filter(p => p.includes('face-model-'))
      .sort((a, b) => (models[b].dateSaved?.valueOf() ?? 0) - (models[a].dateSaved?.valueOf() ?? 0));
    if (!paths.length) return null;
    const path = paths[0];
    const model = await tf.loadLayersModel(path);
    // Extract runId from path e.g. "indexeddb://face-model-run-123" → "run-123"
    const m = path.match(/face-model-(.+)$/);
    const runId = m?.[1] ?? '';
    let classMap: ClassMapEntry[] = [];
    try {
      const raw = localStorage.getItem(`face-model-${runId}-classmap`);
      if (raw) classMap = JSON.parse(raw) as ClassMapEntry[];
    } catch (e) {
      console.warn('classmap load failed', e);
    }
    return { model, classMap };
  } catch (e) {
    console.error('load model failed', e);
    return null;
  }
}

export default function ScanCheckInTestPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<tf.LayersModel | null>(null);
  const classMapRef = useRef<ClassMapEntry[]>([]);

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'scanning' | 'result' | 'done' | 'error' | 'mismatch' | 'already'>('loading');
  const [error, setError] = useState<string>('');
  const [bestConf, setBestConf] = useState(0);
  const [bestPhoto, setBestPhoto] = useState<string>('');
  const [mismatchMsg, setMismatchMsg] = useState<string>('');
  const [now, setNow] = useState(new Date());
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [liveConf, setLiveConf] = useState(0);
  const [liveName, setLiveName] = useState<string | null>(null);
  const [liveIsBackground, setLiveIsBackground] = useState(true);
  const [pending, setPending] = useState<{ conf: number; photo: string; idx: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [myStudentCode, setMyStudentCode] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [failStreak, setFailStreak] = useState(0);
  const [alreadyRecord, setAlreadyRecord] = useState<{ checkedInAt: string; status: string | null } | null>(null);


  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: sess, error: sErr } = await supabase
          .from('class_sessions')
          .select('id, course_id, status, courses:course_id(code, name, section)')
          .eq('id', sessionId)
          .maybeSingle();
        if (sErr || !sess) throw new Error('ไม่พบคลาสนี้ หรือคุณไม่ได้ลงทะเบียนในวิชานี้');
        if (sess.status !== 'open') throw new Error('คลาสนี้ถูกปิดไปแล้ว');
        const c = sess.courses as { code: string; name: string; section: string | null } | null;
        setSessionInfo({
          id: sess.id, course_id: sess.course_id,
          code: c?.code ?? '-', name: c?.name ?? '-', section: c?.section ?? null,
        });

        const { data: prof } = await supabase
          .from('profiles').select('student_code').eq('user_id', user.id).maybeSingle();
        if (!cancelled) setMyStudentCode(prof?.student_code ?? null);

        // Already checked in for this session → don't allow endless re-scanning.
        const { data: existing } = await supabase
          .from('attendance_records')
          .select('checked_in_at, status')
          .eq('session_id', sessionId)
          .eq('student_id', user.id)
          .maybeSingle();
        if (existing) {
          if (!cancelled) {
            setAlreadyRecord({ checkedInAt: existing.checked_in_at, status: existing.status ?? null });
            setPhase('already');
          }
          return;
        }


        const loaded = await findLatestModel();
        if (!loaded) {
          throw new Error('ยังไม่มีโมเดลใบหน้าที่พร้อมใช้งาน — การลงทะเบียนใบหน้าเป็นเพียงการเก็บรูป ต้องให้แอดมินกด "เทรนโมเดล" ในหน้า Training ก่อน (ระบบจะอัปโหลดโมเดลขึ้นเซิร์ฟเวอร์ให้ทุกเครื่องใช้ได้)');
        }
        modelRef.current = loaded.model;
        classMapRef.current = loaded.classMap;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setCameraStream(stream);
        setPhase('ready');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'เปิดกล้องไม่สำเร็จ';
        setError(msg);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [sessionId, user?.id]);

  // Keep the MediaStream in state so Android Chrome re-attaches it after React mounts the video.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cameraStream) return;

    let cancelled = false;
    setCameraReady(false);
    if (v.srcObject !== cameraStream) v.srcObject = cameraStream;

    const startPlayback = async () => {
      try {
        await v.play();
        if (!cancelled && v.videoWidth > 0 && v.videoHeight > 0) setCameraReady(true);
      } catch (playError) {
        console.warn('camera playback waiting for user gesture', playError);
      }
    };

    const handleCanPlay = () => void startPlayback();
    const handlePlaying = () => {
      if (!cancelled && v.videoWidth > 0 && v.videoHeight > 0) setCameraReady(true);
    };
    v.addEventListener('loadedmetadata', handleCanPlay);
    v.addEventListener('canplay', handleCanPlay);
    v.addEventListener('playing', handlePlaying);
    void startPlayback();

    return () => {
      cancelled = true;
      v.removeEventListener('loadedmetadata', handleCanPlay);
      v.removeEventListener('canplay', handleCanPlay);
      v.removeEventListener('playing', handlePlaying);
    };
  }, [cameraStream]);

  const captureFrame = useCallback((): { dataUrl: string; conf: number; predictedClassIndex: number } | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const model = modelRef.current;
    if (!video || !canvas || !model || video.readyState < 2) return null;

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = 320;
    displayCanvas.height = 240;
    const dctx = displayCanvas.getContext('2d')!;
    dctx.drawImage(video, 0, 0, 320, 240);
    const dataUrl = displayCanvas.toDataURL('image/jpeg', 0.85);

    const ctx = canvas.getContext('2d')!;
    canvas.width = IMG_SIZE;
    canvas.height = IMG_SIZE;
    ctx.drawImage(video, 0, 0, IMG_SIZE, IMG_SIZE);

    const { conf, predictedClassIndex } = tf.tidy(() => {
      const t = tf.browser.fromPixels(canvas).toFloat().div(255).expandDims(0) as tf.Tensor4D;
      const out = model.predict(t) as tf.Tensor;
      const arr = out.dataSync();
      let max = 0;
      let idx = 0;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] > max) { max = arr[i]; idx = i; }
      }
      return { conf: max, predictedClassIndex: idx };
    });
    return { dataUrl, conf, predictedClassIndex };
  }, []);

  const startScan = useCallback(async () => {
    setPhase('scanning');
    setBestConf(0);
    setBestPhoto('');
    setLiveConf(0);
    setLiveName(null);
    setLiveIsBackground(true);
    const start = Date.now();
    let localBest = 0;
    let localPhoto = '';
    let localIdx = -1;

    return new Promise<{ conf: number; photo: string; predictedClassIndex: number }>((resolve) => {
      const tick = () => {
        const elapsed = Date.now() - start;
        const result = captureFrame();
        if (result) {
          // Live readout uses the CURRENT frame's prediction (not the best one).
          const cur = classMapRef.current.find(c => c.classIndex === result.predictedClassIndex);
          const isBg = !cur || cur.studentId === '__background__';
          setLiveConf(result.conf);
          setLiveIsBackground(isBg);
          setLiveName(isBg ? null : (cur?.studentName ?? cur?.studentCode ?? null));

          if (result.conf > localBest) {
            localBest = result.conf;
            localPhoto = result.dataUrl;
            localIdx = result.predictedClassIndex;
            setBestConf(localBest);
            setBestPhoto(localPhoto);
          }
        }
        if (localBest >= EARLY_STOP_CONF || elapsed >= SCAN_DURATION_MS) {
          resolve({ conf: localBest, photo: localPhoto, predictedClassIndex: localIdx });
          return;
        }
        setTimeout(tick, SCAN_INTERVAL_MS);
      };
      tick();
    });
  }, [captureFrame]);


  // Sync identity check reused by the confirm button and the submit path.
  const identityOf = useCallback((predictedClassIndex: number) => {
    const entry = classMapRef.current.find(c => c.classIndex === predictedClassIndex) ?? null;
    const predictedStudentId = entry?.studentId ?? null;
    const isBackground = !predictedStudentId || predictedStudentId === '__background__';
    const idMatch = !isBackground && predictedStudentId === user?.id;
    const myCode = digitsOnly(myStudentCode);
    const codeMatch = !isBackground && myCode.length > 0 && digitsOnly(entry?.studentCode) === myCode;
    const staleModel = !isBackground && !!predictedStudentId && !UUID_RE.test(predictedStudentId);
    return { entry, predictedStudentId, isBackground, ok: idMatch || codeMatch, staleModel };
  }, [user?.id, myStudentCode]);

  const submitAttendance = useCallback(async (conf: number, photo: string, predictedClassIndex: number) => {
    if (!user?.id || !sessionId) return;

    // Identity check: confidence floor.
    if (conf < MIN_MATCH_CONF) {
      setMismatchMsg('ตรวจไม่พบใบหน้าที่ตรงกัน กรุณาลองใหม่');
      setPhase('mismatch');
      return;
    }

    // Identity check: predicted class must map to the logged-in user.
    const { entry, predictedStudentId, isBackground, ok, staleModel } = identityOf(predictedClassIndex);
    console.warn('[scan] identity check', {
      predictedStudentId,
      entryStudentCode: entry?.studentCode ?? null,
      myStudentCode,
      userId: user.id,
    });

    if (isBackground) {
      setMismatchMsg('ตรวจไม่พบใบหน้าที่ตรงกัน กรุณาลองใหม่');
      setPhase('mismatch');
      return;
    }
    if (!ok) {
      setMismatchMsg(
        staleModel
          ? 'โมเดลที่ใช้อยู่ล้าสมัย กรุณาแจ้งผู้ดูแลระบบให้เทรนโมเดลใหม่'
          : 'ใบหน้าที่ตรวจพบไม่ตรงกับบัญชีที่เข้าสู่ระบบ กรุณาสแกนด้วยตัวเอง',
      );
      setPhase('mismatch');
      return;
    }

    setSubmitting(true);
    try {
      // Status (on_time / late) is computed server-side from now() so a student's
      // device clock can never influence it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: status, error: insErr } = await (supabase as any).rpc('check_in_attendance', {
        _session_id: sessionId,
        _photo_data_url: photo,
        _confidence: conf,
      });
      if (insErr) throw insErr;

      await supabase
        .from('notifications')
        .update({ status: 'actioned' })
        .eq('user_id', user.id)
        .eq('type', 'class_started')
        .eq('related_id', sessionId);

      setPhase('done');
      toast.success(status === 'late' ? 'เข้าเรียนสำเร็จ (บันทึกเป็น มาสาย)' : 'เข้าเรียนสำเร็จ (ตรงเวลา)');
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message ?? 'บันทึกไม่สำเร็จ');
      setPhase('result');
    } finally {
      setSubmitting(false);
    }
  }, [user?.id, sessionId, identityOf, myStudentCode]);


  const runScan = async () => {
    const video = videoRef.current;
    if (!video || !cameraStream) {
      toast.error('ไม่พบสัญญาณกล้อง กรุณาอนุญาตการใช้กล้องแล้วลองใหม่');
      return;
    }
    try {
      if (video.paused) await video.play();
    } catch {
      toast.error('กล้องยังไม่พร้อม กรุณาแตะหน้าจอแล้วลองอีกครั้ง');
      return;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error('กำลังเตรียมภาพจากกล้อง กรุณาลองอีกครั้ง');
      return;
    }
    setCameraReady(true);
    setScanCount(c => c + 1);
    const { conf, photo, predictedClassIndex } = await startScan();
    if (!photo) {
      toast.error('ไม่สามารถจับภาพได้');
      setFailStreak(s => s + 1);
      setPhase('ready');
      return;
    }
    // Presentation-only counter: reuses the existing identity logic, never changes it.
    const check = identityOf(predictedClassIndex);
    const passed = conf >= MIN_MATCH_CONF && check.ok;
    setFailStreak(s => (passed ? 0 : s + 1));
    setPending({ conf, photo, idx: predictedClassIndex });
    setPhase('result');
  };

  const retryScan = () => {
    setMismatchMsg('');
    setBestConf(0);
    setBestPhoto('');
    setPending(null);
    setLiveConf(0);
    setLiveName(null);
    setLiveIsBackground(true);
    setPhase('ready');
  };

  const pendingIdentity = pending ? identityOf(pending.idx) : null;
  const pendingTier = pending ? tierOf(pending.conf, pendingIdentity?.isBackground ?? true) : 'low';
  const canConfirm = !!pending && pending.conf >= MIN_MATCH_CONF && !!pendingIdentity?.ok;
  const liveTier = tierOf(liveConf, liveIsBackground);
  const liveColor = TIER_COLOR[liveTier];
  const liveText =
    liveTier === 'low'
      ? 'ไม่พบใบหน้าที่ตรงกัน'
      : liveTier === 'mid'
        ? `กำลังตรวจสอบ… ${liveName ?? '-'} ${(liveConf * 100).toFixed(1)}%`
        : `${liveName ?? '-'} ${(liveConf * 100).toFixed(1)}%`;


  return (
    <MobileLayout title="เช็คชื่อด้วยใบหน้า">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between bg-card rounded-xl border border-border px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {now.toLocaleTimeString('th-TH')}
            </p>
          </div>
          {sessionInfo && (
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">วิชา</p>
              <p className="text-sm font-semibold text-foreground">{sessionInfo.code}</p>
            </div>
          )}
        </div>

        {scanCount > 0 && phase !== 'already' && (
          <p className="text-center text-xs text-muted-foreground">
            สแกนครั้งที่ {scanCount}
          </p>
        )}

        {failStreak >= 3 && phase !== 'done' && phase !== 'already' && (
          <div className="bg-warning/10 border border-warning/40 rounded-xl p-4 space-y-2">
            <p className="text-xs text-foreground leading-relaxed">
              หากยังสแกนไม่ผ่าน อาจเป็นเพราะโมเดลยังไม่ได้เทรนข้อมูลใบหน้าของคุณ
              กรุณาตรวจสอบสถานะที่หน้า "สถานะของฉัน" หรือติดต่ออาจารย์ผู้สอน
            </p>
            <button
              onClick={() => navigate('/student/my-status')}
              className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
            >
              ไปหน้าสถานะของฉัน
            </button>
          </div>
        )}

        {phase === 'already' && (
          <div className="bg-card rounded-3xl border border-emerald-500/40 p-6 flex flex-col items-center text-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-base font-bold text-foreground">คุณเช็คชื่อในคาบเรียนนี้ไปแล้ว</p>
            {alreadyRecord && (
              <>
                <p className="text-sm text-muted-foreground tabular-nums">
                  บันทึกเมื่อ {new Date(alreadyRecord.checkedInAt).toLocaleString('th-TH')}
                </p>
                {alreadyRecord.status && (
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    alreadyRecord.status === 'late'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  }`}>
                    {alreadyRecord.status === 'late' ? 'มาสาย' : 'ตรงเวลา'}
                  </span>
                )}
              </>
            )}
            <div className="w-full flex flex-col gap-2 pt-2">
              <button
                onClick={() => navigate('/student/my-status')}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              >
                ดูประวัติการเข้าเรียน
              </button>
              <button
                onClick={() => navigate('/student')}
                className="w-full py-2.5 rounded-lg bg-muted text-foreground text-sm font-medium"
              >
                กลับหน้าหลัก
              </button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {phase === 'loading' && (
          <div className="flex flex-col items-center py-10 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">กำลังโหลดโมเดลและกล้อง...</p>
          </div>
        )}

        {(phase === 'ready' || phase === 'scanning') && (
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="relative aspect-[4/3] bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                disablePictureInPicture
                className="w-full h-full object-cover"
              />
              {!cameraReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 text-foreground">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  <p className="text-sm font-medium">กำลังเตรียมภาพจากกล้อง...</p>
                </div>
              )}
              {/* Guide oval overlay */}
              <div className="pointer-events-none absolute inset-0 bg-black/35" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className="rounded-[50%] transition-colors duration-200"
                  style={{
                    width: '65%',
                    aspectRatio: '3 / 4',
                    border: `4px solid ${phase === 'scanning' ? liveColor : 'rgba(255,255,255,0.75)'}`,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.0)',
                  }}
                />
              </div>
              {phase === 'scanning' && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 space-y-2">
                  <div
                    className="mx-auto w-fit max-w-full px-3 py-1.5 rounded-lg bg-black/70 text-sm font-semibold text-center"
                    style={{ color: liveColor }}
                  >
                    {liveText}
                  </div>
                  <div className="h-2 rounded-full bg-white/25 overflow-hidden">
                    <div
                      className="h-full transition-all duration-200"
                      style={{ width: `${Math.round(liveConf * 100)}%`, backgroundColor: liveColor }}
                    />
                  </div>
                  <p className="text-center text-[11px] font-semibold text-white tabular-nums">
                    {(liveConf * 100).toFixed(1)}%
                  </p>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="p-4">
              <button
                onClick={runScan}
                 disabled={phase === 'scanning' || !cameraStream}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
              >
                {phase === 'scanning' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {phase === 'scanning' ? 'กำลังสแกน...' : 'เริ่มสแกนหน้า'}
              </button>
            </div>
          </div>
        )}

        {phase === 'mismatch' && (
          <div className="bg-card rounded-3xl border border-destructive/40 p-6 flex flex-col items-center text-center gap-3">
            {bestPhoto && (
              <img
                src={bestPhoto}
                alt="captured"
                className="w-32 h-32 rounded-full object-cover border-4 border-destructive/40"
              />
            )}
            <div className="flex items-center gap-2 text-destructive font-semibold">
              <AlertTriangle className="w-5 h-5" />
              ยืนยันตัวตนไม่สำเร็จ
            </div>
            <p className="text-sm text-foreground">{mismatchMsg}</p>
            <p className="text-xs text-muted-foreground">ความมั่นใจสูงสุด {(bestConf * 100).toFixed(1)}%</p>
            <button
              onClick={retryScan}
              className="mt-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              สแกนอีกครั้ง
            </button>
          </div>
        )}

        {(phase === 'result' || phase === 'done') && sessionInfo && (
          <div className="bg-card rounded-3xl border border-border p-6 flex flex-col items-center text-center gap-3">
            {bestPhoto && (
              <img
                src={bestPhoto}
                alt="captured"
                className="w-32 h-32 rounded-full object-cover"
                style={{ border: `4px solid ${TIER_COLOR[pendingTier]}` }}
              />
            )}
            <p className="text-lg font-bold text-foreground">
              {pendingIdentity?.entry?.studentName ?? user?.name ?? 'นักศึกษา'}
            </p>
            <p className="font-semibold" style={{ color: TIER_COLOR[pendingTier] }}>
              ความมั่นใจสูงสุด {(bestConf * 100).toFixed(1)}%
            </p>
            <div className="text-xs text-muted-foreground">
              {sessionInfo.code} — {sessionInfo.name}
              {sessionInfo.section ? ` (ตอน ${sessionInfo.section})` : ''}
            </div>

            {phase === 'done' ? (
              <>
                <div className="flex items-center gap-2 text-emerald-500 font-semibold pt-2">
                  <CheckCircle2 className="w-5 h-5" /> เข้าเรียนสำเร็จ
                </div>
                <button
                  onClick={() => navigate('/student')}
                  className="mt-2 px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium"
                >
                  กลับหน้าหลัก
                </button>
              </>
            ) : (
              <>
                {!canConfirm && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {pendingIdentity?.staleModel
                      ? 'โมเดลที่ใช้อยู่ล้าสมัย กรุณาแจ้งผู้ดูแลระบบให้เทรนโมเดลใหม่'
                      : 'ยังยืนยันตัวตนไม่ผ่าน กรุณาสแกนใหม่ในที่ที่มีแสงเพียงพอ'}
                  </p>
                )}
                <div className="w-full flex flex-col gap-2 pt-2">
                  <button
                    onClick={() => pending && submitAttendance(pending.conf, pending.photo, pending.idx)}
                    disabled={!canConfirm || submitting}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    ยืนยันบันทึกการเข้าเรียน
                  </button>
                  <button
                    onClick={retryScan}
                    disabled={submitting}
                    className="w-full py-2.5 rounded-lg bg-muted text-foreground text-sm font-medium disabled:opacity-50"
                  >
                    สแกนใหม่
                  </button>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </MobileLayout>
  );
}
