// Real face-recognition training pipeline using TensorFlow.js.
//
// Pipeline:
//   1. Pull every face_images row for the target students from the cloud database.
//      Rows already include the client-side augmented variants (5 poses × 10 = 50 per student).
//   2. Decode each dataURL to a 64×64 RGB tensor.
//   3. Build a small CNN (Conv → Pool → Conv → Pool → Dense → Softmax(numClasses)).
//   4. Train with model.fit() and stream real per-epoch metrics.
//   5. Persist the trained model in localStorage under `indexeddb://face-model-<runId>`
//      (fallback: `localstorage://...`) so the Pi/edge scanner can load it back.
//
// The trainer requires at least 2 distinct classes (softmax cannot train on 1 class).
// If only one student is available, we synthesise a "background/other" class from
// noise so training still produces a meaningful classifier for that single face.

import * as tf from '@tensorflow/tfjs';
import { supabase } from '@/integrations/supabase/client';
import { uploadSharedModel } from '@/lib/face-model-store';

export interface EpochUpdate {
  epoch: number;
  acc: number;
  loss: number;
  valAcc: number;
  valLoss: number;
}

export interface TrainOptions {
  /** Restrict training to these student IDs. Empty/undefined → train on every student in face_images. */
  studentIds?: string[];
  epochs: number;
  batchSize: number;
  learningRate: number;
  imageSize?: number; // default 64
  onLog?: (line: string) => void;
  onEpoch?: (m: EpochUpdate) => void;
  shouldStop?: () => boolean;
  runId?: string; // for model save path
}

export interface TrainResult {
  status: 'completed' | 'stopped' | 'failed';
  metrics: EpochUpdate[];
  finalAcc: number;
  finalLoss: number;
  finalValAcc: number;
  numClasses: number;
  numImages: number;
  classes: { studentId: string; studentName: string | null; classIndex: number }[];
  savedTo?: string;
  embeddingNorm?: number;
  error?: string;
}

interface Row {
  student_id: string;
  student_name: string | null;
  image_data: string;
}

const decodeImage = (dataUrl: string, size: number): Promise<tf.Tensor3D> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, size, size);
        const t = tf.browser.fromPixels(canvas).toFloat().div(255) as tf.Tensor3D;
        resolve(t);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });

async function loadDataset(studentIds: string[] | undefined, size: number, log: (s: string) => void) {
  let q = supabase.from('face_images').select('student_id, student_name, image_data');
  if (studentIds && studentIds.length > 0) q = q.in('student_id', studentIds);
  const { data, error } = await q;
  if (error) throw new Error(`โหลดรูปจากฐานข้อมูลไม่สำเร็จ: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) throw new Error('ไม่พบรูปในฐานข้อมูล');

  // Class map (studentId → index) keeping label→name for the report.
  const classIndex = new Map<string, number>();
  const classes: { studentId: string; studentName: string | null; classIndex: number }[] = [];
  for (const r of rows) {
    if (!classIndex.has(r.student_id)) {
      classIndex.set(r.student_id, classIndex.size);
      classes.push({ studentId: r.student_id, studentName: r.student_name, classIndex: classIndex.size - 1 });
    }
  }
  log(`โหลด ${rows.length} รูปจาก ${classIndex.size} คลาส (นักศึกษา)`);

  // Decode all images (sequentially in small batches to avoid a memory spike).
  const xs: tf.Tensor3D[] = [];
  const labels: number[] = [];
  const CHUNK = 16;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const tensors = await Promise.all(slice.map(r => decodeImage(r.image_data, size)));
    tensors.forEach((t, k) => { xs.push(t); labels.push(classIndex.get(slice[k].student_id)!); });
    if (i % (CHUNK * 4) === 0) log(`decode... ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
    await tf.nextFrame();
  }

  let numClasses = classIndex.size;
  // Softmax needs ≥2 classes. If only one student, synthesise a "not-this-face" class
  // from Gaussian noise + colour shifts so the classifier is still meaningful.
  if (numClasses < 2) {
    log('พบเพียง 1 คลาส — สร้างคลาส background จาก noise เพื่อให้ softmax เทรนได้');
    const noiseCount = Math.max(20, xs.length);
    for (let i = 0; i < noiseCount; i++) {
      const t = tf.tidy(() => tf.randomNormal([size, size, 3], 0.4, 0.25).clipByValue(0, 1)) as tf.Tensor3D;
      xs.push(t);
      labels.push(1);
    }
    classes.push({ studentId: '__background__', studentName: 'background (auto)', classIndex: 1 });
    numClasses = 2;
  }

  // Stack + one-hot + shuffle in a single tidy to free intermediate tensors.
  const stacked = tf.tidy(() => {
    const X = tf.stack(xs) as tf.Tensor4D;
    const y = tf.oneHot(tf.tensor1d(labels, 'int32'), numClasses) as tf.Tensor2D;
    return { X, y };
  });
  xs.forEach(t => t.dispose());

  // Shuffle indices then split 80/20.
  const N = labels.length;
  const idx = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const cut = Math.max(1, Math.floor(N * 0.8));
  const trainIdx = tf.tensor1d(idx.slice(0, cut), 'int32');
  const valIdx = tf.tensor1d(idx.slice(cut), 'int32');

  const trainX = tf.gather(stacked.X, trainIdx) as tf.Tensor4D;
  const trainY = tf.gather(stacked.y, trainIdx) as tf.Tensor2D;
  const valX = tf.gather(stacked.X, valIdx) as tf.Tensor4D;
  const valY = tf.gather(stacked.y, valIdx) as tf.Tensor2D;

  stacked.X.dispose(); stacked.y.dispose();
  trainIdx.dispose(); valIdx.dispose();

  return { trainX, trainY, valX, valY, numClasses, classes, totalImages: N };
}

function buildModel(numClasses: number, size: number, learningRate: number): tf.LayersModel {
  const m = tf.sequential();
  m.add(tf.layers.conv2d({ inputShape: [size, size, 3], filters: 16, kernelSize: 3, activation: 'relu', padding: 'same' }));
  m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  m.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: 'relu', padding: 'same' }));
  m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  m.add(tf.layers.conv2d({ filters: 64, kernelSize: 3, activation: 'relu', padding: 'same' }));
  m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  m.add(tf.layers.flatten());
  m.add(tf.layers.dropout({ rate: 0.3 }));
  m.add(tf.layers.dense({ units: 64, activation: 'relu', name: 'embedding' }));
  m.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
  m.compile({ optimizer: tf.train.adam(learningRate), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return m;
}

export async function trainFaceModel(opts: TrainOptions): Promise<TrainResult> {
  const size = opts.imageSize ?? 64;
  const log = opts.onLog ?? (() => {});
  const emit = opts.onEpoch ?? (() => {});
  const stop = opts.shouldStop ?? (() => false);

  try {
    await tf.ready();
    log(`TensorFlow.js backend = ${tf.getBackend()}`);

    log('กำลังโหลด dataset จาก face_images...');
    const { trainX, trainY, valX, valY, numClasses, classes, totalImages } =
      await loadDataset(opts.studentIds, size, log);
    log(`Train=${trainX.shape[0]} • Val=${valX.shape[0]} • Classes=${numClasses}`);

    const model = buildModel(numClasses, size, opts.learningRate);
    log(`สร้างโมเดล CNN — params: ${model.countParams().toLocaleString()}`);

    const metrics: EpochUpdate[] = [];
    let stopped = false;

    await model.fit(trainX, trainY, {
      epochs: opts.epochs,
      batchSize: Math.min(opts.batchSize, trainX.shape[0]),
      validationData: [valX, valY],
      shuffle: true,
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          const acc = Number(logs?.acc ?? logs?.accuracy ?? 0);
          const loss = Number(logs?.loss ?? 0);
          const valAcc = Number(logs?.val_acc ?? logs?.val_accuracy ?? 0);
          const valLoss = Number(logs?.val_loss ?? 0);
          const m: EpochUpdate = { epoch: epoch + 1, acc, loss, valAcc, valLoss };
          metrics.push(m);
          emit(m);
          log(`Epoch ${epoch + 1}/${opts.epochs} - acc:${acc.toFixed(4)} loss:${loss.toFixed(4)} val_acc:${valAcc.toFixed(4)} val_loss:${valLoss.toFixed(4)}`);
          await tf.nextFrame();
          if (stop()) { stopped = true; model.stopTraining = true; }
        },
      },
    });

    // Compute embedding norm (mean L2) as a quick health signal.
    let embeddingNorm: number | undefined;
    try {
      const embModel = tf.model({ inputs: model.inputs, outputs: model.getLayer('embedding').output as tf.SymbolicTensor });
      const emb = embModel.predict(valX.shape[0] > 0 ? valX : trainX.slice([0, 0, 0, 0], [Math.min(8, trainX.shape[0]), -1, -1, -1])) as tf.Tensor;
      const norms = tf.tidy(() => emb.square().sum(-1).sqrt().mean());
      embeddingNorm = (await norms.data())[0];
      norms.dispose();
      emb.dispose();
    } catch (e) {
      console.warn('embedding norm calc failed', e);
    }

    // Save model (indexeddb first, fallback localstorage).
    let savedTo: string | undefined;
    const runId = opts.runId ?? `run-${Date.now()}`;
    try {
      await model.save(`indexeddb://face-model-${runId}`);
      savedTo = `indexeddb://face-model-${runId}`;
    } catch {
      try {
        await model.save(`localstorage://face-model-${runId}`);
        savedTo = `localstorage://face-model-${runId}`;
      } catch (e) {
        console.warn('model save failed', e);
      }
    }
    if (savedTo) log(`บันทึกโมเดลไว้ที่ ${savedTo}`);

    // Persist classMap (classIndex → studentId) alongside the model so the
    // scanner can turn softmax argmax into a real student identity.
    try {
      // Fetch student_code for each class from profiles to enrich classMap.
      const studentIds = classes.map(c => c.studentId).filter(id => id && id !== '__background__');
      let codeMap = new Map<string, string | null>();
      if (studentIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, student_code')
          .in('user_id', studentIds);
        codeMap = new Map((profs ?? []).map(p => [p.user_id, p.student_code ?? null]));
      }
      const classMap = classes.map(c => ({
        classIndex: c.classIndex,
        studentId: c.studentId,
        studentCode: codeMap.get(c.studentId) ?? null,
        studentName: c.studentName,
      }));
      localStorage.setItem(`face-model-${runId}-classmap`, JSON.stringify(classMap));
      localStorage.setItem('face-model-latest-runId', runId);

      // Upload to shared storage so students on other devices can use it.
      log('กำลังอัปโหลดโมเดลขึ้นเซิร์ฟเวอร์...');
      const res = await uploadSharedModel(model, runId, classMap);
      log(res.ok
        ? '✓ อัปโหลดโมเดลกลางสำเร็จ (ทุกเครื่องใช้งานได้)'
        : `✗ อัปโหลดโมเดลกลางไม่สำเร็จ (ใช้ได้เฉพาะเครื่องนี้): ${res.error ?? 'unknown error'}`);
    } catch (e) {
      console.warn('classmap save failed', e);
    }

    // Cleanup tensors + model to release GPU memory.
    trainX.dispose(); trainY.dispose(); valX.dispose(); valY.dispose();
    model.dispose();

    const last = metrics[metrics.length - 1] ?? { epoch: 0, acc: 0, loss: 0, valAcc: 0, valLoss: 0 };
    return {
      status: stopped ? 'stopped' : 'completed',
      metrics,
      finalAcc: last.acc,
      finalLoss: last.loss,
      finalValAcc: last.valAcc,
      numClasses,
      numImages: totalImages,
      classes,
      savedTo,
      embeddingNorm,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`✗ Training failed: ${msg}`);
    return {
      status: 'failed', metrics: [], finalAcc: 0, finalLoss: 0, finalValAcc: 0,
      numClasses: 0, numImages: 0, classes: [], error: msg,
    };
  }
}
