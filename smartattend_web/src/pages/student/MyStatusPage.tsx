import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { fetchMyRegStatus, type RegistrationStatus } from '@/lib/registration-status';
import { Loader2, ScanFace, CheckCircle2, Clock, XCircle, RefreshCw, X, Camera } from 'lucide-react';
import { toast } from 'sonner';

interface FaceThumb {
  id: string;
  imageData: string;
  poseLabel: string | null;
}

interface AttendanceRow {
  id: string;
  checkedInAt: string;
  status: string | null;
  confidence: number | null;
  photo: string | null;
  courseId: string;
  courseCode: string;
  courseName: string;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  on_time: { label: 'ตรงเวลา', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  late: { label: 'มาสาย', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  absent: { label: 'ขาดเรียน', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
};

const REG_META: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  pending_registration: { label: 'ยังไม่ได้ลงทะเบียนใบหน้า', cls: 'text-muted-foreground', icon: ScanFace },
  pending_training: { label: 'รอแอดมินเทรนโมเดล', cls: 'text-amber-600 dark:text-amber-400', icon: Clock },
  training_success: { label: 'เทรนสำเร็จ พร้อมใช้งาน', cls: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
  training_failed: { label: 'เทรนไม่สำเร็จ', cls: 'text-destructive', icon: XCircle },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });

export default function MyStatusPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [faceCount, setFaceCount] = useState(0);
  const [thumbs, setThumbs] = useState<FaceThumb[]>([]);
  const [regStatus, setRegStatus] = useState<RegistrationStatus | null>(null);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [countRes, thumbRes, reg, attRes] = await Promise.all([
        supabase.from('face_images').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('face_images')
          .select('id, image_data, pose_label')
          .eq('user_id', user.id).eq('kind', 'original')
          .order('captured_at', { ascending: true }).limit(8),
        fetchMyRegStatus(user.id).catch(() => null),
        supabase.from('attendance_records')
          // !inner + ordering by the referenced table's started_at (never
          // null, unlike checked_in_at which is null for absences) so
          // absent rows don't jump to the top of a descending sort.
          .select('id, checked_in_at, status, confidence, photo_data_url, session_id, class_sessions:session_id!inner(course_id, courses:course_id(code, name))')
          .eq('student_id', user.id)
          .order('started_at', { referencedTable: 'class_sessions', ascending: false }),
      ]);

      setFaceCount(countRes.count ?? 0);
      setThumbs((thumbRes.data ?? []).map(r => ({ id: r.id, imageData: r.image_data, poseLabel: r.pose_label })));
      setRegStatus(reg);

      type Raw = {
        id: string; checked_in_at: string; status: string | null; confidence: number | null;
        photo_data_url: string | null;
        class_sessions: { course_id: string; courses: { code: string; name: string } | null } | null;
      };
      setRecords(((attRes.data ?? []) as unknown as Raw[]).map(r => ({
        id: r.id,
        checkedInAt: r.checked_in_at,
        status: r.status,
        confidence: r.confidence,
        photo: r.photo_data_url,
        courseId: r.class_sessions?.course_id ?? '-',
        courseCode: r.class_sessions?.courses?.code ?? '-',
        courseName: r.class_sessions?.courses?.name ?? '-',
      })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const recentRecords = useMemo(() => records.slice(0, 5), [records]);

  const stats = useMemo(() => {
    const onTime = records.filter(r => r.status === 'on_time').length;
    const late = records.filter(r => r.status === 'late').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const total = onTime + late + absent;
    return { onTime, late, absent, total, pct: total ? Math.round(((onTime + late) / total) * 100) : 0 };
  }, [records]);

  const handleReRegister = async () => {
    if (!user?.id) return;
    if (!window.confirm('ระบบจะลบภาพใบหน้าเดิมทั้งหมดของคุณ แล้วให้ถ่ายใหม่ ต้องการดำเนินการต่อหรือไม่?')) return;
    setResetting(true);
    try {
      const { error: delErr } = await supabase.from('face_images').delete().eq('user_id', user.id);
      if (delErr) throw delErr;
      const { error: upErr } = await supabase.from('registration_statuses').upsert({
        user_id: user.id,
        student_code: user.studentId ?? null,
        student_name: user.name,
        status: 'pending_registration',
        failure_reason: null,
        trained_run_id: null,
        trained_at: null,
      }, { onConflict: 'user_id' });
      if (upErr) throw upErr;
      toast.success('ลบภาพเดิมแล้ว กรุณาถ่ายภาพใบหน้าใหม่');
      navigate('/student/face-register');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setResetting(false);
    }
  };

  const regMeta = REG_META[regStatus?.status ?? 'pending_registration'];
  const RegIcon = regMeta.icon;

  return (
    <MobileLayout title="สถานะของฉัน">
      <div className="p-4 space-y-5">
        {loading ? (
          <div className="flex flex-col items-center py-14 gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
          </div>
        ) : (
          <>
            {/* ── ส่วน ก) สถานะการลงทะเบียนใบหน้า ── */}
            <section className="bg-card rounded-2xl border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <ScanFace className="w-4 h-4 text-primary" /> สถานะการลงทะเบียนใบหน้า
                </h2>
                <button
                  onClick={() => void load()}
                  className="text-muted-foreground hover:text-foreground"
                  title="รีเฟรช"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-[11px] text-muted-foreground">ภาพใบหน้าที่บันทึกไว้</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">{faceCount}</p>
                </div>
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-[11px] text-muted-foreground">สถานะการเทรน</p>
                  <p className={`text-sm font-semibold flex items-center gap-1.5 mt-1 ${regMeta.cls}`}>
                    <RegIcon className="w-4 h-4 flex-shrink-0" /> {regMeta.label}
                  </p>
                </div>
              </div>

              {regStatus?.trainedAt && (
                <p className="text-[11px] text-muted-foreground">
                  เทรนล่าสุด: {fmt(regStatus.trainedAt)}
                </p>
              )}
              {regStatus?.status === 'training_failed' && regStatus.failureReason && (
                <p className="text-xs text-destructive bg-destructive/10 border border-destructive/25 rounded-lg p-2.5">
                  เหตุผล: {regStatus.failureReason}
                </p>
              )}

              {thumbs.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {thumbs.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setZoom(t.imageData)}
                      className="flex-shrink-0 w-16 text-center"
                    >
                      <img
                        src={t.imageData}
                        alt={t.poseLabel ?? 'face'}
                        className="w-16 h-16 rounded-lg object-cover border border-border"
                      />
                      <span className="block text-[9px] text-muted-foreground truncate mt-0.5">{t.poseLabel ?? '-'}</span>
                    </button>
                  ))}
                </div>
              )}

              {faceCount === 0 ? (
                <button
                  onClick={() => navigate('/student/face-register')}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
                >
                  <Camera className="w-4 h-4" /> ไปหน้าลงทะเบียนใบหน้า
                </button>
              ) : (
                <button
                  onClick={handleReRegister}
                  disabled={resetting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted text-foreground text-sm font-semibold disabled:opacity-50"
                >
                  {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  ลงทะเบียนใบหน้าใหม่
                </button>
              )}
            </section>

            {/* ── ส่วน ข) ประวัติการเข้าเรียน (สรุปย่อ — ดูทั้งหมดที่หน้าประวัติ) ── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-foreground">ประวัติการเข้าเรียนของฉัน</h2>
                <button onClick={() => navigate('/student/history')} className="text-xs text-primary font-medium">
                  ดูทั้งหมด
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'ตรงเวลา', value: stats.onTime, cls: 'text-emerald-600 dark:text-emerald-400' },
                  { label: 'มาสาย', value: stats.late, cls: 'text-amber-600 dark:text-amber-400' },
                  { label: 'ขาดเรียน', value: stats.absent, cls: 'text-destructive' },
                  { label: 'เข้าเรียน', value: `${stats.pct}%`, cls: 'text-primary' },
                ].map(s => (
                  <div key={s.label} className="bg-card rounded-xl border border-border p-2.5 text-center">
                    <p className={`text-lg font-bold tabular-nums ${s.cls}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              {recentRecords.length === 0 ? (
                <div className="bg-card rounded-2xl border border-border py-10 text-center">
                  <p className="text-sm text-muted-foreground">ยังไม่มีประวัติการเข้าเรียน</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentRecords.map(r => {
                    const meta = STATUS_META[r.status ?? ''] ?? { label: r.status ?? '-', cls: 'bg-muted text-muted-foreground border-border' };
                    return (
                      <div key={r.id} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
                        {r.photo ? (
                          <button onClick={() => setZoom(r.photo)} className="w-10 h-10 rounded-lg overflow-hidden border border-border shrink-0">
                            <img src={r.photo} alt="หลักฐานการเช็คชื่อ" className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-muted shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{r.courseCode} · {r.courseName}</p>
                          <p className="text-[11px] text-muted-foreground tabular-nums">{fmt(r.checkedInAt)}</p>
                        </div>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-50 bg-foreground/70 flex items-center justify-center p-6"
          onClick={() => setZoom(null)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setZoom(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
            <img src={zoom} alt="ขยาย" className="max-w-full max-h-[75vh] rounded-2xl" />
          </div>
        </div>
      )}
    </MobileLayout>
  );
}
