import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, ChevronDown, ChevronUp, CheckCircle, XCircle, RefreshCw, Hourglass, ImageOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRegStatuses, subscribeRegStatuses, type RegistrationStatus } from '@/lib/registration-status';

interface OriginalThumb { id: string; pose: string; poseLabel: string | null; imageData: string }
export interface QueueTrainTarget { userId: string; name: string; code?: string | null }

/**
 * Admin panel: realtime queue of students in "pending_training".
 * - Shows each student's captured photos before the admin decides to train
 * - Admin can train any student in any order (per-student "เทรน" button)
 */
export default function TrainingQueuePanel({ onTrain, running }: {
  onTrain: (t: QueueTrainTarget) => void;
  running: boolean;
}) {
  const [statuses, setStatuses] = useState<RegistrationStatus[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, OriginalThumb[]>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trainingUserId, setTrainingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [sts, countRes, origRes] = await Promise.all([
        fetchAllRegStatuses(),
        supabase.from('face_images').select('id, student_id'),
        supabase.from('face_images')
          .select('id, student_id, pose, pose_label, image_data, captured_at')
          .eq('kind', 'original')
          .order('captured_at', { ascending: true }),
      ]);
      setStatuses(sts);
      if (!countRes.error) {
        const c: Record<string, number> = {};
        for (const r of countRes.data ?? []) c[r.student_id] = (c[r.student_id] ?? 0) + 1;
        setCounts(c);
      }
      if (!origRes.error) {
        const t: Record<string, OriginalThumb[]> = {};
        for (const r of origRes.data ?? []) {
          (t[r.student_id] ??= []).push({ id: r.id, pose: r.pose, poseLabel: r.pose_label, imageData: r.image_data });
        }
        setThumbs(t);
      }
    } catch (e) {
      console.warn('load training queue failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribeRegStatuses(load);
    return () => unsub();
  }, [load]);

  useEffect(() => { if (!running) setTrainingUserId(null); }, [running]);

  const pending = statuses.filter(s => s.status === 'pending_training');
  const finished = statuses
    .filter(s => s.status === 'training_success' || s.status === 'training_failed')
    .sort((a, b) => (b.trainedAt ?? b.updatedAt).localeCompare(a.trainedAt ?? a.updatedAt))
    .slice(0, 6);

  return (
    <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-bold font-display text-foreground flex items-center gap-2">
          <Hourglass className="w-4 h-4 text-secondary" /> คิวรอการเทรน (Pending Training)
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            pending.length > 0 ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground'
          }`}>
            {pending.length} คน
          </span>
        </h2>
        <button onClick={() => { setLoading(true); load(); }} title="รีเฟรช"
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && statuses.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground text-center">กำลังโหลดคิว…</p>
      ) : pending.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground italic text-center">
          ไม่มีนักศึกษารอการเทรน — เมื่อนักศึกษาถ่ายรูปลงทะเบียนเสร็จจะปรากฏที่นี่ทันที (เรียลไทม์)
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {pending.map((s, idx) => (
            <li key={s.userId} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-secondary/15 text-secondary text-[11px] font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                {thumbs[s.userId]?.[0] ? (
                  <img src={thumbs[s.userId][0].imageData} alt={s.studentName}
                    className="w-10 h-10 rounded-xl object-cover border border-border shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <ImageOff className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{s.studentName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {s.studentCode ?? '—'} • {counts[s.userId] ?? 0} รูป • ส่งเมื่อ {new Date(s.updatedAt).toLocaleString()}
                  </p>
                </div>
                <button onClick={() => setExpanded(expanded === s.userId ? null : s.userId)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground text-[11px] font-semibold shrink-0">
                  {expanded === s.userId ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  ดูรูป
                </button>
                <button
                  onClick={() => { setTrainingUserId(s.userId); onTrain({ userId: s.userId, name: s.studentName, code: s.studentCode }); }}
                  disabled={running}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-[11px] font-bold disabled:opacity-50 shrink-0">
                  <Play className="w-3.5 h-3.5" />
                  {running && trainingUserId === s.userId ? 'กำลังเทรน…' : 'เทรน'}
                </button>
              </div>

              <AnimatePresence>
                {expanded === s.userId && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    {(thumbs[s.userId]?.length ?? 0) === 0 ? (
                      <p className="mt-3 text-xs text-destructive">ไม่พบรูปในฐานข้อมูล — แจ้งนักศึกษาให้ถ่ายรูปใหม่</p>
                    ) : (
                      <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {thumbs[s.userId].map(t => (
                          <figure key={t.id} className="space-y-1">
                            <img src={t.imageData} alt={t.poseLabel ?? t.pose}
                              className="w-full aspect-square object-cover rounded-lg border border-border" />
                            <figcaption className="text-[10px] text-center text-muted-foreground">{t.poseLabel ?? t.pose}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          ))}
        </ul>
      )}

      {finished.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">ผลการเทรนล่าสุด</p>
          <div className="flex flex-wrap gap-2">
            {finished.map(s => (
              <span key={s.userId} title={s.failureReason ?? undefined}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${
                  s.status === 'training_success' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                }`}>
                {s.status === 'training_success' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {s.studentName}{s.status === 'training_failed' && s.failureReason ? ` — ${s.failureReason}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
