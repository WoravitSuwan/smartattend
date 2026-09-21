import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Square, Brain, Cpu, Activity, Terminal, History, RotateCcw, CheckCircle, Trash2, Inbox, Zap, Server, Info as InfoIcon, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { toast } from 'sonner';
import {
  TrainingRun, TrainingMetric, getRuns, upsertRun, saveRuns,
  getActiveModelId, setActiveModelId, getQueue, popQueue, nextModelName,
} from '@/lib/training-store';
import { getAllDatasets, getDataset } from '@/lib/dataset-store';
import { saveTrainingRunToCloud, countStudentImages, fetchCloudStudents, type CloudStudent } from '@/lib/cloud-sync';
import CloudStudentGallery from '@/components/CloudStudentGallery';
import TrainingQueuePanel, { type QueueTrainTarget } from '@/components/TrainingQueuePanel';
import { setRegStatusAsAdmin } from '@/lib/registration-status';
import { trainFaceModel } from '@/lib/real-trainer';
import { useNotifications } from '@/lib/notification-context';
import { useAuth } from '@/lib/auth-context';
import { logAudit } from '@/lib/audit-log';

function makeLayers(outputCount: number) {
  return [
    { name: 'Input', nodes: 8, full: 128 },
    { name: 'Hidden 1', nodes: 6, full: 64 },
    { name: 'Hidden 2', nodes: 5, full: 32 },
    { name: 'Output', nodes: Math.min(outputCount || 1, 6), full: outputCount },
  ];
}

function NeuralNetworkViz({ active, epoch, outputCount }: { active: boolean; epoch: number; outputCount: number }) {
  const LAYERS = makeLayers(outputCount);
  const width = 720, height = 360;
  const layerX = LAYERS.map((_, i) => 60 + (i * (width - 120)) / (LAYERS.length - 1));
  const positions = LAYERS.map((l, li) => {
    const gap = (height - 40) / (l.nodes + 1);
    return Array.from({ length: l.nodes }, (_, ni) => ({ x: layerX[li], y: 20 + gap * (ni + 1) }));
  });
  const pulseSeed = epoch;
  return (
    <div className="w-full bg-gradient-to-br from-card to-muted/30 rounded-2xl p-4 border border-border overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {positions.slice(0, -1).map((layer, li) =>
          layer.flatMap((a, ai) =>
            positions[li + 1].map((b, bi) => {
              const seed = (ai * 31 + bi * 7 + pulseSeed * 13) % 100;
              const opacity = 0.15 + (seed / 100) * 0.5;
              const isHot = active && seed > 70;
              return (
                <motion.line key={`${li}-${ai}-${bi}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={isHot ? 'hsl(var(--secondary))' : 'hsl(var(--primary))'}
                  strokeWidth={isHot ? 1.4 : 0.6} opacity={opacity}
                  animate={active ? { opacity: [opacity, opacity * 1.8, opacity] } : { opacity }}
                  transition={{ duration: 1.2, repeat: active ? Infinity : 0, delay: (seed % 10) * 0.05 }} />
              );
            })
          )
        )}
        {positions.map((layer, li) =>
          layer.map((p, ni) => {
            const seed = (ni * 17 + li * 11 + pulseSeed) % 100;
            const isFiring = active && seed > 40;
            return (
              <g key={`n-${li}-${ni}`}>
                <motion.circle cx={p.x} cy={p.y} r={11}
                  fill={isFiring ? 'hsl(var(--secondary))' : 'hsl(var(--primary))'}
                  animate={active ? { r: [10, 13, 10], opacity: [0.7, 1, 0.7] } : { r: 10, opacity: 0.85 }}
                  transition={{ duration: 1, repeat: active ? Infinity : 0, delay: ni * 0.08 }} />
                <circle cx={p.x} cy={p.y} r={4} fill="hsl(var(--primary-foreground))" opacity={0.9} />
              </g>
            );
          })
        )}
        {LAYERS.map((l, li) => (
          <text key={l.name} x={layerX[li]} y={height - 4} textAnchor="middle"
            fill="hsl(var(--muted-foreground))" fontSize="11" fontWeight="600">
            {l.name} ({l.full})
          </text>
        ))}
      </svg>
    </div>
  );
}

export default function AdminTrainingPage() {
  const { user } = useAuth();
  const { addNotification } = useNotifications();
  const [epochs, setEpochs] = useState(50);
  const [lr, setLr] = useState(0.001);
  const [batch, setBatch] = useState(32);
  const [running, setRunning] = useState(false);
  const [currentRunStudent, setCurrentRunStudent] = useState<{ id: string; name: string; code?: string } | null>(null);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [metrics, setMetrics] = useState<TrainingMetric[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [autoTrain, setAutoTrain] = useState(() => localStorage.getItem('training.autoMode') !== '0');

  const [runs, setRuns] = useState<TrainingRun[]>(() => getRuns());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveModelId());
  const [queueLen, setQueueLen] = useState(() => getQueue().length);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [cloudStudents, setCloudStudents] = useState<CloudStudent[]>([]);
  const [currentRunMeta, setCurrentRunMeta] = useState<{ trigger: 'manual' | 'auto-registration'; triggeredBy?: string; runId: string } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const shouldStopRef = useRef(false);
  const onFinishedRef = useRef<((res: { runId: string; status: 'completed' | 'stopped' | 'failed'; failReason?: string }) => void) | null>(null);

  const latest = metrics[metrics.length - 1];

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);
  useEffect(() => { fetchCloudStudents().then(setCloudStudents).catch(e => console.warn('fetchCloudStudents failed', e)); }, []);
  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight; }, [logs]);
  useEffect(() => { localStorage.setItem('training.autoMode', autoTrain ? '1' : '0'); }, [autoTrain]);

  // Subscribe to store updates
  useEffect(() => {
    const refresh = () => { setRuns(getRuns()); setActiveId(getActiveModelId()); setQueueLen(getQueue().length); };
    window.addEventListener('training:update', refresh);
    window.addEventListener('training:queue', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('training:update', refresh);
      window.removeEventListener('training:queue', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const startTraining = useCallback((
    trigger: 'manual' | 'auto-registration',
    triggeredBy?: string,
    student?: { id: string; name: string; code?: string } | null,
    opts?: { onFinished?: (res: { runId: string; status: 'completed' | 'stopped' | 'failed'; failReason?: string }) => void },
  ) => {
    if (runningRef.current) return;
    runningRef.current = true;
    shouldStopRef.current = false;
    onFinishedRef.current = opts?.onFinished ?? null;

    const runId = `run-${Date.now()}`;
    const name = nextModelName();
    const startedAt = new Date().toISOString();

    setCurrentRunStudent(student ?? null);
    setCurrentRunMeta({ trigger, triggeredBy, runId });
    setMetrics([]);
    setCurrentEpoch(0);
    setRunning(true);
    const t = new Date().toLocaleTimeString();
    setLogs([
      `[${t}] ▶ เริ่ม ${name} (${trigger === 'auto-registration' ? 'auto: ' + triggeredBy : 'manual'})`,
      `[${t}] epochs=${epochs}, lr=${lr}, batch=${batch}`,
      `[${t}] เทรนจริงบนเบราว์เซอร์ด้วย TensorFlow.js (CNN)`,
    ]);

    // Insert "running" placeholder run.
    const runningRun: TrainingRun = {
      id: runId, name, startedAt, status: 'running',
      epochs, learningRate: lr, batchSize: batch,
      metrics: [], datasetClasses: [], datasetSize: 0,
      trigger, triggeredBy,
      studentId: student?.id, studentCode: student?.code, studentName: student?.name,
    };
    upsertRun(runningRun);
    saveTrainingRunToCloud(runningRun).catch(e => console.warn('cloud sync (running) failed', e));

    // Fire async training — real model.fit under the hood.
    (async () => {
      const localMetrics: TrainingMetric[] = [];
      const res = await trainFaceModel({
        // If auto-registration for a specific student, still train the whole population so
        // the shared classifier learns the new class alongside existing ones.
        studentIds: undefined,
        epochs, batchSize: batch, learningRate: lr,
        runId,
        onLog: (line) => setLogs(prev => [...prev, line]),
        onEpoch: (m) => {
          const tm: TrainingMetric = { epoch: m.epoch, acc: m.acc, loss: m.loss, valAcc: m.valAcc, valLoss: m.valLoss };
          localMetrics.push(tm);
          setMetrics([...localMetrics]);
          setCurrentEpoch(m.epoch);
        },
        shouldStop: () => shouldStopRef.current,
      });

      const finishedAt = new Date().toISOString();
      runningRef.current = false;
      setRunning(false);

      const finalRun: TrainingRun = {
        id: runId, name, startedAt, finishedAt,
        status: res.status,
        epochs, learningRate: lr, batchSize: batch,
        finalAcc: res.finalAcc, finalLoss: res.finalLoss, finalValAcc: res.finalValAcc,
        metrics: localMetrics,
        datasetClasses: res.classes.map(c => c.studentId),
        datasetSize: res.numImages,
        trigger, triggeredBy,
        studentId: student?.id, studentCode: student?.code, studentName: student?.name,
        embeddingValue: res.embeddingNorm != null ? Math.round(res.embeddingNorm * 10000) / 10000 : undefined,
        notes: res.error,
      };
      upsertRun(finalRun);
      saveTrainingRunToCloud(finalRun).catch(e => console.warn('cloud sync (finished) failed', e));

      const doneT = new Date().toLocaleTimeString();
      if (res.status === 'completed') {
        setActiveModelId(runId);
        setLogs(prev => [...prev, `[${doneT}] ✓ ${name} เสร็จ — Acc ${(res.finalAcc * 100).toFixed(2)}% • Val ${(res.finalValAcc * 100).toFixed(2)}% • ตั้งเป็น Active Model`]);
        toast.success(`${name} เทรนสำเร็จ • Acc ${(res.finalAcc * 100).toFixed(2)}%`);
      } else if (res.status === 'stopped') {
        setLogs(prev => [...prev, `[${doneT}] ⏹ หยุดการเทรนก่อนเสร็จ`]);
        toast.info('หยุดการเทรนแล้ว');
      } else {
        setLogs(prev => [...prev, `[${doneT}] ✗ เทรนไม่สำเร็จ — ${res.error ?? 'unknown'}`]);
        toast.error(`เทรนไม่สำเร็จ: ${res.error ?? 'unknown'}`);
        if (user?.id) {
          addNotification({
            userId: user.id,
            type: 'training_failed',
            title: 'เทรนโมเดลล้มเหลว',
            message: `${name}${student ? ` (${student.name})` : ''} — ${res.error ?? 'unknown'}`,
            link: '/admin/training',
          });
        }
        logAudit({
          action: 'training.failed', target: 'training_run', targetId: runId,
          detail: `${name} เทรนไม่สำเร็จ`, after: { error: res.error ?? 'unknown' },
        }).catch(() => {});
      }

      setCurrentRunMeta(null);
      setCurrentRunStudent(null);
      const cb = onFinishedRef.current;
      onFinishedRef.current = null;
      cb?.({ runId, status: res.status, failReason: res.error });
    })();
  }, [epochs, lr, batch]);

  // Auto-process queue
  useEffect(() => {
    if (!autoTrain || runningRef.current) return;
    const item = getQueue()[0];
    if (item) {
      // small debounce
      const tid = setTimeout(() => {
        const next = popQueue();
        if (next) {
          toast.info(`ตรวจพบข้อมูลใหม่: ${next.studentName} — เริ่มเทรนอัตโนมัติ`);
          startTraining('auto-registration', next.studentName, { id: next.studentId, name: next.studentName, code: next.studentCode });
        }
      }, 600);
      return () => clearTimeout(tid);
    }
  }, [queueLen, autoTrain, startTraining]);

  // Train a specific student from the cloud "pending training" queue.
  // Result (success/fail + reason) is written back to registration_statuses,
  // which updates the student's screen in realtime.
  const handleTrainFromQueue = useCallback(async (t: QueueTrainTarget) => {
    if (runningRef.current) { toast.error('มีการเทรนกำลังทำงานอยู่ — รอให้เสร็จก่อน'); return; }
    let imgCount = 0;
    try {
      imgCount = await countStudentImages(t.userId);
    } catch {
      toast.error('อ่านจำนวนรูปจากฐานข้อมูลไม่สำเร็จ');
      return;
    }
    if (imgCount < 5) {
      try {
        await setRegStatusAsAdmin(t.userId, 'training_failed',
          `จำนวนรูปไม่เพียงพอ (${imgCount} รูป — ต้องมีอย่างน้อย 5 รูป) กรุณาถ่ายรูปลงทะเบียนใหม่`,
          null, { code: t.code, name: t.name });
      } catch (e) { console.warn('set status failed', e); }
      toast.error(`เทรน ${t.name} ไม่สำเร็จ — จำนวนรูปไม่เพียงพอ (${imgCount} รูป)`);
      return;
    }
    toast.info(`เริ่มเทรนโมเดลของ ${t.name} (${imgCount} รูป)`);
    startTraining('manual', t.name, { id: t.userId, name: t.name, code: t.code ?? undefined }, {
      onFinished: async ({ runId, status, failReason }) => {
        const success = status === 'completed';
        try {
          await setRegStatusAsAdmin(
            t.userId,
            success ? 'training_success' : 'training_failed',
            success
              ? null
              : (failReason
                ?? (status === 'stopped'
                  ? 'การเทรนถูกหยุดก่อนเสร็จสิ้น — กรุณารอแอดมินเทรนใหม่'
                  : 'การเทรนล้มเหลว — กรุณาถ่ายรูปใหม่หรือรอแอดมินเทรนใหม่')),
            runId,
            { code: t.code, name: t.name },
          );
          if (success) toast.success(`อัปเดตสถานะ: ${t.name} เทรนสำเร็จ ✓ (นักศึกษาเห็นผลทันที)`);
          else toast.error(`อัปเดตสถานะ: ${t.name} เทรนไม่สำเร็จ`);
        } catch (e) {
          console.warn('update registration status failed', e);
          toast.error('อัปเดตสถานะนักศึกษาไม่สำเร็จ');
        }
      },
    });
  }, [startTraining]);


  const stop = () => {
    // Real training (tf.js) can only be interrupted at the epoch boundary — signal it,
    // the async trainer will finalise the run and call the onFinished callback with status='stopped'.
    shouldStopRef.current = true;
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏹ ส่งสัญญาณหยุด (จะหยุดเมื่อจบ epoch ปัจจุบัน)`]);
  };

  const datasetsCount = getAllDatasets().length;

  const rollback = (id: string) => {
    setActiveModelId(id);
    const r = runs.find(x => x.id === id);
    toast.success(`เปลี่ยน Active Model เป็น ${r?.name} แล้ว`);
  };
  const deleteRun = (id: string) => {
    if (id === activeId) { toast.error('ไม่สามารถลบโมเดลที่กำลังใช้งานได้'); return; }
    saveRuns(getRuns().filter(r => r.id !== id));
    if (selectedRunId === id) setSelectedRunId(null);
    toast.success('ลบโมเดลเรียบร้อย');
  };

  const progress = Math.round((currentEpoch / epochs) * 100);
  const activeRun = useMemo(() => runs.find(r => r.id === activeId), [runs, activeId]);
  const selectedRun = useMemo(() => runs.find(r => r.id === selectedRunId), [runs, selectedRunId]);
  const compareData = useMemo(() => {
    if (!selectedRun || !activeRun || selectedRun.id === activeRun.id) return null;
    const maxEp = Math.max(selectedRun.metrics.length, activeRun.metrics.length);
    return Array.from({ length: maxEp }, (_, i) => ({
      epoch: i + 1,
      [activeRun.name]: activeRun.metrics[i]?.acc,
      [selectedRun.name]: selectedRun.metrics[i]?.acc,
    }));
  }, [selectedRun, activeRun]);

  return (
    <div className="p-4 md:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" /> เทรนโมเดล Neural Network
          </h1>
          <p className="text-sm text-muted-foreground">
            Face Recognition CNN • Active: <span className="font-semibold text-primary">{activeRun?.name ?? '—'}</span>
            {activeRun?.finalAcc && <> (Acc {(activeRun.finalAcc * 100).toFixed(2)}%)</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoTrain(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              autoTrain ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground'
            }`}
          >
            <Zap className="w-3.5 h-3.5" /> Auto-Train {autoTrain ? 'ON' : 'OFF'}
          </button>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium ${
            queueLen > 0 ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            <Inbox className="w-3.5 h-3.5" /> Queue: {queueLen}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-success/15 text-success">
            <Server className="w-3.5 h-3.5" /> Server Training
          </div>
        </div>
      </div>

      {/* Server / Architecture info (Pi removed) */}
      <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Server className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 text-xs text-muted-foreground leading-relaxed">
            <p className="font-semibold text-foreground text-sm mb-0.5">โมเดลเทรนที่ฝั่งเซิร์ฟเวอร์ Admin เท่านั้น</p>
            Dataset ใบหน้าจากการลงทะเบียนของนักศึกษาจะถูก augment เป็น {6 * 10} รูปต่อคน แล้วส่งเข้าคิวเทรนอัตโนมัติ
            — <span className="inline-flex items-center gap-1 text-primary font-medium"><Cpu className="w-3 h-3" /> Raspberry Pi</span> ใช้เฉพาะการสแกนใบหน้าเพื่อเช็คชื่อที่หน้าห้องเรียน (ดึงโมเดลที่เทรนเสร็จไปเทียบเท่านั้น)
            <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-muted text-foreground">Datasets: <b>{datasetsCount}</b> คน</span>
              <span className="px-2 py-0.5 rounded bg-muted text-foreground">Auto-Train: <b>{autoTrain ? 'ON' : 'OFF'}</b></span>
              <span className="px-2 py-0.5 rounded bg-muted text-foreground">Queue: <b>{queueLen}</b></span>
            </div>
          </div>
        </div>
      </div>

      <StaleModelWarning onRetrain={() => startTraining('manual', user?.name)} disabled={running} />



      {/* Live Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Accuracy" value={latest ? `${(latest.acc * 100).toFixed(2)}%` : '—'} accent="text-success" />
        <MetricCard label="Loss" value={latest ? latest.loss.toFixed(4) : '—'} accent="text-destructive" />
        <MetricCard label="Val Accuracy" value={latest ? `${(latest.valAcc * 100).toFixed(2)}%` : '—'} accent="text-primary" />
        <MetricCard label="Epoch" value={`${currentEpoch}/${epochs}`} accent="text-foreground" />
      </div>

      {/* Progress */}
      <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>
            {currentRunMeta ? `กำลังเทรน — ${currentRunMeta.trigger === 'auto-registration' ? 'Auto (' + currentRunMeta.triggeredBy + ')' : 'Manual'}` : 'ความคืบหน้า'}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <motion.div className="h-full gradient-primary" animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
        </div>
      </div>

      {/* Visualization */}
      <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold font-display text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Neural Network Architecture
          </h2>
          <AnimatePresence>
            {running && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs text-secondary font-semibold">
                <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" /> Training...
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <NeuralNetworkViz active={running} epoch={currentEpoch} outputCount={cloudStudents.length} />
      </div>

      {/* Charts + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-2xl p-4 shadow-card border border-border">
          <h2 className="text-base font-bold font-display text-foreground mb-3">Accuracy & Loss</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="epoch" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} domain={[0, 1.5]} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="acc" name="Accuracy" stroke="hsl(var(--success))" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="valAcc" name="Val Acc" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="loss" name="Loss" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="valLoss" name="Val Loss" stroke="hsl(var(--secondary))" strokeWidth={2} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4 shadow-card border border-border space-y-3">
          <h2 className="text-base font-bold font-display text-foreground">Hyperparameters</h2>
          <Field label="Epochs" value={epochs} onChange={setEpochs} min={5} max={200} disabled={running} />
          <Field label="Learning Rate" value={lr} onChange={setLr} step={0.0001} min={0.0001} max={0.1} disabled={running} />
          <Field label="Batch Size" value={batch} onChange={setBatch} min={4} max={128} step={4} disabled={running} />

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button onClick={() => startTraining('manual')} disabled={running}
              className="flex items-center justify-center gap-1 py-2.5 rounded-lg gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
              <Play className="w-3.5 h-3.5" /> เริ่มเทรน
            </button>
            <button onClick={stop} disabled={!running}
              className="flex items-center justify-center gap-1 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold disabled:opacity-50">
              <Square className="w-3.5 h-3.5" /> หยุด
            </button>
          </div>
        </div>
      </div>

      {/* Pending-training queue (cloud, realtime) */}
      <TrainingQueuePanel onTrain={handleTrainFromQueue} running={running} />

      {/* Student photos from cloud database + training values */}
      <CloudStudentGallery />

      {/* Training History */}
      <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-bold font-display text-foreground flex items-center gap-2">
            <History className="w-4 h-4 text-primary" /> ประวัติการเทรน ({runs.length})
          </h2>
          <p className="text-[11px] text-muted-foreground">คลิกแถวเพื่อดูรายละเอียด / เปรียบเทียบ</p>
        </div>

        {runs.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground italic text-center">ยังไม่มีประวัติการเทรน — กด "เริ่มเทรน" หรือรอคิวจากการลงทะเบียนใหม่</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">โมเดล</th>
                  <th className="text-left px-3 py-2 font-semibold">เวลา</th>
                  <th className="text-left px-3 py-2 font-semibold">Trigger</th>
                  <th className="text-right px-3 py-2 font-semibold">Acc</th>
                  <th className="text-right px-3 py-2 font-semibold">Val Acc</th>
                  <th className="text-right px-3 py-2 font-semibold">Loss</th>
                  <th className="text-center px-3 py-2 font-semibold">Dataset</th>
                  <th className="text-center px-3 py-2 font-semibold">สถานะ</th>
                  <th className="text-right px-3 py-2 font-semibold">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => {
                  const isActive = r.id === activeId;
                  const isSelected = r.id === selectedRunId;
                  return (
                    <tr key={r.id}
                        onClick={() => setSelectedRunId(isSelected ? null : r.id)}
                        className={`border-t border-border cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
                        }`}>
                      <td className="px-3 py-2 font-semibold text-foreground">
                        <div className="flex items-center gap-1.5">
                          {r.name}
                          {isActive && <span className="px-1.5 py-0.5 rounded bg-success/15 text-success text-[9px] font-bold uppercase">Active</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.trigger === 'auto-registration' ? `Auto • ${r.triggeredBy ?? ''}` : 'Manual'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-success">{r.finalAcc ? `${(r.finalAcc * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-primary">{r.finalValAcc ? `${(r.finalValAcc * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-destructive">{r.finalLoss ? r.finalLoss.toFixed(4) : '—'}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{r.datasetClasses.length}c / {r.datasetSize}</td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {!isActive && r.status === 'completed' && (
                            <button onClick={() => rollback(r.id)} title="ตั้งเป็น Active (Rollback)"
                              className="p-1.5 rounded-md hover:bg-muted text-primary">
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => deleteRun(r.id)} title="ลบ"
                            className="p-1.5 rounded-md hover:bg-muted text-destructive disabled:opacity-30"
                            disabled={isActive}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Detail / Compare Panel */}
        <AnimatePresence>
          {selectedRun && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="border-t border-border bg-muted/20 overflow-hidden">
              <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-bold font-display text-foreground mb-2">{selectedRun.name} • รายละเอียด</h3>
                  <dl className="grid grid-cols-2 gap-y-1 gap-x-3 text-xs">
                    <Info k="เริ่ม" v={new Date(selectedRun.startedAt).toLocaleString()} />
                    <Info k="เสร็จ" v={selectedRun.finishedAt ? new Date(selectedRun.finishedAt).toLocaleString() : '—'} />
                    <Info k="Trigger" v={selectedRun.trigger === 'auto-registration' ? `Auto • ${selectedRun.triggeredBy}` : 'Manual'} />
                    <Info k="Epochs" v={`${selectedRun.metrics.length}/${selectedRun.epochs}`} />
                    <Info k="Learning Rate" v={selectedRun.learningRate.toString()} />
                    <Info k="Batch Size" v={selectedRun.batchSize.toString()} />
                    <Info k="Final Acc" v={selectedRun.finalAcc ? `${(selectedRun.finalAcc * 100).toFixed(2)}%` : '—'} />
                    <Info k="Final Loss" v={selectedRun.finalLoss ? selectedRun.finalLoss.toFixed(4) : '—'} />
                  </dl>
                  <div className="mt-3">
                    <p className="text-[11px] text-muted-foreground font-semibold uppercase mb-1">Dataset Classes ({selectedRun.datasetClasses.length})</p>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {selectedRun.datasetClasses.map(id => {
                        const s = cloudStudents.find(st => st.studentId === id);
                        return (
                          <span key={id} className="px-2 py-0.5 rounded-md bg-card border border-border text-[10px] text-foreground">
                            {s?.studentName ?? id}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-bold font-display text-foreground mb-2">
                    {compareData ? `เปรียบเทียบกับ ${activeRun?.name}` : 'Accuracy Curve'}
                  </h3>
                  <div className="h-56 bg-card rounded-lg border border-border p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={compareData ?? selectedRun.metrics}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="epoch" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[0.5, 1]} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {compareData ? (
                          <>
                            <Line type="monotone" dataKey={activeRun!.name} stroke="hsl(var(--success))" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey={selectedRun.name} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </>
                        ) : (
                          <>
                            <Line type="monotone" dataKey="acc" name="Accuracy" stroke="hsl(var(--success))" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="valAcc" name="Val Acc" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
                          </>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {!compareData && activeRun && selectedRun.id !== activeRun.id && (
                    <p className="text-[10px] text-muted-foreground mt-1 italic">— ไม่มีข้อมูลพอเปรียบเทียบ —</p>
                  )}
                  {selectedRun.id !== activeId && selectedRun.status === 'completed' && (
                    <button onClick={() => rollback(selectedRun.id)}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" /> ตั้ง {selectedRun.name} เป็น Active Model
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Logs */}
      <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold font-display text-foreground">Training Logs</h2>
        </div>
        <div ref={logsRef} className="bg-[#0d0d0d] text-green-400 font-mono text-[11px] p-4 h-56 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-muted-foreground italic">รอเริ่มเทรน...</p>
          ) : logs.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap leading-relaxed">{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MetricCard = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
    <p className={`text-2xl font-bold font-display mt-1 ${accent}`}>{value}</p>
  </div>
);

const Field = ({ label, value, onChange, min, max, step = 1, disabled }: any) => (
  <div>
    <label className="text-xs text-muted-foreground font-medium">{label}</label>
    <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step} disabled={disabled}
      className="mt-1 w-full px-3 py-2 rounded-lg bg-muted text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50" />
  </div>
);

const Info = ({ k, v }: { k: string; v: string }) => (
  <>
    <dt className="text-muted-foreground">{k}</dt>
    <dd className="text-foreground font-medium text-right">{v}</dd>
  </>
);

const StatusBadge = ({ status }: { status: TrainingRun['status'] }) => {
  const map: Record<TrainingRun['status'], string> = {
    running: 'bg-primary/15 text-primary',
    completed: 'bg-success/15 text-success',
    stopped: 'bg-muted text-muted-foreground',
    failed: 'bg-destructive/15 text-destructive',
    queued: 'bg-secondary/15 text-secondary',
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${map[status]}`}>
      {status}
    </span>
  );
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Warns when the ACTIVE shared model's class_map stores non-uuid studentIds
 *  (legacy models trained before face_images.student_id became a uuid). */
function StaleModelWarning({ onRetrain, disabled }: { onRetrain: () => void; disabled?: boolean }) {
  const [stale, setStale] = useState<{ runId: string; bad: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('face_models')
        .select('run_id, class_map')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const map = (Array.isArray(data.class_map) ? data.class_map : []) as { studentId?: string }[];
      const real = map.filter(c => c?.studentId && c.studentId !== '__background__');
      const bad = real.filter(c => !UUID_RE.test(String(c.studentId))).length;
      if (bad > 0) setStale({ runId: data.run_id, bad, total: real.length });
    })();
    return () => { cancelled = true; };
  }, []);

  if (!stale) return null;
  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">
        <p className="font-semibold text-destructive">โมเดลที่ใช้งานอยู่ล้าสมัย</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          class_map ของโมเดล <b>{stale.runId}</b> มี studentId ที่ไม่ใช่รูปแบบ uuid {stale.bad}/{stale.total} รายการ
          — นักศึกษาจะยืนยันตัวตนตอนสแกนไม่ผ่าน กรุณาเทรนโมเดลใหม่
        </p>
      </div>
      <button
        onClick={onRetrain}
        disabled={disabled}
        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 shrink-0"
      >
        เทรนโมเดลใหม่
      </button>
    </div>
  );
}
