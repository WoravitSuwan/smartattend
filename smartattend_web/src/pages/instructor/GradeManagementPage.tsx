import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchInstructorCourses, fetchSummary, type SummaryRow } from '@/lib/attendance-data';
import {
  attendanceScore, categoryLabels, deleteGradeItem, fetchGradeItems, fetchStudentGrades,
  gradeColor, fetchGradeScale, gradeItemScoreCount, isFullyGraded, letterGradeFrom, maxScoreOf,
  saveGradeItem, saveStudentGrades, validateScore, weightedTotal,
  type GradeCategory, type GradeItem, type GradeScaleRow, type OverflowPolicy,
  type StudentGrade,
} from '@/lib/grade-data';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Sparkles, Loader2, Save, Download, Upload, X } from 'lucide-react';
import GradeScalePanel from '@/components/GradeScalePanel';
import ConfirmDialog from '@/components/ConfirmDialog';
import GradeStructurePanel from '@/components/GradeStructurePanel';
import { recalcAttendanceScores, type RecalcResult } from '@/lib/attendance-score-data';
import PublishGradesPanel from '@/components/PublishGradesPanel';

interface Course { id: string; code: string; name: string }
interface Student { id: string; name: string; code: string }

const CATEGORIES = Object.keys(categoryLabels) as GradeCategory[];

/** หน้าคะแนนรวม — ถ้าส่ง embeddedCourseId มา จะทำงานเป็นส่วนหนึ่งของหน้า
 *  รายละเอียดรายวิชา (ล็อกวิชาไว้ ไม่ต้องมีแถบเลือกวิชา และไม่ครอบ layout ซ้ำ) */
const GradeManagementPage = ({ embeddedCourseId }: { embeddedCourseId?: string } = {}) => {
  const { user } = useAuth();
  const embedded = !!embeddedCourseId;
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState(embeddedCourseId ?? '');
  const [items, setItems] = useState<GradeItem[]>([]);
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

  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = สร้างใหม่
  const [savingItem, setSavingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);
  /** ถามวิธีจัดการคะแนนที่เกินเพดานใหม่ */
  const [overflowAsk, setOverflowAsk] = useState<
    { count: number; oldMax: number | null; newMax: number } | null>(null);
  /** ถามยืนยันการลบหัวข้อ */
  const [deleteAsk, setDeleteAsk] = useState<{ item: GradeItem; count: number } | null>(null);
  /** ข้อผิดพลาดรายช่องที่ฐานข้อมูลคืนมาจากการบันทึกครั้งล่าสุด */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [recalcing, setRecalcing] = useState(false);
  /** รายงานผลการคำนวณคะแนนเข้าเรียนครั้งล่าสุด — คำนวณให้กี่คน ข้ามกี่คน ใครบ้าง */
  const [recalcReport, setRecalcReport] = useState<RecalcResult | null>(null);
  const [newName, setNewName] = useState('');
  const [newCat, setNewCat] = useState<GradeCategory>('assignment');
  const [newMax, setNewMax] = useState('100');
  const [newWeight, setNewWeight] = useState('10');

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
    const its = await fetchGradeItems(courseId);
    setItems(its);

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

  /** จำนวนคะแนนที่บันทึกไว้แล้วในหัวข้อหนึ่ง — ใช้เตือนก่อนลบ/ก่อนลดคะแนนเต็ม */
  const savedScoreCount = (itemId: string) =>
    students.filter(s => initialGrades[`${itemId}:${s.id}`] != null).length;

  const closeItemForm = () => {
    setShowNew(false); setEditingId(null);
    setNewName(''); setNewCat('assignment'); setNewMax('100'); setNewWeight('10');
  };

  const openNewItem = () => {
    if (showNew && !editingId) { closeItemForm(); return; }
    setEditingId(null);
    setNewName(''); setNewCat('assignment'); setNewMax('100'); setNewWeight('10');
    setShowNew(true);
  };

  const openEditItem = (it: GradeItem) => {
    setEditingId(it.id);
    setNewName(it.name);
    setNewCat(it.category);
    setNewMax(String(it.max_score));
    setNewWeight(String(it.weight));
    setShowNew(true);
  };

  /** ข้อความผิดพลาดจากฐานข้อมูลเป็นภาษาไทยอยู่แล้ว (RPC ใช้ RAISE พร้อมข้อความ)
   *  จึงส่งต่อให้ผู้ใช้ตรง ๆ ได้ ถ้าไม่มีข้อความจึงใช้ข้อความกลาง */
  const dbMessage = (err: { message?: string } | null, fallback: string) =>
    err?.message?.trim() ? err.message : fallback;

  /** บันทึกหัวข้อคะแนน — สร้างใหม่ถ้า editingId เป็น null ไม่งั้นแก้ไขหัวข้อเดิม
   *  ผ่าน RPC ที่ตรวจสิทธิ์และลง audit log ให้ (เดิม insert ลงตารางตรง ๆ)
   *
   *  onOverflow: ครั้งแรกส่ง 'reject' เสมอ ถ้าฐานข้อมูลบอกว่ามีคะแนนเกินเพดานใหม่
   *  จะเปิดไดอะล็อกให้อาจารย์เลือกวิธี แล้วเรียกซ้ำด้วยวิธีที่เลือก */
  const saveItem = async (onOverflow: OverflowPolicy = 'reject') => {
    const name = newName.trim();
    const max = Number(newMax);
    const weight = Number(newWeight);
    if (!name) { toast.error('กรุณาระบุชื่อหัวข้อคะแนน'); return; }
    if (!Number.isFinite(max) || max <= 0) { toast.error('คะแนนเต็มต้องมากกว่า 0'); return; }
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      toast.error('น้ำหนักต้องอยู่ระหว่าง 0 - 100%'); return;
    }

    setSavingItem(true);
    const { data, error } = await saveGradeItem({
      courseId, itemId: editingId, name, category: newCat, maxScore: max, weight,
      onOverflow, reason: reason.trim() || undefined,
    });
    setSavingItem(false);

    if (error) {
      // ฐานข้อมูลปฏิเสธเพราะมีคะแนนเกินเพดานใหม่ → ถามอาจารย์ว่าจะทำอย่างไร
      if (onOverflow === 'reject' && editingId && /เกินคะแนนเต็มใหม่/.test(error.message ?? '')) {
        const before = items.find(i => i.id === editingId);
        const n = Number((error.message ?? '').match(/นักศึกษา (\d+) คน/)?.[1] ?? 0);
        setOverflowAsk({ count: n, oldMax: before ? Number(before.max_score) : null, newMax: max });
        return;
      }
      console.error(error);
      toast.error(dbMessage(error, 'บันทึกหัวข้อคะแนนไม่สำเร็จ'));
      return;
    }

    const adjusted = Number((data as { adjusted?: number } | null)?.adjusted ?? 0);
    toast.success(
      (editingId ? 'แก้ไขหัวข้อคะแนนแล้ว' : 'เพิ่มหัวข้อคะแนนแล้ว')
      + (adjusted > 0 ? ` · ปรับคะแนนของนักศึกษา ${adjusted} คน (บันทึกในประวัติแล้ว)` : ''),
    );
    setOverflowAsk(null);
    setReason('');
    closeItemForm();
    load();
  };

  /** ลบหัวข้อคะแนน — หัวข้อที่มีคะแนนอยู่ต้องพิมพ์ชื่อหัวข้อยืนยัน
   *  จำนวนคะแนนถามจากฐานข้อมูล ไม่นับจากที่โหลดมา เพราะหน้าจออาจโหลดไม่ครบทุกคน */
  const askRemoveItem = async (it: GradeItem) => {
    const n = await gradeItemScoreCount(it.id);
    setDeleteAsk({ item: it, count: n });
  };

  const doRemoveItem = async (confirmName: string | null) => {
    if (!deleteAsk) return;
    setDeletingItem(true);
    const { data, error } = await deleteGradeItem(
      deleteAsk.item.id, reason.trim() || undefined, confirmName,
    );
    setDeletingItem(false);
    if (error) {
      console.error(error);
      toast.error(dbMessage(error, 'ลบไม่สำเร็จ'));
      return;
    }
    toast.success(Number(data) > 0
      ? `ลบหัวข้อและคะแนน ${data} รายการแล้ว (บันทึกในประวัติ)`
      : 'ลบหัวข้อคะแนนแล้ว');
    if (editingId === deleteAsk.item.id) closeItemForm();
    setDeleteAsk(null);
    setReason('');
    load();
  };

  const setScore = (itemId: string, studentId: string, raw: string) => {
    const key = `${itemId}:${studentId}`;
    const v = raw === '' ? null : Number(raw);
    setGrades(prev => ({ ...prev, [key]: Number.isNaN(v as number) ? null : v }));
    // แก้ช่องแล้วล้างคำทักท้วงของฐานข้อมูลในช่องนั้น ไม่ให้ค้างเป็นสีแดงทั้งที่แก้แล้ว
    setServerErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev));
  };

  /** ช่องที่กรอกผิดทั้งหมด คีย์เดียวกับ grades
   *  ตรวจทันทีที่พิมพ์ ไม่รอกดบันทึก เพราะอาจารย์ต้องรู้ตรงช่องที่พิมพ์ผิด */
  const invalidCells = useMemo(() => {
    const out: Record<string, string> = {};
    for (const it of items) {
      for (const st of students) {
        const key = `${it.id}:${st.id}`;
        const err = validateScore(it, grades[key]);
        if (err) out[key] = err;
      }
    }
    return out;
  }, [items, students, grades]);

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
    for (const it of items) {
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
      const it = items.find(i => i.id === itemId);
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
      const it = items.find(i => i.id === first?.grade_item_id);
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
    if (!students.length || !items.length) { toast.error('ไม่มีข้อมูลให้ส่งออก'); return; }
    const course = courses.find(c => c.id === courseId);
    const rows = students.map(s => {
      const row: Record<string, string | number> = { 'รหัสนักศึกษา': s.code, 'ชื่อ-นามสกุล': s.name };
      items.forEach(it => { row[it.name] = grades[`${it.id}:${s.id}`] ?? ''; });
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
        for (const it of items) {
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

  const totalWeight = useMemo(
    () => Math.round(items.reduce((a, i) => a + (Number(i.weight) || 0), 0) * 100) / 100,
    [items]);
  /** น้ำหนักยังไม่ครบ 100 — เตือนค้างไว้ และล็อกเฉพาะปุ่มประกาศผล ไม่ล็อกการกรอกคะแนน */
  const weightIncomplete = items.length > 0 && totalWeight !== 100;

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
            {/* Grade items */}
            <div className="bg-card rounded-2xl p-4 shadow-card space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">หัวข้อคะแนน · น้ำหนักรวม {totalWeight}%</p>
                <button onClick={openNewItem} className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                  <Plus className="w-3.5 h-3.5" /> เพิ่ม
                </button>
              </div>
              {weightIncomplete && (
                <p className="text-[10px] text-warning leading-relaxed">
                  น้ำหนักรวมยังไม่เท่ากับ 100% (ตอนนี้ {totalWeight}%
                  {totalWeight < 100 ? ` ขาดอีก ${Math.round((100 - totalWeight) * 100) / 100}%` : ' เกินมา ' + (Math.round((totalWeight - 100) * 100) / 100) + '%'})
                  — กรอกคะแนนได้ปกติ แต่ยังประกาศผลไม่ได้จนกว่าจะครบ 100%
                </p>
              )}

              {items.map(it => (
                <div key={it.id} className={`flex items-center gap-2 py-1.5 border-t border-border first:border-0 ${
                  editingId === it.id ? 'bg-primary/5 -mx-1 px-1 rounded-lg' : ''
                }`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{it.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {categoryLabels[it.category]} · เต็ม {it.max_score} · น้ำหนัก {it.weight}%
                      {it.category === 'final' && !published && ' · นักศึกษายังไม่เห็นจนกว่าจะประกาศผล'}
                    </p>
                  </div>
                  <button onClick={() => openEditItem(it)} title="แก้ไขหัวข้อคะแนน"
                    className="p-1 rounded-lg hover:bg-muted">
                    <Pencil className="w-3.5 h-3.5 text-primary" />
                  </button>
                  <button onClick={() => askRemoveItem(it)} title="ลบหัวข้อคะแนน"
                    className="p-1 rounded-lg hover:bg-muted">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              ))}
              {items.length === 0 && <p className="text-[11px] text-muted-foreground">ยังไม่มีหัวข้อคะแนน</p>}

              {showNew && (
                <div className="pt-2 space-y-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-foreground">
                      {editingId ? 'แก้ไขหัวข้อคะแนน' : 'หัวข้อคะแนนใหม่'}
                    </p>
                    <button onClick={closeItemForm} className="p-1 rounded-lg hover:bg-muted" title="ยกเลิก">
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อหัวข้อ เช่น สอบกลางภาค"
                    className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                  <div className="grid grid-cols-3 gap-2">
                    <select value={newCat} onChange={e => setNewCat(e.target.value as GradeCategory)}
                      className="px-2 py-2 rounded-xl bg-muted text-xs text-foreground outline-none">
                      {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}
                    </select>
                    <input value={newMax} onChange={e => setNewMax(e.target.value)} type="number" min={1} placeholder="เต็ม"
                      className="px-2 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                    <input value={newWeight} onChange={e => setNewWeight(e.target.value)} type="number" min={0} max={100} placeholder="น้ำหนัก %"
                      className="px-2 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                  </div>
                  {editingId && savedScoreCount(editingId) > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      หัวข้อนี้มีคะแนนบันทึกไว้แล้ว {savedScoreCount(editingId)} คน — แก้ชื่อ/น้ำหนักได้โดยคะแนนไม่หาย
                    </p>
                  )}
                  <button onClick={() => saveItem()} disabled={savingItem}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
                    {savingItem && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {editingId ? 'บันทึกการแก้ไข' : 'สร้างหัวข้อคะแนน'}
                  </button>
                </div>
              )}
            </div>

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
              <button onClick={exportExcel} disabled={!items.length || !students.length}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-card shadow-card text-xs font-semibold text-foreground disabled:opacity-50">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => fileInputRef.current?.click()} disabled={!items.length}
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
              disabled={saving || items.length === 0 || Object.keys(invalidCells).length > 0}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold shadow-elevated disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} บันทึกคะแนน
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

            {/* Score grid */}
            {students.length > 0 && items.length > 0 && (
              <div className="bg-card rounded-2xl shadow-card overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-2.5 font-medium text-muted-foreground sticky left-0 bg-card">นักศึกษา</th>
                      {items.map(it => (
                        <th key={it.id} className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                          {it.name}<br /><span className="text-[9px] font-normal">/{it.max_score}</span>
                        </th>
                      ))}
                      <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                        ได้<br /><span className="text-[9px] font-normal">/ ที่ตรวจแล้ว</span>
                      </th>
                      <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                        ร้อยละ<br /><span className="text-[9px] font-normal">ของที่ตรวจแล้ว</span>
                      </th>
                      <th className="p-2.5 font-medium text-muted-foreground whitespace-nowrap">
                        เกรด<br /><span className="text-[9px] font-normal">คาดการณ์</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => {
                      // เทียบเกรดจากร้อยละของ "ส่วนที่ตรวจแล้ว" ไม่ใช่จาก earned ดิบ
                      // เพราะ earned มีตัวหารเป็น usedWeight ไม่ใช่ 100
                      // ต้นเทอมที่ตรวจแค่กลางภาค ถ้าเทียบ earned ตรง ๆ จะ F ทั้งห้อง
                      const w = weightedTotal(items, id => grades[`${id}:${s.id}`] ?? null);
                      const g = w.normalized == null ? null : letterGradeFrom(scale, w.normalized);
                      const done = isFullyGraded(w);
                      return (
                        <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                          className="border-b border-border last:border-0">
                          <td className="p-2.5 sticky left-0 bg-card">
                            <p className="font-medium text-foreground whitespace-nowrap">{s.name}</p>
                            <p className="text-[10px] text-muted-foreground">{s.code}</p>
                          </td>
                          {items.map(it => {
                            const key = `${it.id}:${s.id}`;
                            const err = badCells[key];
                            return (
                              <td key={it.id} className="p-1.5 text-center">
                                <input
                                  type="number" min={0} max={maxScoreOf(it) ?? undefined} step="any"
                                  value={grades[key] ?? ''}
                                  onChange={e => setScore(it.id, s.id, e.target.value)}
                                  title={err ?? undefined}
                                  aria-invalid={!!err}
                                  className={`w-14 px-1.5 py-1 rounded-lg text-center outline-none ${
                                    err
                                      ? 'bg-destructive/15 text-destructive ring-1 ring-destructive'
                                      : 'bg-muted text-foreground'
                                  }`}
                                />
                              </td>
                            );
                          })}
                          <td className="p-2.5 text-center font-semibold text-foreground whitespace-nowrap">
                            {w.usedWeight > 0 ? `${w.earned.toFixed(1)} / ${w.usedWeight}` : '—'}
                          </td>
                          <td className="p-2.5 text-center font-semibold text-foreground whitespace-nowrap">
                            {w.normalized == null ? '—' : `${w.normalized.toFixed(1)}%`}
                          </td>
                          <td className={`p-2.5 text-center font-bold whitespace-nowrap ${g ? gradeColor(g) : 'text-muted-foreground'}`}>
                            {g == null ? '—' : (done ? g : `${g}*`)}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="px-3 pb-3 pt-1 text-[10px] text-muted-foreground leading-relaxed">
                  ช่อง "ได้" คือคะแนนที่ได้เทียบกับน้ำหนักที่ตรวจแล้ว ไม่ใช่เทียบ 100 ·
                  หัวข้อที่ยังไม่ตรวจไม่ถูกนับเป็นศูนย์และไม่ถูกนับในตัวหาร ·
                  เครื่องหมาย * = ยังตรวจไม่ครบ 100% เกรดยังเปลี่ยนได้ ·
                  นักศึกษาจะไม่เห็นตัวอักษรเกรดจนกว่าจะตรวจครบและกดประกาศผล ·
                  เกณฑ์ตัดเกรดที่ใช้: {scaleIsCourseSpecific ? 'ของรายวิชานี้' : 'ค่าเริ่มต้นของระบบ'}
                  {scale.length > 0 && ` (${scale.map(r => `${r.grade}≥${r.min_score}`).join(' · ')})`}
                </p>
              </div>
            )}
          </>
        )}

        {/* ── ลดคะแนนเต็มแล้วมีคะแนนเกิน: ให้อาจารย์เลือกวิธี ไม่ตัดสินใจแทน ── */}
        <ConfirmDialog
          open={!!overflowAsk}
          busy={savingItem}
          title="มีคะแนนที่เกินคะแนนเต็มใหม่"
          description={overflowAsk && (
            <>
              <p>
                คะแนนของนักศึกษา <b>{overflowAsk.count} คน</b> เกินคะแนนเต็มใหม่
                {overflowAsk.oldMax != null && <> (เดิมเต็ม {overflowAsk.oldMax})</> } เต็มใหม่ {overflowAsk.newMax}
              </p>
              <p>เลือกวิธีจัดการ — ทุกวิธีบันทึกคะแนนเดิมและคะแนนใหม่ไว้ในประวัติทุกแถว</p>
            </>
          )}
          choices={[
            {
              value: 'rescale', label: 'ปรับตามอัตราส่วนทุกคน', tone: 'primary',
              detail: overflowAsk?.oldMax
                ? `คูณด้วย ${overflowAsk.newMax}/${overflowAsk.oldMax} — ลำดับที่ไม่เปลี่ยน`
                : 'ลำดับที่ไม่เปลี่ยน',
            },
            {
              value: 'clamp', label: 'ตัดเฉพาะคนที่เกิน', tone: 'muted',
              detail: `ให้เท่ากับ ${overflowAsk?.newMax ?? ''} — คนที่เกินจะได้เท่ากันหมด`,
            },
          ]}
          cancelLabel="ยกเลิกการแก้ไข"
          onCancel={() => setOverflowAsk(null)}
          onConfirm={v => saveItem(v as OverflowPolicy)}
        />

        {/* ── ลบหัวข้อที่มีคะแนน: ต้องพิมพ์ชื่อหัวข้อยืนยัน ── */}
        <ConfirmDialog
          open={!!deleteAsk}
          busy={deletingItem}
          title={`ลบหัวข้อ "${deleteAsk?.item.name ?? ''}"`}
          description={deleteAsk && (
            <>
              {deleteAsk.count > 0 ? (
                <>
                  <p className="text-destructive font-medium">
                    จะลบคะแนนของนักศึกษา {deleteAsk.count} คนในหัวข้อนี้ทิ้งไปด้วย และกู้คืนไม่ได้
                  </p>
                  <p>
                    ถ้าเพียงต้องการแก้ชื่อ ประเภท คะแนนเต็ม หรือน้ำหนัก ให้กดปุ่มดินสอแทน
                    คะแนนจะไม่หาย
                  </p>
                </>
              ) : (
                <p>หัวข้อนี้ยังไม่มีคะแนนของนักศึกษา</p>
              )}
              <p className="text-[10px]">การลบจะถูกบันทึกในประวัติว่าใครลบ ลบอะไร กระทบกี่คน และเมื่อไร</p>
            </>
          )}
          requireText={deleteAsk && deleteAsk.count > 0 ? deleteAsk.item.name : null}
          requireTextLabel={deleteAsk && deleteAsk.count > 0
            ? `พิมพ์ชื่อหัวข้อ "${deleteAsk.item.name}" เพื่อยืนยัน`
            : undefined}
          choices={[{ value: 'delete', label: 'ลบหัวข้อคะแนน', tone: 'danger' }]}
          onCancel={() => setDeleteAsk(null)}
          onConfirm={() => doRemoveItem(deleteAsk?.count ? deleteAsk.item.name : null)}
        />

      </div>
  );

  if (embedded) return body;
  return <MobileLayout title="คะแนนรวมทั้งหมด">{body}</MobileLayout>;
};

export default GradeManagementPage;
