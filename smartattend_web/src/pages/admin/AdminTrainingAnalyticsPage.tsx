import { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, GitCompareArrows, Loader2, RefreshCw, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import {
  ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { getRuns, type TrainingMetric } from '@/lib/training-store';
import { fetchCloudRuns } from '@/lib/cloud-sync';

interface MergedRun {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  studentName?: string | null;
  finalAcc?: number | null;
  finalLoss?: number | null;
  finalValAcc?: number | null;
  embeddingValue?: number | null;
  datasetSize?: number | null;
  metrics: TrainingMetric[];
}

const ACC = 'hsl(var(--success))';
const VAL = 'hsl(var(--primary))';
const LOSS = 'hsl(var(--destructive))';
const ACC_B = 'hsl(var(--secondary))';
const LOSS_B = 'hsl(var(--muted-foreground))';

export default function AdminTrainingAnalyticsPage() {
  const [runs, setRuns] = useState<MergedRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [aId, setAId] = useState<string>('');
  const [bId, setBId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    const map = new Map<string, MergedRun>();
    for (const r of getRuns()) {
      map.set(r.id, {
        id: r.id, name: r.name, status: r.status, startedAt: r.startedAt, studentName: r.studentName,
        finalAcc: r.finalAcc, finalLoss: r.finalLoss, finalValAcc: r.finalValAcc,
        embeddingValue: r.embeddingValue, datasetSize: r.datasetSize, metrics: r.metrics ?? [],
      });
    }
    try {
      for (const c of await fetchCloudRuns()) {
        map.set(c.id, {
          id: c.id, name: c.name, status: c.status, startedAt: c.startedAt, studentName: c.studentName,
          finalAcc: c.finalAcc, finalLoss: c.finalLoss, finalValAcc: c.finalValAcc,
          embeddingValue: c.embeddingValue, datasetSize: c.datasetSize, metrics: c.metrics,
        });
      }
    } catch (e) {
      console.warn('fetch cloud runs failed', e);
    }
    const list = Array.from(map.values())
      .filter(r => r.finalAcc != null || r.metrics.length > 0)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    setRuns(list);
    // default comparison: latest vs previous
    if (list.length > 0) {
      setAId(prev => prev && list.some(r => r.id === prev) ? prev : list[list.length - 1].id);
      setBId(prev => prev && list.some(r => r.id === prev) ? prev : (list[list.length - 2]?.id ?? ''));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const bump = () => load();
    window.addEventListener('training:update', bump);
    return () => window.removeEventListener('training:update', bump);
  }, [load]);

  const timeline = useMemo(() => (runs ?? []).map(r => ({
    name: r.name,
    date: new Date(r.startedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
    acc: r.finalAcc != null ? +(r.finalAcc * 100).toFixed(2) : null,
    valAcc: r.finalValAcc != null ? +(r.finalValAcc * 100).toFixed(2) : null,
    loss: r.finalLoss != null ? +r.finalLoss.toFixed(4) : null,
  })), [runs]);

  const runA = runs?.find(r => r.id === aId) ?? null;
  const runB = runs?.find(r => r.id === bId && r.id !== aId) ?? null;

  const compareData = useMemo(() => {
    if (!runA) return [];
    const maxEp = Math.max(runA.metrics.length, runB?.metrics.length ?? 0);
    const rows: { epoch: number; aAcc?: number; aVal?: number; aLoss?: number; bAcc?: number; bVal?: number; bLoss?: number }[] = [];
    for (let i = 0; i < maxEp; i++) {
      const a = runA.metrics[i];
      const b = runB?.metrics[i];
      rows.push({
        epoch: i + 1,
        aAcc: a ? +(a.acc * 100).toFixed(2) : undefined,
        aVal: a ? +(a.valAcc * 100).toFixed(2) : undefined,
        aLoss: a ? +a.loss.toFixed(4) : undefined,
        bAcc: b ? +(b.acc * 100).toFixed(2) : undefined,
        bVal: b ? +(b.valAcc * 100).toFixed(2) : undefined,
        bLoss: b ? +b.loss.toFixed(4) : undefined,
      });
    }
    return rows;
  }, [runA, runB]);

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" /> กราฟผลการเทรน
          </h1>
          <p className="text-sm text-muted-foreground">
            Accuracy / Loss / Val Acc ของแต่ละ training run ตามเวลา • เปรียบเทียบกับรอบก่อนหน้าได้
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-xs font-semibold text-foreground hover:bg-muted/70 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} รีเฟรช
        </button>
      </div>

      {runs === null ? (
        <div className="p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดข้อมูลการเทรน…
        </div>
      ) : runs.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground italic bg-card border border-dashed border-border rounded-2xl">
          ยังไม่มีผลการเทรนในระบบ — เมื่อมีการเทรนโมเดล กราฟจะแสดงที่นี่อัตโนมัติ
        </div>
      ) : (
        <>
          {/* Timeline of all runs */}
          <div className="bg-card rounded-2xl shadow-card border border-border p-4">
            <h2 className="text-base font-bold font-display text-foreground mb-3">แนวโน้มผลเทรนตามเวลา ({runs.length} runs)</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={timeline} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
                  <YAxis yAxisId="loss" orientation="right" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="pct" type="monotone" dataKey="acc" name="Accuracy (%)" stroke={ACC} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line yAxisId="pct" type="monotone" dataKey="valAcc" name="Val Acc (%)" stroke={VAL} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line yAxisId="loss" type="monotone" dataKey="loss" name="Loss" stroke={LOSS} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Run comparison */}
          <div className="bg-card rounded-2xl shadow-card border border-border p-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-base font-bold font-display text-foreground flex items-center gap-2">
                <GitCompareArrows className="w-4 h-4 text-primary" /> เปรียบเทียบ Run
              </h2>
              <div className="flex items-center gap-2 text-xs">
                <RunSelect label="Run A" value={aId} onChange={setAId} runs={runs} />
                <span className="text-muted-foreground">vs</span>
                <RunSelect label="Run B (ก่อนหน้า)" value={bId} onChange={setBId} runs={runs.filter(r => r.id !== aId)} allowNone />
              </div>
            </div>

            {runA && (
              <div className="grid grid-cols-3 gap-3">
                <DeltaCard label="Accuracy" a={runA.finalAcc} b={runB?.finalAcc} pct higherBetter />
                <DeltaCard label="Loss" a={runA.finalLoss} b={runB?.finalLoss} higherBetter={false} />
                <DeltaCard label="Val Acc" a={runA.finalValAcc} b={runB?.finalValAcc} pct higherBetter />
              </div>
            )}

            {compareData.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase mb-2">Accuracy / Val Acc ราย Epoch</h3>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={compareData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="aAcc" name={`Acc • ${runA?.name}`} stroke={ACC} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="aVal" name={`Val • ${runA?.name}`} stroke={VAL} strokeWidth={2} dot={false} />
                        {runB && <Line type="monotone" dataKey="bAcc" name={`Acc • ${runB.name}`} stroke={ACC_B} strokeWidth={2} strokeDasharray="5 3" dot={false} />}
                        {runB && <Line type="monotone" dataKey="bVal" name={`Val • ${runB.name}`} stroke={LOSS_B} strokeWidth={2} strokeDasharray="5 3" dot={false} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase mb-2">Loss ราย Epoch</h3>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={compareData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="aLoss" name={`Loss • ${runA?.name}`} stroke={LOSS} strokeWidth={2} dot={false} />
                        {runB && <Line type="monotone" dataKey="bLoss" name={`Loss • ${runB.name}`} stroke={LOSS_B} strokeWidth={2} strokeDasharray="5 3" dot={false} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">Run ที่เลือกไม่มีข้อมูลราย Epoch</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RunSelect({ label, value, onChange, runs, allowNone }: {
  label: string; value: string; onChange: (v: string) => void; runs: MergedRun[]; allowNone?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-lg bg-muted text-foreground text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 max-w-44">
        {allowNone && <option value="">— ไม่เทียบ —</option>}
        {[...runs].reverse().map(r => (
          <option key={r.id} value={r.id}>
            {r.name}{r.studentName ? ` • ${r.studentName}` : ''} ({new Date(r.startedAt).toLocaleDateString('th-TH')})
          </option>
        ))}
      </select>
    </label>
  );
}

function DeltaCard({ label, a, b, pct, higherBetter }: {
  label: string; a?: number | null; b?: number | null; pct?: boolean; higherBetter: boolean;
}) {
  const fmt = (v?: number | null) => v == null ? '—' : pct ? `${(v * 100).toFixed(2)}%` : v.toFixed(4);
  const delta = a != null && b != null ? a - b : null;
  const good = delta != null && (higherBetter ? delta > 0 : delta < 0);
  const flat = delta != null && Math.abs(delta) < 1e-6;
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-[10px] text-muted-foreground uppercase font-semibold">{label}</p>
      <p className="text-lg font-bold font-display text-foreground">{fmt(a)}</p>
      {delta != null ? (
        <p className={`text-[11px] font-semibold flex items-center gap-1 ${flat ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive'}`}>
          {flat ? <Minus className="w-3 h-3" /> : delta > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {pct ? `${(delta * 100).toFixed(2)} จุด` : delta.toFixed(4)} เทียบกับ Run B ({fmt(b)})
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">ไม่มี Run เปรียบเทียบ</p>
      )}
    </div>
  );
}
