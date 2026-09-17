import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, CheckCircle2, XCircle, ChevronLeft, ImagePlus, Hourglass, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchMyRegStatus, getCurrentAuthUserId, upsertMyRegStatus,
  type RegistrationStatus,
} from '@/lib/registration-status';
import { augmentImage } from '@/lib/dataset-store';
import { smartCropFace, warmUpFaceDetector } from '@/lib/face-crop';

const REQUIRED_PHOTOS = 5;
const AUGMENT_PER_PHOTO = 9; // 1 original + 9 augmented = 10 per photo → 50 total
const MIN_PHOTOS = REQUIRED_PHOTOS;
const MAX_PHOTOS = REQUIRED_PHOTOS;
const MAX_SIZE_MB = 5;

interface StagedPhoto {
  id: string;
  file: File;
  /** Raw picked image, used only for the on-screen thumbnail. */
  dataUrl: string;
  /** Undistorted, face-centered crop — this is what actually gets uploaded. */
  normalizedDataUrl: string;
  faceFound: boolean;
}

/** File-upload based face registration.
 *  Student selects 3-8 photos → upload to face_images → status = pending_training.
 *  Login gate at /student/waiting keeps them out of the app until admin marks training_success. */
export default function FaceRegistrationPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let alive = true;
    warmUpFaceDetector();
    (async () => {
      const uid = await getCurrentAuthUserId();
      if (!uid) { navigate('/'); return; }
      const s = await fetchMyRegStatus(uid).catch(() => null);
      if (!alive) return;
      setStatus(s);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [navigate]);

  const readAsDataUrl = (file: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

  const onPickFiles = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    const list = Array.from(files).slice(0, room);
    const added: StagedPhoto[] = [];
    for (const f of list) {
      if (!f.type.startsWith('image/')) { toast.error(`${f.name} ไม่ใช่ไฟล์รูปภาพ`); continue; }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) { toast.error(`${f.name} เกิน ${MAX_SIZE_MB}MB`); continue; }
      try {
        const dataUrl = await readAsDataUrl(f);
        // Crop to an undistorted, face-centered square right away — this is
        // also what gets stored, so the preview is exactly what the Pi will
        // later see when it builds this student's embedding.
        const { dataUrl: normalizedDataUrl, faceFound } = await smartCropFace(dataUrl);
        if (!faceFound) {
          toast.warning(`ไม่พบใบหน้าชัดเจนใน ${f.name} — ระบบครอปกลางภาพแทน แนะนำให้ถ่ายใหม่ให้เห็นใบหน้าเต็ม ๆ`);
        }
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file: f,
          dataUrl,
          normalizedDataUrl,
          faceFound,
        });
      } catch { toast.error(`อ่านไฟล์ ${f.name} ไม่สำเร็จ`); }
    }
    if (added.length) setPhotos(p => [...p, ...added]);
  };

  const remove = (id: string) => setPhotos(p => p.filter(x => x.id !== id));

  const submit = async () => {
    if (photos.length < MIN_PHOTOS) {
      toast.error(`ต้องอัปโหลดอย่างน้อย ${MIN_PHOTOS} รูป`); return;
    }
    if (!user) { toast.error('กรุณาเข้าสู่ระบบใหม่'); return; }
    setUploading(true);
    const totalRows = photos.length * (1 + AUGMENT_PER_PHOTO); // 50
    setProgress({ done: 0, total: totalRows + 1 });
    try {
      const uid = await getCurrentAuthUserId();
      if (!uid) throw new Error('ยังไม่ได้เข้าสู่ระบบ');

      // Clear previous images for this student
      await supabase.from('face_images').delete().eq('user_id', uid);
      setProgress({ done: 1, total: totalRows + 1 });

      // Build 50 rows: for each of 5 photos → 1 normalized original + 9 augmented
      const rows: any[] = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const original = p.normalizedDataUrl;
        const augmented = await augmentImage(p.normalizedDataUrl, AUGMENT_PER_PHOTO);
        rows.push({
          user_id: uid,
          student_id: uid,
          student_code: user.studentId ?? null,
          student_name: user.name,
          pose: 'upload',
          pose_label: `รูปที่ ${i + 1} (ต้นฉบับ)`,
          kind: 'original',
          variant: 0,
          image_data: original,
          captured_at: new Date().toISOString(),
        });
        augmented.forEach((dataUrl, j) => {
          rows.push({
            user_id: uid,
            student_id: uid,
            student_code: user.studentId ?? null,
            student_name: user.name,
            pose: 'upload',
            pose_label: `รูปที่ ${i + 1} (เสริม #${j + 1})`,
            kind: 'augmented',
            variant: j + 1,
            image_data: dataUrl,
            captured_at: new Date().toISOString(),
          });
        });
      }

      // Insert in chunks so a bad row doesn't kill the whole batch
      const CHUNK = 5;
      let done = 1;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await supabase.from('face_images').insert(chunk);
        if (error) throw new Error(error.message);
        done += chunk.length;
        setProgress({ done, total: totalRows + 1 });
      }

      await upsertMyRegStatus({
        userId: uid,
        studentCode: user.studentId ?? null,
        studentName: user.name,
        status: 'pending_training',
      });

      toast.success('ส่งรูปเรียบร้อย รอแอดมินเทรนโมเดล');
      navigate('/student/waiting', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ';
      toast.error(msg);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const isFailedRetake = status?.status === 'training_failed';
  const isPendingApproval = status?.status === 'pending_training' || status?.status === 'training_success';

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/90 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/')} className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-bold font-display">ลงทะเบียนใบหน้า</h1>
          <p className="text-[11px] text-muted-foreground">แนบรูปภาพใบหน้า {MIN_PHOTOS}–{MAX_PHOTOS} รูป</p>
        </div>
      </header>

      <main className="p-4 space-y-4 max-w-2xl mx-auto">
        {isFailedRetake && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">การเทรนก่อนหน้าไม่สำเร็จ</p>
            <p className="text-muted-foreground mt-1">
              เหตุผล: {status?.failureReason ?? 'ไม่ทราบสาเหตุ'}
            </p>
            <p className="text-muted-foreground mt-1">กรุณาส่งรูปใหม่อีกครั้ง</p>
          </div>
        )}

        {isPendingApproval && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm flex items-start gap-3">
            <Hourglass className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-warning">
                {status?.status === 'training_success' ? 'ลงทะเบียนสำเร็จแล้ว' : 'รอแอดมินเทรนโมเดล'}
              </p>
              <p className="text-muted-foreground mt-1">
                หากต้องการส่งรูปใหม่ ให้อัปโหลดด้านล่างเพื่อทับข้อมูลเดิม
              </p>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ImagePlus className="w-4 h-4 text-primary" /> เลือกรูปภาพ
          </div>
          <p className="text-xs text-muted-foreground">
            แนบ {REQUIRED_PHOTOS} ท่าทาง: หน้าตรง, หันซ้าย, หันขวา, เงย, ก้ม — ระบบจะเสริมเป็น {REQUIRED_PHOTOS * (1 + AUGMENT_PER_PHOTO)} รูปอัตโนมัติสำหรับเทรน
          </p>

          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-border hover:border-primary transition-colors p-6 text-center">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => { onPickFiles(e.target.files); e.target.value = ''; }}
              disabled={uploading || photos.length >= MAX_PHOTOS}
            />
            <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">
              {photos.length >= MAX_PHOTOS ? `ครบ ${MAX_PHOTOS} รูปแล้ว` : 'กดเพื่อเลือกรูป (หรือถ่ายจากกล้อง)'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              JPG / PNG, สูงสุด {MAX_SIZE_MB}MB ต่อไฟล์ • {photos.length}/{MAX_PHOTOS} รูป
            </p>
          </label>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map(p => (
                <motion.div key={p.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  className={`relative aspect-square rounded-xl overflow-hidden border ${p.faceFound ? 'border-border' : 'border-warning'}`}>
                  <img src={p.normalizedDataUrl} alt="preview" className="w-full h-full object-cover" />
                  {!p.faceFound && (
                    <div className="absolute bottom-0 inset-x-0 bg-warning/90 text-warning-foreground text-[9px] text-center py-0.5 font-medium">
                      ไม่พบใบหน้า
                    </div>
                  )}
                  <button
                    onClick={() => remove(p.id)}
                    disabled={uploading}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-destructive"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={submit}
          disabled={uploading || photos.length < MIN_PHOTOS}
          className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              กำลังอัปโหลด {progress ? `${progress.done}/${progress.total}` : ''}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              ส่งรูป ({photos.length}/{REQUIRED_PHOTOS}) → สร้าง {REQUIRED_PHOTOS * (1 + AUGMENT_PER_PHOTO)} รูปเทรน
            </>
          )}
        </button>

        <p className="text-[11px] text-muted-foreground text-center px-4">
          หลังส่งแล้ว บัญชีของคุณจะเป็นสถานะ "รอแอดมินเทรน" — เข้าสู่ระบบใช้งานจริงได้เมื่อแอดมินอนุมัติ
        </p>
      </main>
    </div>
  );
}
