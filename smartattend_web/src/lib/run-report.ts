// Per-run report export: CSV (metrics) + PDF (Thai-capable, with sample photos)
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { getDataset } from './dataset-store';
import { fetchStudentImages } from './cloud-sync';
import type { TrainingRun } from './training-store';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const safeName = (s: string) => s.replace(/[^\wก-๙-]+/g, '-');

export function exportRunCSV(run: TrainingRun) {
  const lines: string[] = [
    'Training Run Report',
    `Run,${esc(run.name)}`,
    `Status,${esc(run.status)}`,
    `Student,${esc(run.studentName ?? '-')}`,
    `Student Code,${esc(run.studentCode ?? '-')}`,
    `Trigger,${esc(run.trigger)}`,
    `Started,${esc(run.startedAt)}`,
    `Finished,${esc(run.finishedAt ?? '-')}`,
    `Epochs,${run.epochs}`,
    `Learning Rate,${run.learningRate}`,
    `Batch Size,${run.batchSize}`,
    `Dataset Size,${run.datasetSize}`,
    `Final Accuracy,${run.finalAcc ?? ''}`,
    `Final Loss,${run.finalLoss ?? ''}`,
    `Final Val Accuracy,${run.finalValAcc ?? ''}`,
    `Embedding Value,${run.embeddingValue ?? ''}`,
    '',
    'Epoch,Accuracy,Loss,Val Accuracy,Val Loss',
    ...(run.metrics ?? []).map(m => `${m.epoch},${m.acc},${m.loss},${m.valAcc},${m.valLoss}`),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${safeName(run.name)}-report.csv`);
}

/** Originals for the report: local dataset first, otherwise from the cloud database. */
async function getSampleImages(studentId?: string): Promise<{ label: string; src: string }[]> {
  if (!studentId) return [];
  const local = getDataset(studentId);
  if (local) return local.samples.map(s => ({ label: s.label, src: s.original }));
  try {
    const imgs = await fetchStudentImages(studentId);
    return imgs.filter(i => i.kind === 'original').map(i => ({ label: i.poseLabel ?? i.pose, src: i.imageData }));
  } catch {
    return [];
  }
}

const fmtPct = (v?: number) => (v != null ? `${(v * 100).toFixed(2)}%` : '—');
const fmtNum = (v?: number, d = 4) => (v != null ? v.toFixed(d) : '—');

function buildReportNode(run: TrainingRun, samples: { label: string; src: string }[]): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;color:#1c1410;font-family:inherit;padding:36px;box-sizing:border-box;';
  const metricRows = (run.metrics ?? [])
    .map(m => `<tr>
      <td style="padding:4px 8px;border:1px solid #e2d9d0;text-align:center;">${m.epoch}</td>
      <td style="padding:4px 8px;border:1px solid #e2d9d0;text-align:center;">${(m.acc * 100).toFixed(2)}%</td>
      <td style="padding:4px 8px;border:1px solid #e2d9d0;text-align:center;">${m.loss.toFixed(4)}</td>
      <td style="padding:4px 8px;border:1px solid #e2d9d0;text-align:center;">${(m.valAcc * 100).toFixed(2)}%</td>
      <td style="padding:4px 8px;border:1px solid #e2d9d0;text-align:center;">${m.valLoss.toFixed(4)}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div style="border-bottom:3px solid #4e3524;padding-bottom:12px;margin-bottom:16px;">
      <h1 style="margin:0;font-size:22px;color:#4e3524;">รายงานผลการเทรนโมเดล (Training Run Report)</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#7a6a5c;">RMUTL SmartAttend • Face Recognition CNN • สร้างเมื่อ ${new Date().toLocaleString('th-TH')}</p>
    </div>

    <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:4px 0;width:25%;color:#7a6a5c;">ชื่อโมเดล</td><td style="font-weight:700;">${run.name}</td>
        <td style="padding:4px 0;width:25%;color:#7a6a5c;">สถานะ</td><td style="font-weight:700;">${run.status}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#7a6a5c;">นักศึกษา</td><td style="font-weight:700;">${run.studentName ?? '—'}</td>
        <td style="padding:4px 0;color:#7a6a5c;">รหัสนักศึกษา</td><td style="font-weight:700;">${run.studentCode ?? '—'}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#7a6a5c;">เริ่มเทรน</td><td>${new Date(run.startedAt).toLocaleString('th-TH')}</td>
        <td style="padding:4px 0;color:#7a6a5c;">เสร็จสิ้น</td><td>${run.finishedAt ? new Date(run.finishedAt).toLocaleString('th-TH') : '—'}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#7a6a5c;">Epochs / LR / Batch</td><td>${run.epochs} / ${run.learningRate} / ${run.batchSize}</td>
        <td style="padding:4px 0;color:#7a6a5c;">ขนาด Dataset</td><td>${run.datasetSize} รูป</td>
      </tr>
    </table>

    <div style="display:flex;gap:10px;margin-bottom:18px;">
      ${[
        ['Accuracy', fmtPct(run.finalAcc), '#1a7a3c'],
        ['Loss', fmtNum(run.finalLoss), '#b3261e'],
        ['Val Accuracy', fmtPct(run.finalValAcc), '#4e3524'],
        ['Embedding', fmtNum(run.embeddingValue), '#1c1410'],
      ].map(([k, v, c]) => `
        <div style="flex:1;border:1px solid #e2d9d0;border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:10px;color:#7a6a5c;text-transform:uppercase;letter-spacing:.5px;">${k}</div>
          <div style="font-size:18px;font-weight:800;color:${c};margin-top:2px;">${v}</div>
        </div>`).join('')}
    </div>

    <h2 style="font-size:14px;color:#4e3524;margin:0 0 8px;">รูปตัวอย่างที่นักศึกษาถ่าย (ต้นฉบับ)</h2>
    ${samples.length > 0 ? `
      <div style="display:flex;gap:8px;margin-bottom:18px;">
        ${samples.map(s => `
          <div style="flex:1;text-align:center;">
            <img src="${s.src}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;border:1px solid #e2d9d0;" />
            <div style="font-size:10px;color:#7a6a5c;margin-top:3px;">${s.label}</div>
          </div>`).join('')}
      </div>` : `
      <p style="font-size:11px;color:#7a6a5c;font-style:italic;margin:0 0 18px;">ไม่พบรูปตัวอย่างของนักศึกษาในระบบ</p>`}

    ${metricRows ? `
      <h2 style="font-size:14px;color:#4e3524;margin:0 0 8px;">ค่าการเทรนราย Epoch</h2>
      <table style="width:100%;font-size:10px;border-collapse:collapse;">
        <thead>
          <tr style="background:#4e3524;color:#ffffff;">
            <th style="padding:5px 8px;border:1px solid #4e3524;">Epoch</th>
            <th style="padding:5px 8px;border:1px solid #4e3524;">Accuracy</th>
            <th style="padding:5px 8px;border:1px solid #4e3524;">Loss</th>
            <th style="padding:5px 8px;border:1px solid #4e3524;">Val Acc</th>
            <th style="padding:5px 8px;border:1px solid #4e3524;">Val Loss</th>
          </tr>
        </thead>
        <tbody>${metricRows}</tbody>
      </table>` : ''}
  `;
  return el;
}

export async function exportRunPDF(run: TrainingRun): Promise<void> {
  const samples = await getSampleImages(run.studentId);
  const node = buildReportNode(run, samples);
  document.body.appendChild(node);
  try {
    await Promise.all(Array.from(node.querySelectorAll('img')).map(img => img.decode().catch(() => {})));
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pw = 210, ph = 297;
    const pageCanvasH = Math.floor(canvas.width * (ph / pw));
    let y = 0, page = 0;
    while (y < canvas.height) {
      const sliceH = Math.min(pageCanvasH, canvas.height - y);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      slice.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if (page > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, (sliceH * pw) / canvas.width);
      y += sliceH;
      page++;
    }
    pdf.save(`${safeName(run.name)}-report.pdf`);
  } finally {
    node.remove();
  }
}
