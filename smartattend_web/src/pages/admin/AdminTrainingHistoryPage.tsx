import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Images, Trash2, CheckCircle2, Loader2, XCircle, Eye, User as UserIcon, X, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { getRuns, getActiveModelId, type TrainingRun } from '@/lib/training-store';
import { getAllDatasets, deleteDataset, type FaceDataset } from '@/lib/dataset-store';
import { toast } from 'sonner';
import { exportRunCSV, exportRunPDF } from '@/lib/run-report';

function exportPdf(run: TrainingRun) {
  toast.promise(exportRunPDF(run), {
    loading: 'กำลังสร้างรายงาน PDF…',
    success: 'ดาวน์โหลดรายงาน PDF แล้ว',
    error: 'สร้าง PDF ไม่สำเร็จ',
  });
}

interface Row {
  studentId: string;
  studentName: string;
  studentCode?: string;
  dataset: FaceDataset | null;
  runs: TrainingRun[];
  latest?: TrainingRun;
}

export default function AdminTrainingHistoryPage() {
  const [rev, setRev] = useState(0);
  const [q, setQ] = useState('');
  const [viewer, setViewer] = useState<FaceDataset | null>(null);

  useEffect(() => {
    const bump = () => setRev(v => v + 1);
    window.addEventListener('training:update', bump);
    window.addEventListener('dataset:update', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('training:update', bump);
      window.removeEventListener('dataset:update', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  const rows: Row[] = useMemo(() => {
    void rev;
    const datasets = getAllDatasets();
    const allRuns = getRuns();
    const map = new Map<string, Row>();
    for (const d of datasets) {
      map.set(d.studentId, {
        studentId: d.studentId, studentName: d.studentName, studentCode: d.studentCode,
        dataset: d, runs: [], latest: undefined,
      });
    }
    for (const r of allRuns) {
      if (!r.studentId) continue;
      let row = map.get(r.studentId);
      if (!row) {
        row = { studentId: r.studentId, studentName: r.studentName ?? r.triggeredBy ?? r.studentId, studentCode: r.studentCode, dataset: null, runs: [] };
        map.set(r.studentId, row);
      }
      row.runs.push(r);
    }
    for (const row of map.values()) {
      row.runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      row.latest = row.runs[0];
    }
    const list = Array.from(map.values()).sort((a, b) => {
      const ad = a.dataset?.updatedAt ?? '';
      const bd = b.dataset?.updatedAt ?? '';
      return bd.localeCompare(ad);
    });
    if (!q.trim()) return list;
    const t = q.toLowerCase();
    return list.filter(r =>
      r.studentName.toLowerCase().includes(t) ||
      (r.studentCode ?? '').toLowerCase().includes(t),
    );
  }, [rev, q]);

  const activeId = getActiveModelId();

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground flex items-center gap-2">
            <History className="w-6 h-6 text-primary" /> ประวัติการเทรนของนักศึกษา
          </h1>
          <p className="text-sm text-muted-foreground">
            ติดตามผลการเทรนรายบุคคลจากการลงทะเบียนใบหน้า • คลิก "ดูรูปภาพ" เพื่อดู Dataset จริง
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาชื่อ/รหัสนักศึกษา"
            className="pl-8 pr-3 py-2 rounded-lg bg-muted text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="นักศึกษาที่มี Dataset" value={rows.filter(r => r.dataset).length.toString()} />
        <Kpi label="รวมภาพใน Dataset" value={rows.reduce((n, r) => n + (r.dataset?.totalImages ?? 0), 0).toString()} />
        <Kpi label="รวม Training Runs" value={rows.reduce((n, r) => n + r.runs.length, 0).toString()} />
        <Kpi label="Active Model" value={activeId ? getRuns().find(r => r.id === activeId)?.name ?? '—' : '—'} />
      </div>

      {rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground italic bg-card border border-dashed border-border rounded-2xl">
          ยังไม่มีนักศึกษาลงทะเบียนใบหน้า — เมื่อมีการลงทะเบียนใหม่ ระบบจะสร้าง Dataset และเทรนอัตโนมัติ
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map(row => (
            <StudentCard key={row.studentId} row={row} activeId={activeId} onView={() => row.dataset && setViewer(row.dataset)} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {viewer && <DatasetViewer ds={viewer} onClose={() => setViewer(null)} onDelete={() => { deleteDataset(viewer.studentId); setViewer(null); }} />}
      </AnimatePresence>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-xl font-bold font-display text-foreground mt-1 truncate">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: TrainingRun['status'] }) {
  const map: Record<TrainingRun['status'], { cls: string; label: string; icon: JSX.Element }> = {
    running: { cls: 'bg-primary/15 text-primary', label: 'กำลังเทรน', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { cls: 'bg-success/15 text-success', label: 'สำเร็จ', icon: <CheckCircle2 className="w-3 h-3" /> },
    stopped: { cls: 'bg-muted text-muted-foreground', label: 'หยุด', icon: <XCircle className="w-3 h-3" /> },
    failed: { cls: 'bg-destructive/15 text-destructive', label: 'ล้มเหลว', icon: <XCircle className="w-3 h-3" /> },
    queued: { cls: 'bg-secondary/15 text-secondary', label: 'เข้าคิว', icon: <Loader2 className="w-3 h-3" /> },
  };
  const s = map[status];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${s.cls}`}>{s.icon}{s.label}</span>;
}

function StudentCard({ row, activeId, onView }: { row: Row; activeId: string | null; onView: () => void }) {
  const latest = row.latest;
  const isActive = latest && latest.id === activeId;
  return (
    <div className="bg-card rounded-2xl p-4 shadow-card border border-border space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <UserIcon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{row.studentName}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{row.studentCode ?? '—'}</p>
        </div>
        {isActive && <span className="px-2 py-0.5 rounded bg-success/15 text-success text-[9px] font-bold uppercase">Active</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat k="Dataset" v={row.dataset ? `${row.dataset.totalImages} รูป` : '—'} />
        <Stat k="Runs" v={row.runs.length.toString()} />
        <Stat k="Latest Acc" v={latest?.finalAcc ? `${(latest.finalAcc * 100).toFixed(2)}%` : '—'} accent="text-success" />
      </div>

      {latest ? (
        <div className="rounded-xl border border-border bg-muted/30 p-2.5 text-[11px] space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">{latest.name}</span>
            <StatusPill status={latest.status} />
          </div>
          <div className="grid grid-cols-3 gap-1 text-muted-foreground">
            <span>Loss: <b className="text-destructive">{latest.finalLoss?.toFixed(4) ?? '—'}</b></span>
            <span>Val: <b className="text-primary">{latest.finalValAcc ? `${(latest.finalValAcc * 100).toFixed(1)}%` : '—'}</b></span>
            <span>Emb: <b className="text-foreground">{latest.embeddingValue?.toFixed(4) ?? '—'}</b></span>
          </div>
          <p className="text-[10px] text-muted-foreground">{new Date(latest.startedAt).toLocaleString()}</p>
          <div className="flex items-center gap-1.5 pt-1">
            <button onClick={() => exportRunCSV(latest)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-muted text-foreground text-[10px] font-bold hover:bg-muted/70">
              <FileSpreadsheet className="w-3 h-3" /> ส่งออก CSV
            </button>
            <button onClick={() => exportPdf(latest)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-secondary/15 text-secondary text-[10px] font-bold hover:bg-secondary/25">
              <FileDown className="w-3 h-3" /> ส่งออก PDF
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] italic text-muted-foreground">ยังไม่มี training run สำหรับนักศึกษาคนนี้</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={onView} disabled={!row.dataset}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
          <Images className="w-3.5 h-3.5" /> ดูรูปภาพ ({row.dataset?.totalImages ?? 0})
        </button>
        {row.runs.length > 1 && (
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-2 px-3 rounded-lg bg-muted list-none inline-flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" /> +{row.runs.length - 1}
            </summary>
          </details>
        )}
      </div>

      {row.runs.length > 1 && (
        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
          {row.runs.slice(1).map(r => (
            <div key={r.id} className="flex items-center justify-between gap-1.5 text-[11px] px-2 py-1 rounded bg-muted/30">
              <span className="font-medium text-foreground">{r.name}</span>
              <span className="font-mono text-success">{r.finalAcc ? `${(r.finalAcc * 100).toFixed(2)}%` : '—'}</span>
              <span className="text-muted-foreground">{new Date(r.startedAt).toLocaleDateString()}</span>
              <span className="flex items-center gap-0.5">
                <button title="ส่งออก CSV" onClick={() => exportRunCSV(r)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                  <FileSpreadsheet className="w-3 h-3" />
                </button>
                <button title="ส่งออก PDF" onClick={() => exportPdf(r)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                  <FileDown className="w-3 h-3" />
                </button>
              </span>
              <StatusPill status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, accent = 'text-foreground' }: { k: string; v: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2">
      <p className="text-[9px] text-muted-foreground uppercase font-semibold">{k}</p>
      <p className={`text-sm font-bold font-display ${accent} truncate`}>{v}</p>
    </div>
  );
}

function DatasetViewer({ ds, onClose, onDelete }: { ds: FaceDataset; onClose: () => void; onDelete: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] bg-card rounded-2xl shadow-elevated border border-border overflow-hidden flex flex-col"
      >
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-display text-foreground">{ds.studentName}</h2>
            <p className="text-xs text-muted-foreground font-mono">{ds.studentCode ?? ds.email ?? ds.studentId}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Dataset {ds.totalImages} รูป • {ds.samples.length} ท่า × (1 ต้นฉบับ + {ds.samples[0]?.augmented.length ?? 10} augmented)
              • สร้างเมื่อ {new Date(ds.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onDelete} title="ลบ Dataset" className="p-2 rounded-lg hover:bg-destructive/10 text-destructive">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 space-y-5">
          {ds.samples.map(s => (
            <div key={s.pose}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-foreground">
                  ท่า: <span className="text-primary">{s.label}</span>
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(s.capturedAt).toLocaleTimeString()} • ต้นฉบับ 1 + Augmented {s.augmented.length}
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-11 gap-1.5">
                <div className="relative">
                  <img src={s.original} alt={`${s.label}-original`} className="w-full aspect-[4/5] object-cover rounded-md border-2 border-primary" />
                  <span className="absolute bottom-0 inset-x-0 bg-primary text-primary-foreground text-[8px] font-bold text-center rounded-b-md py-0.5">
                    ต้นฉบับ
                  </span>
                </div>
                {s.augmented.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`${s.label}-aug-${i}`} className="w-full aspect-[4/5] object-cover rounded-md border border-border" />
                    <span className="absolute bottom-0 inset-x-0 bg-muted/80 text-muted-foreground text-[8px] font-medium text-center rounded-b-md py-0.5">
                      A{i + 1}
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
