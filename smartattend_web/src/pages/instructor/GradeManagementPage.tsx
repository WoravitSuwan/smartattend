import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { logAudit } from '@/lib/audit-log';
import { fetchInstructorCourses, fetchSummary, type SummaryRow } from '@/lib/attendance-data';
import {
  attendanceScore, categoryLabels, deleteGradeItem, fetchGradeItems, fetchStudentGrades,
  gradeColor, fetchGradeScale, isFullyGraded, letterGradeFrom, maxScoreOf, publishFinalGrades,
  saveGradeItem, upsertGrade, validateScore, weightedTotal,
  type GradeCategory, type GradeItem, type GradeScaleRow, type StudentGrade,
} from '@/lib/grade-data';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Sparkles, Loader2, Save, Megaphone, Download, Upload, X } from 'lucide-react';
import GradeScalePanel from '@/components/GradeScalePanel';

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
  const [scale, setScale] = useState<GradeScaleRow[]>([]);
  const [scaleIsCourseSpecific, setScaleIsCourseSpecific] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reason, setReason] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = สร้างใหม่
  const [savingItem, setSavingItem] = useState(false);
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
      .from('courses').select('final_grade_published').eq('id', courseId).maybeSingle();
    setPublished(!!courseRow?.final_grade_published);

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

  const ITEM_ERRORS: Record<string, string> = {
    name_required: 'กรุณาระบุชื่อหัวข้อคะแนน',
    invalid_max_score: 'คะแนนเต็มต้องมากกว่า 0',
    invalid_weight: 'น้ำหนักต้องอยู่ระหว่าง 0 - 100%',
    invalid_category: 'ประเภทคะแนนไม่ถูกต้อง',
    grade_item_not_found: 'ไม่พบหัวข้อคะแนนนี้ (อาจถูกลบไปแล้ว)',
    forbidden: 'ไม่มีสิทธิ์แก้ไขคะแนนของรายวิชานี้',
  };

  /** บันทึกหัวข้อคะแนน — สร้างใหม่ถ้า editingId เป็น null ไม่งั้นแก้ไขหัวข้อเดิม
   *  ผ่าน RPC ที่ตรวจสิทธิ์และลง audit log ให้ (เดิม insert ลงตารางตรง ๆ) */
  const saveItem = async () => {
    const name = newName.trim();
    const max = Number(newMax);
    const weight = Number(newWeight);
    if (!name) { toast.error('กรุณาระบุชื่อหัวข้อคะแนน'); return; }
    if (!Number.isFinite(max) || max <= 0) { toast.error('คะแนนเต็มต้องมากกว่า 0'); return; }
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      toast.error('น้ำหนักต้องอยู่ระหว่าง 0 - 100%'); return;
    }

    // ลดคะแนนเต็มลง = คะแนนที่บันทึกไว้เกินเต็มใหม่จะถูกปรับลงมา บอกก่อนเสมอ
    if (editingId) {
      const before = items.find(i => i.id === editingId);
      const beforeMax = before ? maxScoreOf(before) : null;
      const over = beforeMax != null && max < beforeMax
        ? students.filter(s => {
            const v = initialGrades[`${editingId}:${s.id}`];
            return v != null && v > max;
          }).length
        : 0;
      if (over > 0 && !window.confirm(
        `ลดคะแนนเต็มจาก ${before?.max_score} เป็น ${max} จะทำให้คะแนนของนักศึกษา ${over} คนที่เกินเต็มใหม่ถูกปรับลงมาเป็น ${max} (บันทึกไว้ใน audit log) ยืนยันหรือไม่?`,
      )) return;
    }

    setSavingItem(true);
    const { error } = await saveGradeItem({
      courseId, itemId: editingId, name, category: newCat, maxScore: max, weight,
    });
    setSavingItem(false);
    if (error) {
      console.error(error);
      const key = Object.keys(ITEM_ERRORS).find(k => error.message?.includes(k));
      toast.error(key ? ITEM_ERRORS[key] : 'บันทึกหัวข้อคะแนนไม่สำเร็จ');
      return;
    }
    toast.success(editingId ? 'แก้ไขหัวข้อคะแนนแล้ว' : 'เพิ่มหัวข้อคะแนนแล้ว');
    closeItemForm();
    load();
  };

  const removeItem = async (it: GradeItem) => {
    const n = savedScoreCount(it.id);
    const warn = n > 0
      ? `ลบหัวข้อ "${it.name}" จะลบคะแนนของนักศึกษา ${n} คนในหัวข้อนี้ทิ้งไปด้วย และกู้คืนไม่ได้\n\nถ้าเพียงต้องการแก้ชื่อ คะแนนเต็ม หรือน้ำหนัก ให้กดปุ่มแก้ไข (ดินสอ) แทน — คะแนนจะไม่หาย\n\nยืนยันการลบ?`
      : `ลบหัวข้อ "${it.name}"?`;
    if (!window.confirm(warn)) return;
    const { data, error } = await deleteGradeItem(it.id);
    if (error) { console.error(error); toast.error('ลบไม่สำเร็จ'); return; }
    toast.success(Number(data) > 0 ? `ลบหัวข้อและคะแนน ${data} รายการแล้ว` : 'ลบหัวข้อคะแนนแล้ว');
    if (editingId === it.id) closeItemForm();
    load();
  };

  const setScore = (itemId: string, studentId: string, raw: string) => {
    const v = raw === '' ? null : Number(raw);
    setGrades(prev => ({ ...prev, [`${itemId}:${studentId}`]: Number.isNaN(v as number) ? null : v }));
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

  const saveAll = async () => {
    if (items.length > 0 && totalWeight !== 100) {
      toast.error(`น้ำหนักรวมต้องเท่ากับ 100% พอดี (ตอนนี้ ${totalWeight}%) กรุณาปรับหัวข้อคะแนนก่อนบันทึก`);
      return;
    }
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
    const results = await Promise.all(
      changes.map(c => upsertGrade(c.itemId, c.studentId, c.value, undefined, reason.trim() || undefined)),
    );
    const failed = results.filter(r => r && (r as { error?: unknown }).error);
    setSaving(false);
    if (failed.length > 0) { toast.error(`บันทึกไม่สำเร็จ ${failed.length} รายการ`); return; }
    await logAudit({
      action: 'grade.update', target: 'course', targetId: courseId,
      detail: `บันทึกคะแนน ${changes.length} รายการ${reason.trim() ? ` — เหตุผล: ${reason.trim()}` : ''}`,
    });
    setReason('');
    toast.success('บันทึกคะแนนเรียบร้อย นักศึกษาจะได้รับการแจ้งเตือน');
    load();
  };

  const doPublish = async () => {
    if (!window.confirm('ประกาศผลสอบปลายภาคและเกรดรวม? นักศึกษาทุกคนในวิชานี้จะเห็นคะแนนสอบปลายภาคทันทีและได้รับการแจ้งเตือน')) return;
    setPublishing(true);
    const { error } = await publishFinalGrades(courseId);
    setPublishing(false);
    if (error) { toast.error('ประกาศผลไม่สำเร็จ'); return; }
    setPublished(true);
    toast.success('ประกาศผลคะแนนปลายภาคแล้ว');
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

  const autoAttendance = async () => {
    const attItems = items.filter(i => i.category === 'attendance');
    if (attItems.length === 0) { toast.error('ยังไม่มีหัวข้อคะแนนประเภท "เข้าเรียน"'); return; }
    const next = { ...grades };
    let n = 0;
    for (const it of attItems) {
      for (const s of students) {
        const row = summary.find(r => r.student_id === s.id && r.course_id === courseId);
        if (!row) continue;
        const max = maxScoreOf(it);
        if (max == null) continue;
        next[`${it.id}:${s.id}`] = attendanceScore(row.attendance_rate, max);
        n++;
      }
    }
    setGrades(next);
    toast.success(`คำนวณคะแนนเข้าเรียนอัตโนมัติ ${n} รายการ — กด "บันทึกคะแนน" เพื่อยืนยัน`);
  };

  const totalWeight = useMemo(() => items.reduce((a, i) => a + (Number(i.weight) || 0), 0), [items]);

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
              {totalWeight !== 100 && items.length > 0 && (
                <p className="text-[10px] text-warning">น้ำหนักรวมยังไม่เท่ากับ 100%</p>
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
                  <button onClick={() => removeItem(it)} title="ลบหัวข้อคะแนน"
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
                  <button onClick={saveItem} disabled={savingItem}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
                    {savingItem && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {editingId ? 'บันทึกการแก้ไข' : 'สร้างหัวข้อคะแนน'}
                  </button>
                </div>
              )}
            </div>

            <GradeScalePanel courseId={courseId} />

            <div className="flex gap-2">
              <button onClick={autoAttendance}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-card shadow-card text-xs font-semibold text-foreground">
                <Sparkles className="w-3.5 h-3.5 text-primary" /> คำนวณคะแนนเข้าเรียน
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

            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="เหตุผลในการแก้ไข (จำเป็นถ้าแก้คะแนนที่เคยบันทึกไว้แล้ว)"
              className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none resize-none" />

            {Object.keys(invalidCells).length > 0 && (
              <p className="text-[11px] text-destructive font-medium">
                มีช่องที่กรอกผิด {Object.keys(invalidCells).length} ช่อง (ไฮไลต์สีแดงในตาราง) — แก้ให้ครบก่อนบันทึก
              </p>
            )}

            <button onClick={saveAll}
              disabled={saving || items.length === 0 || Object.keys(invalidCells).length > 0}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold shadow-elevated disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} บันทึกคะแนน
            </button>

            {items.some(i => i.category === 'final') && (
              <button onClick={doPublish} disabled={publishing || published}
                className={`w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-70 ${
                  published ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning border border-warning/30'
                }`}>
                {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Megaphone className="w-3.5 h-3.5" />}
                {published ? 'ประกาศผลปลายภาคแล้ว' : 'ประกาศผลสอบปลายภาค'}
              </button>
            )}

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
                            const err = invalidCells[key];
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
      </div>
  );

  if (embedded) return body;
  return <MobileLayout title="คะแนนรวมทั้งหมด">{body}</MobileLayout>;
};

export default GradeManagementPage;
