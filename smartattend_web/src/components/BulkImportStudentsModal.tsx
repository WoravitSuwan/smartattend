import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, X, FileSpreadsheet, Download, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

/** One parsed row from the upload, plus validation result. */
export interface ParsedRow {
  rowNumber: number;
  name: string;
  studentId: string;
  email: string;
  status: 'ok' | 'error';
  errors: string[];
}

interface Props {
  courseId?: string;
  onClose: () => void;
  onImported?: (courseId: string, rows: ParsedRow[]) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_ID_RE = /^\d{8,13}$/;

/** Bulk-import students from CSV / Excel with preview + per-row error report. */
export default function BulkImportStudentsModal({ courseId: initialCourseId, onClose, onImported }: Props) {
  const [courseList, setCourseList] = useState<{ id: string; code: string; name: string }[]>([]);
  const [existing, setExisting] = useState<{ emails: Set<string>; ids: Set<string> }>({ emails: new Set(), ids: new Set() });
  const [courseId, setCourseId] = useState(initialCourseId ?? '');
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from('courses').select('id, code, name').order('code').then(({ data }) => {
      const list = data ?? [];
      setCourseList(list);
      setCourseId(prev => prev || list[0]?.id || '');
    });
    supabase.from('profiles').select('email, student_code').then(({ data }) => {
      setExisting({
        emails: new Set((data ?? []).map(p => (p.email ?? '').toLowerCase()).filter(Boolean)),
        ids: new Set((data ?? []).map(p => p.student_code ?? '').filter(Boolean)),
      });
    });
  }, []);

  const summary = useMemo(() => {
    if (!rows) return null;
    const ok = rows.filter(r => r.status === 'ok').length;
    const err = rows.length - ok;
    return { ok, err, total: rows.length };
  }, [rows]);

  const readFile = async (file: File): Promise<any[][]> => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const first = wb.SheetNames[0];
    const sheet = wb.Sheets[first];
    return XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' });
  };

  const validate = (raw: any[][]): ParsedRow[] => {
    // Skip empty & find header
    const cleaned = raw.filter(r => r.some(c => String(c ?? '').trim() !== ''));
    if (cleaned.length === 0) return [];

    // Detect header row (contains any of these keywords)
    const headerKeywords = ['name', 'ชื่อ', 'studentid', 'student id', 'รหัสนักศึกษา', 'email', 'อีเมล'];
    const first = cleaned[0].map(c => String(c ?? '').trim().toLowerCase());
    const hasHeader = first.some(c => headerKeywords.some(k => c.includes(k)));
    const dataRows = hasHeader ? cleaned.slice(1) : cleaned;

    // Map columns by header if present; else assume order name, studentId, email
    let colName = 0, colId = 1, colEmail = 2;
    if (hasHeader) {
      first.forEach((c, i) => {
        if (c.includes('name') || c.includes('ชื่อ')) colName = i;
        else if (c.includes('student') || c.includes('รหัส')) colId = i;
        else if (c.includes('email') || c.includes('อีเมล')) colEmail = i;
      });
    }

    const seenEmail = new Set<string>();
    const seenId = new Set<string>();
    const existingEmail = existing.emails;
    const existingId = existing.ids;

    return dataRows.map((r, i): ParsedRow => {
      const name = String(r[colName] ?? '').trim();
      const studentId = String(r[colId] ?? '').trim();
      const email = String(r[colEmail] ?? '').trim().toLowerCase();
      const errors: string[] = [];

      if (!name) errors.push('ไม่มีชื่อ');
      if (!studentId) errors.push('ไม่มีรหัสนักศึกษา');
      else if (!STUDENT_ID_RE.test(studentId)) errors.push('รหัสนักศึกษาต้องเป็นตัวเลข 8-13 หลัก');
      else if (existingId.has(studentId)) errors.push('รหัสนักศึกษาซ้ำกับในระบบ');
      else if (seenId.has(studentId)) errors.push('รหัสนักศึกษาซ้ำในไฟล์');

      if (!email) errors.push('ไม่มีอีเมล');
      else if (!EMAIL_RE.test(email)) errors.push('รูปแบบอีเมลไม่ถูกต้อง');
      else if (existingEmail.has(email)) errors.push('อีเมลซ้ำกับในระบบ');
      else if (seenEmail.has(email)) errors.push('อีเมลซ้ำในไฟล์');

      if (studentId && !existingId.has(studentId)) seenId.add(studentId);
      if (email && !existingEmail.has(email)) seenEmail.add(email);

      return {
        rowNumber: (hasHeader ? i + 2 : i + 1),
        name, studentId, email,
        status: errors.length === 0 ? 'ok' : 'error',
        errors,
      };
    });
  };

  const onPick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setParsing(true);
    setFileName(file.name);
    try {
      const raw = await readFile(file);
      const parsed = validate(raw);
      if (parsed.length === 0) {
        toast.error('ไฟล์ว่าง หรืออ่านข้อมูลไม่ได้');
        setRows(null);
      } else {
        setRows(parsed);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อ่านไฟล์ไม่สำเร็จ');
      setRows(null);
    } finally {
      setParsing(false);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['ชื่อ-นามสกุล', 'รหัสนักศึกษา', 'อีเมล'],
      ['นายสมชาย ใจดี', '65123456789', 'somchai@rmutl.ac.th'],
      ['นางสาวสมหญิง มีสุข', '65123456790', 'somying@rmutl.ac.th'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'students');
    XLSX.writeFile(wb, 'template-students.xlsx');
  };

  const confirm = () => {
    if (!rows || !summary) return;
    if (summary.ok === 0) { toast.error('ไม่มีแถวที่สามารถนำเข้าได้'); return; }
    onImported?.(courseId, rows.filter(r => r.status === 'ok'));
    toast.success(`นำเข้าสำเร็จ ${summary.ok} รายการ` + (summary.err ? ` (ข้าม ${summary.err} แถวที่ผิดพลาด)` : ''));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-card rounded-2xl shadow-elevated border border-border w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold font-display text-foreground">นำเข้ารายชื่อนักศึกษา</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">รายวิชาปลายทาง</label>
              <select value={courseId} onChange={e => setCourseId(e.target.value)}
                className="mt-1 w-full h-10 rounded-lg bg-background border border-border px-2 text-sm text-foreground">
                {courseList.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name.split('\n')[0]}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={downloadTemplate}
                className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm text-foreground hover:bg-muted">
                <Download className="w-4 h-4" /> ดาวน์โหลด Template (.xlsx)
              </button>
            </div>
          </div>

          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-border hover:border-primary transition-colors p-6 text-center">
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => { onPick(e.target.files); e.target.value = ''; }} disabled={parsing} />
            {parsing ? <Loader2 className="w-6 h-6 mx-auto text-primary animate-spin" />
              : <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-2" />}
            <p className="text-sm font-medium text-foreground">
              {parsing ? 'กำลังอ่านไฟล์...' : fileName || 'เลือกไฟล์ CSV / Excel'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              รองรับ .csv .xlsx .xls · ต้องมีคอลัมน์: ชื่อ, รหัสนักศึกษา, อีเมล
            </p>
          </label>

          {summary && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-muted/40 border border-border p-3 text-center">
                <p className="text-[11px] text-muted-foreground">ทั้งหมด</p>
                <p className="text-lg font-bold text-foreground">{summary.total}</p>
              </div>
              <div className="rounded-xl bg-success/10 border border-success/30 p-3 text-center">
                <p className="text-[11px] text-success flex items-center justify-center gap-1"><CheckCircle2 className="w-3 h-3" /> พร้อมนำเข้า</p>
                <p className="text-lg font-bold text-success">{summary.ok}</p>
              </div>
              <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-center">
                <p className="text-[11px] text-destructive flex items-center justify-center gap-1"><AlertCircle className="w-3 h-3" /> ผิดพลาด</p>
                <p className="text-lg font-bold text-destructive">{summary.err}</p>
              </div>
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium w-10">#</th>
                      <th className="px-3 py-2 font-medium">ชื่อ</th>
                      <th className="px-3 py-2 font-medium">รหัส</th>
                      <th className="px-3 py-2 font-medium">อีเมล</th>
                      <th className="px-3 py-2 font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.rowNumber} className={`border-t border-border ${r.status === 'error' ? 'bg-destructive/5' : ''}`}>
                        <td className="px-3 py-2 text-muted-foreground">{r.rowNumber}</td>
                        <td className="px-3 py-2 text-foreground">{r.name || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-foreground">{r.studentId || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-2 text-foreground">{r.email || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-2">
                          {r.status === 'ok'
                            ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="w-3 h-3" /> พร้อม</span>
                            : <span className="inline-flex items-center gap-1 text-destructive" title={r.errors.join(', ')}>
                                <AlertCircle className="w-3 h-3" /> {r.errors[0]}
                              </span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-sm text-foreground hover:bg-muted">
            ยกเลิก
          </button>
          <button onClick={confirm} disabled={!summary || summary.ok === 0}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
            ยืนยันนำเข้า {summary?.ok ? `(${summary.ok})` : ''}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
