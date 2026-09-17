// Training history + auto-train queue (localStorage-backed)

export interface TrainingMetric {
  epoch: number;
  acc: number;
  loss: number;
  valAcc: number;
  valLoss: number;
}

export interface TrainingRun {
  id: string;
  name: string;          // "Model v3"
  startedAt: string;     // ISO
  finishedAt?: string;
  status: 'running' | 'completed' | 'stopped' | 'failed' | 'queued';
  epochs: number;
  learningRate: number;
  batchSize: number;
  finalAcc?: number;
  finalLoss?: number;
  finalValAcc?: number;
  metrics: TrainingMetric[];
  datasetClasses: string[];   // student ids included
  datasetSize: number;        // total images
  trigger: 'manual' | 'auto-registration';
  triggeredBy?: string;       // student name/id for auto
  studentId?: string;         // student trained (for auto-registration)
  studentCode?: string;       // "67543210064-1"
  studentName?: string;
  embeddingValue?: number;    // mock embedding norm
  notes?: string;
}

export const getRunsForStudent = (studentId: string): TrainingRun[] =>
  getRuns().filter(r => r.studentId === studentId);

export interface QueueItem {
  id: string;
  studentId: string;
  studentName: string;
  studentCode?: string;
  createdAt: string;
}

const RUNS_KEY = 'training.runs';
const ACTIVE_KEY = 'training.activeModelId';
const QUEUE_KEY = 'training.queue';

export const getRuns = (): TrainingRun[] => {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '[]'); } catch { return []; }
};
export const saveRuns = (runs: TrainingRun[]) => {
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  window.dispatchEvent(new Event('training:update'));
};
export const upsertRun = (run: TrainingRun) => {
  const all = getRuns();
  const i = all.findIndex(r => r.id === run.id);
  if (i >= 0) all[i] = run; else all.unshift(run);
  saveRuns(all);
};

export const getActiveModelId = (): string | null => localStorage.getItem(ACTIVE_KEY);
export const setActiveModelId = (id: string) => {
  localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new Event('training:update'));
};

export const getQueue = (): QueueItem[] => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
};
export const enqueue = (item: Omit<QueueItem, 'id' | 'createdAt'>) => {
  const q = getQueue();
  q.push({ ...item, id: `q-${Date.now()}`, createdAt: new Date().toISOString() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new Event('training:queue'));
};
export const clearQueue = () => {
  localStorage.setItem(QUEUE_KEY, '[]');
  window.dispatchEvent(new Event('training:queue'));
};
export const popQueue = (): QueueItem | null => {
  const q = getQueue();
  if (q.length === 0) return null;
  const item = q.shift()!;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new Event('training:queue'));
  return item;
};

export const nextModelName = (): string => {
  const n = getRuns().filter(r => r.status === 'completed').length + 1;
  return `Model v${n}`;
};
