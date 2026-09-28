import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchInstructorCourses, fetchSummary, type SummaryRow } from '@/lib/attendance-data';
import {
  fetchGradeScale, fetchStudentGrades, saveStudentGrades,
  type GradeScaleRow, type StudentGrade,
} from '@/lib/grade-data';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Sparkles, Loader2, Save, Download, Upload } from 'lucide-react';
import GradeScalePanel from '@/components/GradeScalePanel';
import GradeStructurePanel from '@/components/GradeStructurePanel';
import { recalcAttendanceScores, type RecalcResult } from '@/lib/attendance-score-data';
import PublishGradesPanel from '@/components/PublishGradesPanel';
import GradeSheet from '@/components/GradeSheet';
import { useUnsavedWarning } from '@/lib/use-unsaved-warning';
import { fetchComponents, fetchStructureItems } from '@/lib/grade-structure-data';
import { findBadCells, type GradeComponent, type StructureItem } from '@/lib/grade-structure';

interface Course { id: string; code: string; name: string }
interface Student { id: string; name: string; code: string }

/** หน้าคะแนนรวม — ถ้าส่ง embeddedCourseId มา จะทำงานเป็นส่วนหนึ่งของหน้า
 *  รายละเอียดรายวิชา (ล็อกวิชาไว้ ไม่ต้องมีแถบเลือกวิชา และไม่ครอบ layout ซ้ำ) */
const GradeManagementPage = ({ embeddedCourseId }: { embeddedCourseId?: string } = {}) => {
  const { user } = useAuth();
  const embedded = !!embeddedCourseId;
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState(embeddedCourseId ?? '');
  /** โครงสร้างสามระดับ — แหล่งเดียวของหัวข้อคะแนนและน้ำหนัก
   *  ไม่มีการอ่าน grade_items.weight ในหน้านี้อีกแล้ว */
  const [components, setComponents] = useState<GradeComponent[]>([]);
  const [structureItems, setStructureItems] = useState<StructureItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Record<string, number | null>>({}); // `${itemId}:${studentId}`
  const [initialGrades, setInitialGrades] = useState<Record<string, number | null>>({});
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(false);
  const [gradesLocked, setGradesLocked] = useState(false);
  const [scale, setScale] = useState<GradeScaleRow[]>([]);
  const [scaleIsCourseSpecific, setScaleIsCourseSpecific] = useState(false);
  const [reason, setReason] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** ข้อผิดพลาดรายช่องที่ฐานข้อมูลคืนมาจากการบันทึกครั้งล่าสุด */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [recalcing, setRecalcing] = useState(false);
  /** รายงานผลการคำนวณคะแนนเข้าเรียนครั้งล่าสุด — คำนวณให้กี่คน ข้ามกี่คน ใครบ้าง */
  const [recalcReport, setRecalcReport] = useState<RecalcResult | null>(null);

  useEffect(() => {
    if (embeddedCourseId) setCourseId(embeddedCourseId);
  }, [embeddedCourseId]);

  useEffect(() => {
    if (!user || embedded) return;
    fetchInstructorCourses(user.id).then(cs => {
      setCourses(cs as Course[]);
      if (cs.length > 0) setCourseId(cs[0].id);
      else setLoading(false);
    });
  }, [user, embedded]);

  const load = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    const comps = await fetchComponents(courseId);
    const its = await fetchStructureItems(courseId);
    setComponents(comps);
    setStructureItems(its);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enr } = await (supabase as any)
      .from('course_enrollments')
      .select('student_id, student_code_raw, student_name_raw')
      .eq('course_id', courseId)
      .not('student_id', 'is', null);
    const list: Student[] = (enr ?? []).map((e: { student_id: string; student_code_raw: string; student_name_raw: string }) => ({
      id: e.student_id, code: e.student_code_raw, name: e.student_name_raw,
    })).sort((a: Student, b: Student) => a.code.localeCompare(b.code));
    setStudents(list);

    const rows = await fetchStudentGrades(its.map(i => i.id));
    const map: Record<string, number | null> = {};
    rows.forEach((r: StudentGrade) => { map[`${r.grade_item_id}:${r.student_id}`] = r.score; });
    setGrades(map);
    setInitialGrades(map);

    const { data: courseRow } = await supabase
      .from('courses').select('final_grade_published, grades_locked').eq('id', courseId).maybeSingle();
    setPublished(!!courseRow?.final_grade_published);
    setGradesLocked(!!(courseRow as { grades_locked?: boolean } | null)?.grades_locked);

    const sc = await fetchGradeScale(courseId);
    setScale(sc.scale);
    setScaleIsCourseSpecific(sc.isCourseSpecific);

    setSummary(await fetchSummary({ courseId }));
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  /** ข้อความผิดพลาดจากฐานข้อมูลเป็นภาษาไทยอยู่แล้ว (RPC ใช้ RAISE พร้อมข้อความ)
   *  จึงส่งต่อให้ผู้ใช้ตรง ๆ ได้ ถ้าไม่มีข้อความจึงใช้ข้อความกลาง */
  const dbMessage = (err: { message?: string } | null, fallback: string) =>
    err?.message?.trim() ? err.message : fallback;

  const setScore = (itemId: string, studentId: string, raw: string) => {
    const key = `${itemId}:${studentId}`;
    const v = raw === '' ? null : Number(raw);
    setGrades(prev => ({ ...prev, [key]: Number.isNaN(v as number) ? null : v }));
    // แก้ช่องแล้วล้างคำทักท้วงของฐานข้อมูลในช่องนั้น ไม่ให้ค้างเป็นสีแดงทั้งที่แก้แล้ว
    setServerErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev));
  };

  /** ช่องที่กรอกผิดทั้งหมด คีย์เดียวกับ grades
   *  ตรวจทันทีที่พิมพ์ ไม่รอกดบันทึก เพราะอาจารย์ต้องรู้ตรงช่องที่พิมพ์ผิด */
  const invalidCells = useMemo(
    () => findBadCells(structureItems, students, grades),
    [structureItems, students, grades]);

  /** จำนวนช่องที่แก้แล้วแต่ยังไม่กดบันทึก — ใช้เตือนก่อนออกจากหน้า (ข้อ 2.4) */
  const unsavedCount = useMemo(() => {
    let n = 0;
    for (const key of Object.keys(grades)) {
      if (grades[key] !== initialGrades[key]) n++;
    }
    return n;
  }, [grades, initialGrades]);

  useUnsavedWarning(unsavedCount > 0);

  /** ช่องที่ต้องไฮไลต์ = ที่หน้าจอตรวจเจอ + ที่ฐานข้อมูลปฏิเสธ */
  const badCells = useMemo(
    () => ({ ...serverErrors, ...invalidCells }),
    [serverErrors, invalidCells]);

  const saveAll = async () => {
    // ไม่ตรวจน้ำหนักรวมที่นี่โดยเจตนา — การกรอกคะแนนกับการตั้งน้ำหนักเป็นคนละ
    // เรื่องกัน ต้นเทอมที่ยังไม่รู้ว่าจะมีงานกี่ชิ้น น้ำหนักยังไม่ครบ 100 เป็น
    // เรื่องปกติ กฎน้ำหนักรวม 100 ถูกบังคับที่ฐานข้อมูลตอน "ประกาศผล" แทน
    const changes: { itemId: string; studentId: string; value: number | null }[] = [];
    let hasCorrection = false;
    for (const it of structureItems) {
      for (const s of students) {
        const key = `${it.id}:${s.id}`;
        const v = grades[key];
        if (v === undefined || v === initialGrades[key]) continue;
        changes.push({ itemId: it.id, studentId: s.id, value: v });
        if (initialGrades[key] != null) hasCorrection = true;
      }
    }
    if (changes.length === 0) { toast.error('ยังไม่มีการเปลี่ยนแปลง'); return; }

    // ช่องที่กรอกผิด: บอกให้แก้ก่อน ไม่ส่งไปให้ฐานข้อมูลปฏิเสธทีละรายการ
    // (ฐานข้อมูลยังปฏิเสธซ้ำอีกชั้น เผื่อมีการยิง REST เข้ามาตรง ๆ)
    const badKeys = Object.keys(invalidCells);
    if (badKeys.length > 0) {
      const [itemId, studentId] = badKeys[0].split(':');
      const it = structureItems.find(i => i.id === itemId);
      const st = students.find(x => x.id === studentId);
      toast.error(
        `${st?.name ?? 'นักศึกษา'} หัวข้อ "${it?.name ?? '?'}": ${invalidCells[badKeys[0]]}`
        + (badKeys.length > 1 ? ` และอีก ${badKeys.length - 1} ช่องที่กรอกผิด` : ''),
      );
      return;
    }

    if (hasCorrection && !reason.trim()) {
      toast.error('มีการแก้ไขคะแนนที่เคยบันทึกไว้แล้ว กรุณาระบุเหตุผลก่อนบันทึก');
      return;
    }
    setSaving(true);
    setServerErrors({});
    // ทรานแซกชันเดียว: RPC ตรวจทุกแถวก่อนเขียน ถ้ามีแถวใดผิดจะไม่เขียนอะไรเลย
    // และคืนรายการที่ผิดมาให้ไฮไลต์ ไม่มีการบันทึกครึ่ง ๆ กลาง ๆ อีก
    const { result, error } = await saveStudentGrades(
      courseId,
      changes.map(c => ({ grade_item_id: c.itemId, student_id: c.studentId, score: c.value })),
      reason.trim() || undefined,
    );
    setSaving(false);

    if (error) {
      console.error(error);
      toast.error(dbMessage(error, 'บันทึกคะแนนไม่สำเร็จ'));
      return;
    }

    if (result && !result.ok) {
      // ไฮไลต์ช่องที่ฐานข้อมูลปฏิเสธ พร้อมเหตุผลของแต่ละช่อง
      const map: Record<string, string> = {};
      for (const e of result.errors) map[`${e.grade_item_id}:${e.student_id}`] = e.reason;
      setServerErrors(map);
      const first = result.errors[0];
      const it = structureItems.find(i => i.id === first?.grade_item_id);
      const st = students.find(x => x.id === first?.student_id);
      toast.error(
        `ไม่ได้บันทึกอะไรเลย — ${st?.name ?? 'นักศึกษา'} หัวข้อ "${it?.name ?? '?'}": ${first?.reason ?? 'ข้อมูลไม่ถูกต้อง'}`
        + (result.errors.length > 1 ? ` และอีก ${result.errors.length - 1} ช่อง` : ''),
      );
      return;
    }

    // audit log ของทั้งชุดถูกเขียนใน RPC แล้ว ไม่ต้องเรียก logAudit ซ้ำจากหน้าจอ
    setReason('');
    toast.success(`บันทึกคะแนน ${result?.saved ?? 0} รายการเรียบร้อย นักศึกษาจะได้รับการแจ้งเตือน`);
    load();
  };

  const exportExcel = () => {
    if (!students.length || !structureItems.length) { toast.error('ไม่มีข้อมูลให้ส่งออก'); return; }
    const course = courses.find(c => c.id === courseId);
    const rows = students.map(s => {
      const row: Record<string, string | number> = { 'รหัสนักศึกษา': s.code, 'ชื่อ-นามสกุล': s.name };
      structureItems.forEach(it => { row[it.name] = grades[`${it.id}:${s.id}`] ?? ''; });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'grades');
    XLSX.writeFile(wb, `${course?.code ?? 'course'}_grades.xlsx`);
    toast.success('ส่งออกไฟล์แล้ว');
  };

  const importExcel = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);
      const byCode = new Map(students.map(s => [s.code, s]));
      const next = { ...grades };
      let matched = 0;
      for (const row of rows) {
        const code = String(row['รหัสนักศึกษา'] ?? '').trim();
        const student = byCode.get(code);
        if (!student) continue;
        for (const it of structureItems) {
          const raw = row[it.name];
          if (raw === undefined || raw === '') continue;
          const num = Number(raw);
          if (Number.isNaN(num)) continue;
          next[`${it.id}:${student.id}`] = num;
        }
        matched++;
      }
      setGrades(next);
      toast.success(`นำเข้าแล้ว ${matched} คน — ตรวจสอบแล้วกด "บันทึกคะแนน" เพื่อยืนยัน`);
    } catch (e) {
      console.error(e);
      toast.error('อ่านไฟล์ไม่สำเร็จ — ตรวจสอบว่าคอลัมน์ "รหัสนักศึกษา" และชื่อหัวข้อคะแนนตรงกัน');
    }
  };

  /**
   * คำนวณคะแนนการเข้าเรียนลงตารางคะแนนผ่าน RPC
   *
   * ของเดิมคำนวณในเบราว์เซอร์จาก attendance_rate ของ view สรุป ซึ่งมีปัญหาสามข้อ
   *   1. ข้ามนักศึกษาที่ไม่มีข้อมูลสรุปโดยไม่แจ้ง อาจารย์ไม่รู้ว่าใครไม่ได้คะแนน
   *   2. ผลอยู่แค่ในหน้าจอ รีเฟรชก่อนกดบันทึกคือหายหมด
   *   3. ใช้ attendance_rate ซึ่งไม่รู้จักคาบที่ยกเลิกและคนที่เข้ากลางเทอม
   * ตอนนี้เขียนลงฐานข้อมูลทันทีในทรานแซกชันเดียว และรายงานผลเป็นสามกลุ่ม
   */
  const autoAttendance = async () => {
    setRecalcing(true);
    const { result, error } = await recalcAttendanceScores(courseId);
    setRecalcing(false);

    if (error) {
      console.error(error);
      toast.error(dbMessage(error, 'คำนวณคะแนนการเข้าเรียนไม่สำเร็จ'));
      return;
    }
    if (!result) { toast.error('ไม่ได้รับผลการคำนวณ'); return; }

    setRecalcReport(result);
    const c = result.credits;
    toast.success(
      `คำนวณให้ ${result.updated} คน`
      + (result.skipped > 0 ? ` · ข้าม ${result.skipped} คน` : '')
      + ` · เกณฑ์ ตรงเวลา ${c.on_time} สาย ${c.late} ลา ${c.excused} ขาด ${c.absent}`,
    );
    load();
  };

  const body = (
      <div className={embedded ? 'space-y-4' : 'px-4 py-4 space-y-4'}>
        {!embedded && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {courses.map(c => (
              <button key={c.id} onClick={() => setCourseId(c.id)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                  courseId === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'
                }`}>{c.code}</button>
            ))}
          </div>
        )}

        {!embedded && courses.length === 0 && !loading && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีรายวิชา</div>
        )}

        {courseId && (
          <>
            <GradeStructurePanel courseId={courseId} />

            <GradeScalePanel courseId={courseId} />

            <div className="flex gap-2">
              <button onClick={autoAttendance} disabled={recalcing}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-card shadow-card text-xs font-semibold text-foreground disabled:opacity-50">
                {recalcing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5 text-primary" />}
                คำนวณคะแนนเข้าเรียน
              </button>
              <button onClick={exportExcel} disabled={!structureItems.length || !students.length}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-card shadow-card text-xs font-semibold text-foreground disabled:opacity-50">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => fileInputRef.current?.click()} disabled={!structureItems.length}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-card shadow-card text-xs font-semibold text-foreground disabled:opacity-50">
                <Upload className="w-3.5 h-3.5" />
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importExcel(f); }} />
            </div>

            {recalcReport && (
              <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-[11px] space-y-1">
                <p className="font-semibold text-foreground">ผลการคำนวณคะแนนการเข้าเรียน</p>
                <p className="text-foreground">คำนวณให้แล้ว {recalcReport.updated} คน</p>
                {recalcReport.skipped > 0 && (
                  <p className="text-warning">
                    ข้าม {recalcReport.skipped} คน เพราะยังไม่มีคาบที่นับได้เลย
                    (เพิ่งเข้าร่วมรายวิชา หรือคาบที่ผ่านมาถูกยกเลิกทั้งหมด)
                    {recalcReport.skipped_names.length > 0 &&
                      ` — ${recalcReport.skipped_names.slice(0, 5).join(', ')}`}
                    {recalcReport.skipped_names.length > 5 &&
                      ` และอีก ${recalcReport.skipped_names.length - 5} คน`}
                  </p>
                )}
                <p className="text-muted-foreground leading-relaxed">
                  สูตร: (ตรงเวลา×{recalcReport.credits.on_time} + สาย×{recalcReport.credits.late}
                  {' '}+ ลา×{recalcReport.credits.excused} + ขาด×{recalcReport.credits.absent})
                  {' '}÷ จำนวนคาบที่นับ × น้ำหนักหมวด
                  <br />
                  นับเฉพาะคาบที่ปิดแล้วและไม่ถูกยกเลิก และเฉพาะคาบที่อยู่ในช่วงที่นักศึกษาคนนั้น
                  อยู่ในรายวิชา · นักศึกษาที่ถอนรายวิชาไม่ถูกคำนวณและไม่อยู่ในตารางคะแนน
                  <br />
                  ปรับเกณฑ์ได้ที่หมวดคะแนนที่ตั้งเป็น "คำนวณจากการเข้าเรียน" ด้านบน
                </p>
              </div>
            )}

            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="เหตุผลในการแก้ไข (จำเป็นถ้าแก้คะแนนที่เคยบันทึกไว้แล้ว)"
              className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none resize-none" />

            {Object.keys(badCells).length > 0 && (
              <p className="text-[11px] text-destructive font-medium">
                มีช่องที่กรอกผิด {Object.keys(badCells).length} ช่อง (ไฮไลต์สีแดงในตาราง) — แก้ให้ครบก่อนบันทึก
                {Object.keys(serverErrors).length > 0 && ' · ยังไม่มีคะแนนใดถูกบันทึกจากการกดครั้งล่าสุด'}
              </p>
            )}

            <button onClick={saveAll}
              disabled={saving || structureItems.length === 0 || Object.keys(invalidCells).length > 0}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold shadow-elevated disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              บันทึกคะแนน{unsavedCount > 0 && ` (${unsavedCount} ช่องที่แก้ไว้)`}
            </button>

            <PublishGradesPanel
              courseId={courseId}
              published={published}
              locked={gradesLocked}
              onChanged={load}
            />

            {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
            {!loading && students.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">ยังไม่มีนักศึกษาที่จับคู่บัญชีในรายวิชานี้</div>
            )}

            {/* ── ตารางคะแนนแบบแท็บรายหมวด (ข้อ 4.1) ──
                 คิดด้วย componentScore()/courseScore() ซึ่งเป็นสูตรเดียวกับที่
                 ฐานข้อมูลใช้ ไม่ใช่ grade_items.weight แบบเดิม จึงไม่มีทางที่
                 ตัวเลขฝั่งอาจารย์กับฝั่งนักศึกษาจะไม่ตรงกัน */}
            {students.length > 0 && (
              <GradeSheet
                components={components}
                items={structureItems}
                students={students}
                grades={grades}
                badCells={badCells}
                scale={scale}
                published={published}
                readOnly={gradesLocked}
                onChange={setScore}
              />
            )}

          </>
        )}

      </div>
  );

  if (embedded) return body;
  return <MobileLayout title="คะแนนรวมทั้งหมด">{body}</MobileLayout>;
};

export default GradeManagementPage;
