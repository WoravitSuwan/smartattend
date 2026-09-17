// Sync face datasets + training runs to the Supabase database
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert } from '@/integrations/supabase/types';
import type { FaceDataset } from './dataset-store';
import type { TrainingRun, TrainingMetric } from './training-store';

export interface CloudFaceImage {
  id: string;
  pose: string;
  poseLabel: string | null;
  kind: string;      // 'original' | 'augmented'
  variant: number;   // 0 = original, 1-10 = augmented
  imageData: string; // dataURL
  capturedAt: string;
}

export interface CloudRun {
  id: string;
  name: string;
  status: string;
  trigger: string | null;
  finalAcc: number | null;
  finalLoss: number | null;
  finalValAcc: number | null;
  embeddingValue: number | null;
  datasetSize: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CloudRunFull extends CloudRun {
  studentId: string | null;
  studentCode: string | null;
  studentName: string | null;
  epochs: number | null;
  learningRate: number | null;
  batchSize: number | null;
  metrics: TrainingMetric[];
}

export interface CloudStudent {
  studentId: string;
  studentCode: string | null;
  studentName: string;
  totalImages: number;
  originals: CloudFaceImage[]; // 6 pose originals (thumbnails)
  latestRun: CloudRun | null;
  runsCount: number;
}

// ---------- Upload with per-image progress + failure reasons ----------

export interface UploadFailure {
  pose: string;
  label: string;
  kind: string;    // 'original' | 'augmented'
  variant: number; // 0 = original
  reason: string;
}

export interface UploadReport {
  total: number;
  uploaded: number;
  failed: UploadFailure[];
}

type FaceImageInsert = TablesInsert<'face_images'>;
interface UploadItem { row: FaceImageInsert; meta: { pose: string; label: string; kind: string; variant: number } }

// ---------- Upload debug logging ----------
// Structured console logs so failures can be diagnosed from browser console logs.
interface UploadErrorLike { message: string; code?: string | null; details?: string | null; hint?: string | null }
function logUpload(event: string, data?: Record<string, unknown>) {
  console.info(`[upload] ${event}`, { ts: new Date().toISOString(), ...(data ?? {}) });
}
function logUploadError(event: string, err: UploadErrorLike, data?: Record<string, unknown>) {
  console.error(`[upload] ${event}`, {
    ts: new Date().toISOString(),
    code: err.code ?? 'unknown',
    message: err.message,
    details: err.details ?? undefined,
    hint: err.hint ?? undefined,
    ...(data ?? {}),
  });
}

function humanizeUploadError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('network')) return 'การเชื่อมต่ออินเทอร์เน็ตขัดข้อง';
  if (m.includes('payload') || m.includes('413') || m.includes('too large')) return 'ไฟล์รูปมีขนาดใหญ่เกินไป';
  if (m.includes('row-level security') || m.includes('permission') || m.includes('jwt') || m.includes('401') || m.includes('403'))
    return 'ไม่มีสิทธิ์อัปโหลด — กรุณาเข้าสู่ระบบใหม่';
  if (m.includes('timeout') || m.includes('timed out')) return 'หมดเวลาเชื่อมต่อ';
  return msg;
}

async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) logUploadError('auth-check-failed', { message: error.message, code: error.name });
  if (!user) {
    logUploadError('no-session', { message: 'no authenticated user', code: 'NO_SESSION' });
    throw new Error('ยังไม่ได้เข้าสู่ระบบ — กรุณาเข้าสู่ระบบแล้วลองใหม่');
  }
  return user;
}

function buildUploadItems(ds: FaceDataset, userId: string): UploadItem[] {
  return ds.samples.flatMap(s => [
    {
      row: {
        user_id: userId,
        student_id: userId, student_code: ds.studentCode ?? null, student_name: ds.studentName,
        pose: s.pose, pose_label: s.label, kind: 'original', variant: 0,
        image_data: s.original, captured_at: s.capturedAt,
      },
      meta: { pose: s.pose, label: s.label, kind: 'original', variant: 0 },
    },
    ...s.augmented.map((img, i) => ({
      row: {
        user_id: userId,
        student_id: userId, student_code: ds.studentCode ?? null, student_name: ds.studentName,
        pose: s.pose, pose_label: s.label, kind: 'augmented', variant: i + 1,
        image_data: img, captured_at: s.capturedAt,
      },
      meta: { pose: s.pose, label: s.label, kind: 'augmented', variant: i + 1 },
    })),
  ]);
}

async function insertItems(
  items: UploadItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadReport> {
  const CHUNK = 6;
  const failed: UploadFailure[] = [];
  let done = 0;
  const startedAt = performance.now();
  logUpload('insert-start', { total: items.length, chunkSize: CHUNK });
  onProgress?.(0, items.length);

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const { error } = await supabase.from('face_images').insert(chunk.map(c => c.row));
    if (error) {
      logUploadError('chunk-insert-failed', error, {
        chunkIndex: i / CHUNK,
        chunkItems: chunk.map(c => `${c.meta.pose}/${c.meta.kind}#${c.meta.variant}`),
      });
      // Fall back to one-by-one so each image gets its own error reason
      for (const c of chunk) {
        const r = await supabase.from('face_images').insert(c.row);
        if (r.error) {
          logUploadError('image-insert-failed', r.error, { ...c.meta });
          failed.push({ ...c.meta, reason: humanizeUploadError(r.error.message) });
        } else {
          logUpload('image-insert-retried-ok', { ...c.meta });
        }
        done++;
        onProgress?.(done, items.length);
      }
    } else {
      done += chunk.length;
      onProgress?.(done, items.length);
    }
  }
  const report = { total: items.length, uploaded: items.length - failed.length, failed };
  const durationMs = Math.round(performance.now() - startedAt);
  if (failed.length > 0) {
    logUploadError('insert-finished-with-failures', {
      message: `${failed.length}/${report.total} images failed`,
      code: 'PARTIAL_FAILURE',
    }, { uploaded: report.uploaded, failedCount: failed.length, durationMs });
  } else {
    logUpload('insert-finished', { uploaded: report.uploaded, total: report.total, durationMs });
  }
  return report;
}

/** Upload the full dataset of a student into the database (replaces previous). */
export async function uploadDatasetToCloud(
  ds: FaceDataset,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadReport> {
  logUpload('upload-start', {
    studentId: ds.studentId, studentCode: ds.studentCode ?? null,
    samples: ds.samples.length,
  });
  const user = await requireUser();

  // Replace any previous dataset for this student (RLS limits deletes to own rows)
  const { error: delErr } = await supabase.from('face_images').delete().eq('user_id', user.id);
  if (delErr) {
    logUploadError('delete-previous-failed', delErr, { studentId: ds.studentId });
    throw new Error(humanizeUploadError(delErr.message));
  }
  logUpload('delete-previous-ok', { studentId: ds.studentId });

  return insertItems(buildUploadItems(ds, user.id), onProgress);
}

/** Retry only the images that failed previously (no delete — just re-insert the missing ones). */
export async function retryFailedUploads(
  ds: FaceDataset,
  failures: UploadFailure[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadReport> {
  logUpload('retry-start', { studentId: ds.studentId, retrying: failures.length });
  const user = await requireUser();
  const all = buildUploadItems(ds, user.id);
  const wanted = all.filter(a =>
    failures.some(f => f.pose === a.meta.pose && f.variant === a.meta.variant && f.kind === a.meta.kind));
  return insertItems(wanted, onProgress);
}

/** How many images this student already has in the cloud database. */
export async function countStudentImages(userId: string): Promise<number> {
  // Match by auth user_id — training queue passes the auth uid, and every face_images
  // row is anchored to that uid regardless of the student code stored in student_id.
  const { count, error } = await supabase.from('face_images')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

/** Persist a training run (running / completed / stopped / failed) to the database. */
export async function saveTrainingRunToCloud(run: TrainingRun): Promise<void> {
  const { error } = await supabase.from('training_runs').upsert({
    id: run.id,
    name: run.name,
    student_id: run.studentId ?? null,
    student_code: run.studentCode ?? null,
    student_name: run.studentName ?? run.triggeredBy ?? null,
    status: run.status,
    trigger: run.trigger,
    epochs: run.epochs,
    learning_rate: run.learningRate,
    batch_size: run.batchSize,
    final_acc: run.finalAcc ?? null,
    final_loss: run.finalLoss ?? null,
    final_val_acc: run.finalValAcc ?? null,
    embedding_value: run.embeddingValue ?? null,
    dataset_size: run.datasetSize,
    metrics: JSON.parse(JSON.stringify(run.metrics ?? [])),
    started_at: run.startedAt,
    finished_at: run.finishedAt ?? null,
  });
  if (error) throw error;
}

/** All training runs in the database, with full epoch metrics (for analytics/graphs). */
export async function fetchCloudRuns(): Promise<CloudRunFull[]> {
  const { data, error } = await supabase.from('training_runs')
    .select('*')
    .order('started_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id, name: r.name, status: r.status, trigger: r.trigger,
    studentId: r.student_id, studentCode: r.student_code, studentName: r.student_name,
    epochs: r.epochs, learningRate: r.learning_rate, batchSize: r.batch_size,
    finalAcc: r.final_acc, finalLoss: r.final_loss, finalValAcc: r.final_val_acc,
    embeddingValue: r.embedding_value, datasetSize: r.dataset_size,
    metrics: Array.isArray(r.metrics) ? (r.metrics as unknown as TrainingMetric[]) : [],
    startedAt: r.started_at, finishedAt: r.finished_at,
  }));
}

/** Overview for admin: each student with pose-original thumbnails + latest training values. */
export async function fetchCloudStudents(): Promise<CloudStudent[]> {
  const [metaRes, origRes, runRes] = await Promise.all([
    supabase.from('face_images').select('id, student_id, student_code, student_name, kind'),
    supabase.from('face_images')
      .select('id, student_id, pose, pose_label, kind, variant, image_data, captured_at')
      .eq('kind', 'original')
      .order('captured_at', { ascending: true }),
    supabase.from('training_runs').select(
      'id, name, status, trigger, student_id, final_acc, final_loss, final_val_acc, embedding_value, dataset_size, started_at, finished_at',
    ).order('started_at', { ascending: false }),
  ]);
  if (metaRes.error) throw metaRes.error;
  if (origRes.error) throw origRes.error;
  if (runRes.error) throw runRes.error;

  const map = new Map<string, CloudStudent>();
  for (const m of metaRes.data ?? []) {
    let s = map.get(m.student_id);
    if (!s) {
      s = {
        studentId: m.student_id, studentCode: m.student_code, studentName: m.student_name,
        totalImages: 0, originals: [], latestRun: null, runsCount: 0,
      };
      map.set(m.student_id, s);
    }
    s.totalImages++;
  }
  for (const o of origRes.data ?? []) {
    const s = map.get(o.student_id);
    if (!s) continue;
    s.originals.push({
      id: o.id, pose: o.pose, poseLabel: o.pose_label, kind: o.kind,
      variant: o.variant, imageData: o.image_data, capturedAt: o.captured_at,
    });
  }
  for (const r of runRes.data ?? []) {
    if (!r.student_id) continue;
    const s = map.get(r.student_id);
    if (!s) continue;
    s.runsCount++;
    if (!s.latestRun) {
      s.latestRun = {
        id: r.id, name: r.name, status: r.status, trigger: r.trigger,
        finalAcc: r.final_acc, finalLoss: r.final_loss, finalValAcc: r.final_val_acc,
        embeddingValue: r.embedding_value, datasetSize: r.dataset_size,
        startedAt: r.started_at, finishedAt: r.finished_at,
      };
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.originals[0]?.capturedAt ?? '').localeCompare(a.originals[0]?.capturedAt ?? ''));
}

/** All images (original + augmented) of one student, for the full gallery modal. */
export async function fetchStudentImages(studentId: string): Promise<CloudFaceImage[]> {
  const { data, error } = await supabase.from('face_images')
    .select('id, pose, pose_label, kind, variant, image_data, captured_at')
    .eq('student_id', studentId)
    .order('captured_at', { ascending: true })
    .order('variant', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(d => ({
    id: d.id, pose: d.pose, poseLabel: d.pose_label, kind: d.kind,
    variant: d.variant, imageData: d.image_data, capturedAt: d.captured_at,
  }));
}
