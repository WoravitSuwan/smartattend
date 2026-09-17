import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, CheckCircle2, XCircle, Inbox, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getRuns, getQueue, getActiveModelId, TrainingRun } from '@/lib/training-store';

/**
 * Global, always-visible training status banner for the Admin layout.
 * - Shows running run with live progress.
 * - Surfaces queue length (auto-train backlog).
 * - Emits sonner toasts when a run transitions to completed / failed / stopped.
 */
export default function TrainingStatusBanner() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<TrainingRun[]>(() => getRuns());
  const [queueLen, setQueueLen] = useState(() => getQueue().length);
  const [activeId, setActiveId] = useState<string | null>(() => getActiveModelId());
  const prevStatusRef = useRef<Record<string, TrainingRun['status']>>({});

  useEffect(() => {
    const refresh = () => {
      const next = getRuns();
      // Detect status transitions → notify
      next.forEach(r => {
        const prev = prevStatusRef.current[r.id];
        if (prev && prev !== r.status) {
          if (r.status === 'completed') {
            toast.success(`✓ ${r.name} เทรนเสร็จ — Acc ${(r.finalAcc ?? 0) * 100 < 1 ? '—' : ((r.finalAcc ?? 0) * 100).toFixed(2) + '%'}`, {
              action: { label: 'ดู', onClick: () => navigate('/admin/training') },
            });
          } else if (r.status === 'failed') {
            toast.error(`✗ ${r.name} เทรนล้มเหลว`, {
              action: { label: 'ตรวจสอบ', onClick: () => navigate('/admin/training') },
            });
          } else if (r.status === 'stopped') {
            toast.info(`⏹ ${r.name} ถูกหยุด`);
          }
        }
        prevStatusRef.current[r.id] = r.status;
      });
      setRuns(next);
      setActiveId(getActiveModelId());
      setQueueLen(getQueue().length);
    };
    // initial seed
    runs.forEach(r => { prevStatusRef.current[r.id] = r.status; });

    window.addEventListener('training:update', refresh);
    window.addEventListener('training:queue', refresh);
    window.addEventListener('storage', refresh);
    const t = setInterval(refresh, 1500); // catch in-progress metric updates
    return () => {
      window.removeEventListener('training:update', refresh);
      window.removeEventListener('training:queue', refresh);
      window.removeEventListener('storage', refresh);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = runs.find(r => r.status === 'running');
  const lastFinished = runs.find(r => r.status === 'completed' || r.status === 'failed');
  const activeRun = runs.find(r => r.id === activeId);

  // Hide banner only when there is genuinely nothing to show
  if (!running && queueLen === 0 && !lastFinished) return null;

  const progressPct = running ? Math.round((running.metrics.length / running.epochs) * 100) : 0;
  const latest = running?.metrics[running.metrics.length - 1];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        onClick={() => navigate('/admin/training')}
        className="cursor-pointer border-b border-border bg-card/70 backdrop-blur-xl px-4 py-2 flex items-center gap-3 hover:bg-card transition-colors"
      >
        {running ? (
          <>
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold text-foreground truncate">
                  กำลังเทรน {running.name}
                  {running.trigger === 'auto-registration' && running.triggeredBy && (
                    <span className="ml-1 text-muted-foreground font-normal">• auto: {running.triggeredBy}</span>
                  )}
                </p>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {running.metrics.length}/{running.epochs}
                </span>
                {latest && (
                  <span className="text-[10px] font-mono text-success">
                    acc {(latest.acc * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          </>
        ) : queueLen > 0 ? (
          <>
            <div className="w-8 h-8 rounded-lg bg-secondary/15 flex items-center justify-center shrink-0">
              <Inbox className="w-4 h-4 text-secondary" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-foreground">มี {queueLen} งานในคิวเทรน</p>
              <p className="text-[10px] text-muted-foreground">ระบบจะเริ่มเทรนอัตโนมัติเมื่อพร้อม</p>
            </div>
          </>
        ) : lastFinished ? (
          <>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              lastFinished.status === 'completed' ? 'bg-success/15' : 'bg-destructive/15'
            }`}>
              {lastFinished.status === 'completed'
                ? <CheckCircle2 className="w-4 h-4 text-success" />
                : <XCircle className="w-4 h-4 text-destructive" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-foreground truncate">
                {lastFinished.status === 'completed' ? 'เทรนล่าสุดสำเร็จ' : 'เทรนล่าสุดล้มเหลว'} — {lastFinished.name}
                {lastFinished.finalAcc !== undefined && (
                  <span className="ml-1 text-success font-mono">{(lastFinished.finalAcc * 100).toFixed(2)}%</span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Active: <span className="text-primary font-semibold">{activeRun?.name ?? '—'}</span>
              </p>
            </div>
          </>
        ) : null}
        <Brain className="w-4 h-4 text-muted-foreground hidden sm:block" />
      </motion.div>
    </AnimatePresence>
  );
}
