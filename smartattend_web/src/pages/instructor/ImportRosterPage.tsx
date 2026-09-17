import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, ArrowLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import MobileLayout from '@/components/MobileLayout';
import { supabase } from '@/integrations/supabase/client';

interface StudentRow { studentCode: string; studentName: string; studentCodeRaw?: string; }
interface ParseResult {
  courseCode: string;
  courseName: string;
  section: string;
  semester: string;
  students: StudentRow[];
}
interface ImportResponse {
  ok: boolean;
  error?: string;
  courseId?: string;
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedList?: StudentRow[];
}

const STUDENT_HEADER_RE = /รหัส\s*นักศึกษา/;
const NAME_HEADER_RE = /ชื่อ[-\s]*นามสกุล|ชื่อ\s*สกุล|ชื่อ/;
const STUDENT_CODE_RE = /^\d{8,13}(-\d)?$/;

const stripDash = (s: string) => s.replace(/-\d$/, '');
const normalizeSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();

function parseWorkbook(raw: any[][]): ParseResult {
  const rows = raw.map(r => r.map(c => String(c ?? '').trim()));
  const allCells = rows.flat();

  // --- Course info: "รหัสวิชา ENGSE506  วิชา คลังข้อมูล... หน่วยกิต 3 กลุ่มวิชา ENGSE506_SEC_1"
  let courseCode = '', courseName = '', section = '';
  for (const cell of allCells) {
    if (!/รหัสวิชา/.test(cell)) continue;
    const codeM = cell.match(/รหัสวิชา\s+(\S+)/);
    // second "วิชา " (not preceded by "รหัส")
    const nameM = cell.match(/(?<!รหัส)วิชา\s+([^\s].*?)\s+หน่วยกิต/);
    const secM = cell.match(/กลุ่มวิชา\s+(\S+)/);
    if (codeM) courseCode = codeM[1];
    if (nameM) courseName = normalizeSpaces(nameM[1]);
    if (secM) section = secM[1];
    if (courseCode || courseName) break;
  }

  // --- Semester: "ใบรายชื่อนักศึกษา(ภาคเรียนที่ 1 ปีการศึกษา 2569)"
  let semester = '';
  for (const cell of allCells) {
    const m = cell.match(/ภาคเรียนที่\s*(\S+)\s*ปีการศึกษา\s*([^\s)]+)/);
    if (m) { semester = `${m[1]}/${m[2]}`; break; }
  }

  // --- Header row: any cell contains "รหัสนักศึกษา"
  let headerIdx = -1, codeCol = -1, nameCol = -1;
  for (let i = 0; i < rows.length; i++) {
    const idx = rows[i].findIndex(c => STUDENT_HEADER_RE.test(c));
    if (idx !== -1) {
      headerIdx = i;
      codeCol = idx;
      for (let k = 0; k < rows[i].length; k++) {
        if (k !== idx && NAME_HEADER_RE.test(rows[i][k])) { nameCol = k; break; }
      }
      if (nameCol === -1) nameCol = idx + 1;
      break;
    }
  }

  const students: StudentRow[] = [];
  if (headerIdx !== -1) {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.some(c => c)) break; // fully empty row → stop
      const rawCode = (r[codeCol] ?? '').replace(/\s+/g, '');
      if (!rawCode) continue;
      if (!STUDENT_CODE_RE.test(rawCode)) continue;
      const name = normalizeSpaces(r[nameCol] ?? '');
      students.push({
        studentCode: stripDash(rawCode),
        studentCodeRaw: rawCode,
        studentName: name,
      });
    }
  }

  return { courseCode, courseName, section, semester, students };
}

export default function ImportRosterPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const canConfirm = useMemo(
    () => !!parsed?.courseCode && !!parsed?.courseName && (parsed?.students.length ?? 0) > 0,
    [parsed],
  );

  const onPick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setParsing(true);
    setFileName(file.name);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' });
      const p = parseWorkbook(raw);
      setParsed(p);
      if (!p.courseCode || !p.courseName) toast.warning('ไม่พบรหัส/ชื่อวิชาในไฟล์ กรุณาแก้ไขก่อนยืนยัน');
      if (p.students.length === 0) toast.error('ไม่พบรายชื่อนักศึกษาในไฟล์');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อ่านไฟล์ไม่สำเร็จ');
      setParsed(null);
    } finally { setParsing(false); }
  };

  const editField = (k: keyof ParseResult, v: string) => {
    if (!parsed) return;
    setParsed({ ...parsed, [k]: v } as ParseResult);
  };

  const confirm = async () => {
    if (!parsed || !canConfirm) return;
    setUploading(true);
    try {
      const { data, error } = await supabase.functions.invoke<ImportResponse>('import-course-roster', {
        body: {
          courseCode: parsed.courseCode,
          courseName: parsed.courseName,
          section: parsed.section || null,
          semester: parsed.semester || null,
          students: parsed.students,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? 'import_failed');
      setResult(data);
      toast.success(`นำเข้าสำเร็จ · จับคู่ ${data.matchedCount} คน · ไม่พบ ${data.unmatchedCount} คน`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ');
    } finally { setUploading(false); }
  };

  const reset = () => { setParsed(null); setResult(null); setFileName(''); };

  return (
    <MobileLayout title="Import รายชื่อนักศึกษา">
      <div className="px-4 py-4 space-y-4 max-w-3xl mx-auto">
        <button onClick={() => navigate('/instructor')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3 h-3" /> กลับหน้าหลัก
        </button>

        {!parsed && !result && (
          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-border hover:border-primary transition-colors p-8 text-center bg-card">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden"
              onChange={e => { onPick(e.target.files); e.target.value = ''; }} disabled={parsing} />
            {parsing ? <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin" />
              : <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />}
            <p className="text-sm font-medium text-foreground mt-2">
              {parsing ? 'กำลังอ่านไฟล์...' : fileName || 'เลือกไฟล์รายชื่อนักศึกษา (.xlsx)'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              ไฟล์ควรมี "รหัสวิชา", "ชื่อวิชา" และตารางที่มีหัวคอลัมน์ "รหัสนักศึกษา"
            </p>
          </label>
        )}

        {parsed && !result && (
          <div className="space-y-4">
            <div className="rounded-xl bg-card border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">รายละเอียดวิชา</p>
                </div>
                <button onClick={reset} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                  <X className="w-3 h-3" /> ยกเลิก
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="รหัสวิชา *" value={parsed.courseCode} onChange={v => editField('courseCode', v)} />
                <Field label="ชื่อวิชา *" value={parsed.courseName} onChange={v => editField('courseName', v)} />
                <Field label="Section" value={parsed.section} onChange={v => editField('section', v)} />
                <Field label="ภาคเรียน" value={parsed.semester} onChange={v => editField('semester', v)} />
              </div>
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-semibold text-foreground">รายชื่อนักศึกษา ({parsed.students.length})</p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium w-10">#</th>
                      <th className="px-3 py-2 font-medium">รหัสนักศึกษา</th>
                      <th className="px-3 py-2 font-medium">ชื่อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.students.map((s, i) => (
                      <tr key={s.studentCode + i} className="border-t border-border/60">
                        <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{s.studentCodeRaw ?? s.studentCode}</td>
                        <td className="px-3 py-1.5 text-foreground">{s.studentName || <span className="italic text-muted-foreground">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={reset} className="px-4 py-2 rounded-xl border border-border text-sm text-foreground hover:bg-muted">ยกเลิก</button>
              <button onClick={confirm} disabled={!canConfirm || uploading}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2">
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                ยืนยัน import
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-success/10 border border-success/30 p-4">
                <p className="text-[11px] text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> จับคู่สำเร็จ</p>
                <p className="text-2xl font-bold text-success">{result.matchedCount}</p>
                <p className="text-[10px] text-muted-foreground">ส่งคำเชิญให้นักศึกษาแล้ว</p>
              </div>
              <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4">
                <p className="text-[11px] text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" /> ไม่พบในระบบ</p>
                <p className="text-2xl font-bold text-destructive">{result.unmatchedCount}</p>
                <p className="text-[10px] text-muted-foreground">ต้องรอนักศึกษาสมัครก่อน</p>
              </div>
            </div>

            {(result.unmatchedList?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-border overflow-hidden bg-card">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-semibold text-foreground">รายชื่อที่ไม่พบในระบบ</p>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr className="text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">รหัสนักศึกษา</th>
                        <th className="px-3 py-2 font-medium">ชื่อ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unmatchedList!.map((s, i) => (
                        <tr key={s.studentCode + i} className="border-t border-border/60">
                          <td className="px-3 py-1.5 font-mono text-foreground">{s.studentCode}</td>
                          <td className="px-3 py-1.5 text-foreground">{s.studentName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={reset} className="px-4 py-2 rounded-xl border border-border text-sm text-foreground hover:bg-muted">Import ไฟล์อื่น</button>
              <button onClick={() => navigate('/instructor/roster')}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
                ดูรายชื่อในวิชา
              </button>
            </div>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full h-10 rounded-lg bg-background border border-border px-3 text-sm text-foreground" />
    </div>
  );
}
