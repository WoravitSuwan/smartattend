import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Images, Loader2, RefreshCw, User as UserIcon, X, CheckCircle2, XCircle } from 'lucide-react';
import { fetchCloudStudents, fetchStudentImages, type CloudStudent, type CloudFaceImage } from '@/lib/cloud-sync';

/**
 * Admin panel: photos students captured during registration (from the cloud database)
 * shown next to their latest training values.
 */
export default function CloudStudentGallery() {
  const [students, setStudents] = useState<CloudStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<CloudStudent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStudents(await fetchCloudStudents());
    } catch (e) {
      console.warn('load cloud students failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const bump = () => load();
    window.addEventListener('training:update', bump);
    window.addEventListener('dataset:update', bump);
    return () => {
      window.removeEventListener('training:update', bump);
      window.removeEventListener('dataset:update', bump);
    };
  }, [load]);

  return (
    <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <h2 className="text-base font-bold font-display text-foreground flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" /> รูปนักศึกษาจากฐานข้อมูล ({students.length} คน)
        </h2>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted text-xs font-semibold text-foreground hover:bg-muted/70 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} รีเฟรช
        </button>
      </div>

      {loading && students.length === 0 ? (
        <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดจากฐานข้อมูล…
        </div>
      ) : students.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground italic text-center">
          ยังไม่มีรูปในฐานข้อมูล — เมื่อนักศึกษาลงทะเบียนถ่ายใบหน้า รูปทั้งหมดจะถูกบันทึกที่นี่อัตโนมัติ
        </p>
      ) : (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {students.map(s => (
            <div key={s.studentId} className="rounded-xl border border-border bg-muted/20 p-3 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UserIcon className="w-4.5 h-4.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{s.studentName}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{s.studentCode ?? '—'} • {s.totalImages} รูปในฐานข้อมูล</p>
                </div>
                {s.latestRun && <RunStatus status={s.latestRun.status} />}
              </div>

              {/* Pose original thumbnails */}
              <div className="grid grid-cols-6 gap-1.5">
                {s.originals.map(img => (
                  <div key={img.id} className="relative">
                    <img src={img.imageData} alt={img.poseLabel ?? img.pose}
                      className="w-full aspect-[4/5] object-cover rounded-md border border-border" loading="lazy" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[8px] font-medium text-center rounded-b-md py-0.5 truncate">
                      {img.poseLabel ?? img.pose}
                    </span>
                  </div>
                ))}
              </div>

              {/* Latest training values */}
              {s.latestRun ? (
                <div className="rounded-lg bg-card border border-border p-2 grid grid-cols-4 gap-1 text-center">
                  <Metric k="Accuracy" v={s.latestRun.finalAcc != null ? `${(s.latestRun.finalAcc * 100).toFixed(2)}%` : '—'} accent="text-success" />
                  <Metric k="Loss" v={s.latestRun.finalLoss != null ? s.latestRun.finalLoss.toFixed(4) : '—'} accent="text-destructive" />
                  <Metric k="Val Acc" v={s.latestRun.finalValAcc != null ? `${(s.latestRun.finalValAcc * 100).toFixed(1)}%` : '—'} accent="text-primary" />
                  <Metric k="Embedding" v={s.latestRun.embeddingValue != null ? s.latestRun.embeddingValue.toFixed(4) : '—'} accent="text-foreground" />
                </div>
              ) : (
                <p className="text-[11px] italic text-muted-foreground">ยังไม่มีผลการเทรนในฐานข้อมูล</p>
              )}

              <button onClick={() => setViewer(s)}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
                <Images className="w-3.5 h-3.5" /> ดูรูปทั้งหมด ({s.totalImages})
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {viewer && <FullGalleryModal student={viewer} onClose={() => setViewer(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Metric({ k, v, accent }: { k: string; v: string; accent: string }) {
  return (
    <div>
      <p className="text-[9px] text-muted-foreground uppercase font-semibold">{k}</p>
      <p className={`text-xs font-bold font-mono ${accent} truncate`}>{v}</p>
    </div>
  );
}

function RunStatus({ status }: { status: string }) {
  if (status === 'completed')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/15 text-success text-[9px] font-bold uppercase"><CheckCircle2 className="w-3 h-3" /> สำเร็จ</span>;
  if (status === 'running')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/15 text-primary text-[9px] font-bold uppercase"><Loader2 className="w-3 h-3 animate-spin" /> กำลังเทรน</span>;
  if (status === 'failed')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-destructive/15 text-destructive text-[9px] font-bold uppercase"><XCircle className="w-3 h-3" /> ล้มเหลว</span>;
  return <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[9px] font-bold uppercase">{status}</span>;
}

function FullGalleryModal({ student, onClose }: { student: CloudStudent; onClose: () => void }) {
  const [images, setImages] = useState<CloudFaceImage[] | null>(null);

  useEffect(() => {
    fetchStudentImages(student.studentId)
      .then(setImages)
      .catch(e => { console.warn(e); setImages([]); });
  }, [student.studentId]);

  // Group by pose, keep capture order
  const groups: { pose: string; label: string; items: CloudFaceImage[] }[] = [];
  for (const img of images ?? []) {
    let g = groups.find(x => x.pose === img.pose);
    if (!g) { g = { pose: img.pose, label: img.poseLabel ?? img.pose, items: [] }; groups.push(g); }
    g.items.push(img);
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] bg-card rounded-2xl shadow-elevated border border-border overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-display text-foreground">{student.studentName}</h2>
            <p className="text-xs text-muted-foreground font-mono">{student.studentCode ?? student.studentId}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">รูปจากฐานข้อมูล {student.totalImages} รูป</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-5">
          {images === null ? (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดรูปทั้งหมด…
            </div>
          ) : groups.map(g => (
            <div key={g.pose}>
              <h3 className="text-sm font-bold text-foreground mb-2">ท่า: <span className="text-primary">{g.label}</span></h3>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-11 gap-1.5">
                {g.items.map(img => (
                  <div key={img.id} className="relative">
                    <img src={img.imageData} alt={`${g.label}-${img.variant}`}
                      className={`w-full aspect-[4/5] object-cover rounded-md ${img.kind === 'original' ? 'border-2 border-primary' : 'border border-border'}`}
                      loading="lazy" />
                    <span className={`absolute bottom-0 inset-x-0 text-[8px] font-bold text-center rounded-b-md py-0.5 ${
                      img.kind === 'original' ? 'bg-primary text-primary-foreground' : 'bg-muted/80 text-muted-foreground'
                    }`}>
                      {img.kind === 'original' ? 'ต้นฉบับ' : `A${img.variant}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
