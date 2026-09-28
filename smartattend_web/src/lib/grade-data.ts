import { supabase } from '@/integrations/supabase/client';

export type GradeCategory = 'attendance' | 'assignment' | 'midterm' | 'final' | 'other';

/**
 * รายการคะแนนหนึ่งรายการ
 *
 * ⚠️ ไม่มีฟิลด์ weight โดยเจตนา — คอลัมน์ grade_items.weight เลิกใช้แล้ว
 * น้ำหนักอยู่ที่ grade_components.weight_percent (ระดับหมวด) และ
 * grade_items.weight_in_component (ระดับรายการ ในโหมด weighted_items)
 * ถ้าโค้ดที่ไหนพยายามอ่าน it.weight จะเป็น error ตอนคอมไพล์ ซึ่งเป็นสิ่งที่ต้องการ
 *
 * ชนิดที่ครบกว่าสำหรับงานโครงสร้างคะแนนคือ StructureItem ใน lib/grade-structure.ts
 */
export interface GradeItem {
  id: string;
  course_id: string;
  name: string;
  category: GradeCategory;
  max_score: number;
  created_at: string;
}

export interface StudentGrade {
  id: string;
  grade_item_id: string;
  student_id: string;
  score: number | null;
  note: string | null;
  updated_at: string;
}

export const categoryLabels: Record<GradeCategory, string> = {
  attendance: 'เข้าเรียน',
  assignment: 'งาน/ใบงาน',
  midterm: 'สอบกลางภาค',
  final: 'สอบปลายภาค',
  other: 'อื่นๆ',
};

/** หนึ่งระดับของเกณฑ์ตัดเกรด */
export interface GradeScaleRow {
  grade: string;
  /** คะแนนขั้นต่ำ (0-100) ที่ได้เกรดนี้ */
  min_score: number;
  /** แต้มสำหรับคิด GPA */
  grade_point: number;
}

/**
 * เกณฑ์สำรองที่ใช้เมื่ออ่านจากฐานข้อมูลไม่ได้เท่านั้น
 *
 * ⚠️ นี่ไม่ใช่แหล่งความจริงของเกณฑ์ตัดเกรด แหล่งความจริงคือตาราง grade_scales
 * (แถว course_id IS NULL = ค่าเริ่มต้นของระบบ, แถวที่มี course_id = เกณฑ์ที่
 * อาจารย์กำหนดเองรายวิชา) ค่าที่นี่คัดลอกมาให้ตรงกับค่าเริ่มต้นที่ seed ไว้ใน
 * migration 20260927150000 เพื่อให้หน้าจอยังใช้งานได้ตอนเน็ตหลุดหรือ query ล้ม
 * ไม่ใช่เพื่อให้แก้ที่นี่ — ถ้าจะเปลี่ยนเกณฑ์ ต้องแก้ในฐานข้อมูล
 */
export const FALLBACK_GRADE_SCALE: GradeScaleRow[] = [
  { grade: 'A',  min_score: 80, grade_point: 4.0 },
  { grade: 'B+', min_score: 75, grade_point: 3.5 },
  { grade: 'B',  min_score: 70, grade_point: 3.0 },
  { grade: 'C+', min_score: 65, grade_point: 2.5 },
  { grade: 'C',  min_score: 60, grade_point: 2.0 },
  { grade: 'D+', min_score: 55, grade_point: 1.5 },
  { grade: 'D',  min_score: 50, grade_point: 1.0 },
  { grade: 'F',  min_score: 0,  grade_point: 0.0 },
];

/** อ่านเกณฑ์ที่มีผลจริงของรายวิชา — ของรายวิชาเองถ้ามี ไม่งั้นค่าเริ่มต้นของระบบ */
export async function fetchGradeScale(courseId: string): Promise<{
  scale: GradeScaleRow[]; isCourseSpecific: boolean; fromFallback: boolean;
}> {
  const { data, error } = await supabase.rpc('effective_grade_scale', { _course_id: courseId });
  if (error || !data || data.length === 0) {
    if (error) console.warn('fetchGradeScale — ใช้เกณฑ์สำรอง', error);
    return { scale: FALLBACK_GRADE_SCALE, isCourseSpecific: false, fromFallback: true };
  }
  const rows = (data as { grade: string; min_score: number; grade_point: number; is_course_specific: boolean }[])
    .map(r => ({ grade: r.grade, min_score: Number(r.min_score), grade_point: Number(r.grade_point) }))
    .sort((a, b) => b.min_score - a.min_score);
  return {
    scale: rows,
    isCourseSpecific: !!(data as { is_course_specific: boolean }[])[0]?.is_course_specific,
    fromFallback: false,
  };
}

/** ตัดเกรดจากเกณฑ์ที่ส่งเข้ามา — null เมื่อคะแนนต่ำกว่าทุกระดับในเกณฑ์ */
export function letterGradeFrom(scale: GradeScaleRow[], total: number): string | null {
  const hit = [...scale].sort((a, b) => b.min_score - a.min_score)
    .find(r => total >= r.min_score);
  return hit?.grade ?? null;
}

/** แต้ม GPA จากเกณฑ์ที่ส่งเข้ามา */
export function gradePointFrom(scale: GradeScaleRow[], grade: string): number {
  return scale.find(r => r.grade === grade)?.grade_point ?? 0;
}

/** บันทึกเกณฑ์ตัดเกรดของรายวิชา ส่ง [] เพื่อกลับไปใช้ค่าเริ่มต้นของระบบ */
export async function saveCourseGradeScale(
  courseId: string, rows: GradeScaleRow[], reason?: string | null,
) {
  return supabase.rpc('save_course_grade_scale', {
    _course_id: courseId,
    _rows: rows as unknown as never,
    _reason: reason ?? undefined,
  });
}

export function gradeColor(g: string): string {
  if (g === 'A') return 'text-success';
  if (g.startsWith('B')) return 'text-primary';
  if (g.startsWith('C')) return 'text-warning';
  return 'text-destructive';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function fetchStudentGrades(itemIds: string[], studentId?: string): Promise<StudentGrade[]> {
  if (itemIds.length === 0) return [];
  let q = (supabase as any).from('student_grades').select('*').in('grade_item_id', itemIds);
  if (studentId) q = q.eq('student_id', studentId);
  const { data, error } = await q;
  if (error) { console.error('fetchStudentGrades', error); return []; }
  return (data ?? []) as StudentGrade[];
}

export interface GradeSaveError {
  grade_item_id: string;
  student_id: string;
  reason: string;
}

export interface GradeSaveResult {
  ok: boolean;
  saved: number;
  errors: GradeSaveError[];
}

/**
 * บันทึกคะแนนทั้งชุดในทรานแซกชันเดียว
 *
 * ของเดิมใช้ Promise.all ยิงทีละช่อง ถ้าช่องที่ 40 ล้มเหลว ช่อง 1-39 ถูกบันทึก
 * ไปแล้ว หน้าจอกับฐานข้อมูลไม่ตรงกัน และผู้ใช้ไม่รู้ว่าช่องไหนพัง
 *
 * RPC ตรวจทุกแถวก่อนเขียน ถ้ามีแถวใดผิดจะคืนรายการที่ผิดทั้งหมดโดยยังไม่เขียน
 * อะไรเลย ถ้าเกิดข้อผิดพลาดตอนเขียน ทรานแซกชันทั้งก้อนถูก rollback
 */
export async function saveStudentGrades(
  courseId: string,
  changes: { grade_item_id: string; student_id: string; score: number | null; note?: string | null }[],
  reason?: string | null,
): Promise<{ result: GradeSaveResult | null; error: { message?: string } | null }> {
  const { data, error } = await supabase.rpc('save_student_grades', {
    _course_id: courseId,
    _changes: changes as unknown as never,
    _reason: reason ?? undefined,
  });
  if (error) return { result: null, error };
  const r = data as unknown as GradeSaveResult;
  return { result: r, error: null };
}

/** Publishes final exam scores + final grade for a course, revealing them
 *  to students (RLS masks 'final' category rows until this is called). */
export async function publishFinalGrades(courseId: string) {
  return supabase.rpc('publish_final_grades', { _course_id: courseId });
}

/** คะแนนเต็มของหัวข้อ
 *
 *  ห้ามใช้ `Number(x) || 100` — คะแนนเต็ม 0 จะถูกเปลี่ยนเป็น 100 เงียบ ๆ
 *  คืน null เมื่อค่าใช้คำนวณไม่ได้ (ว่าง / 0 / ติดลบ / ไม่ใช่ตัวเลข) เพื่อให้
 *  ผู้เรียกตัดสินใจเองว่าจะข้ามหัวข้อนั้นหรือแจ้งเตือน ไม่ใช่แอบเดาเป็น 100
 */
export function maxScoreOf(item: Pick<GradeItem, 'max_score'>): number | null {
  const n = Number(item.max_score);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * ตรวจว่าคะแนนที่กรอกใช้ได้หรือไม่ คืนข้อความภาษาไทย หรือ null เมื่อใช้ได้
 *
 * ใช้ตัวเดียวกันทั้งตอนพิมพ์และตอนกดบันทึก และมีการตรวจชุดเดียวกันอยู่ใน
 * RPC upsert_student_grade ด้วย เพราะแอตทริบิวต์ max ของ <input type="number">
 * ไม่ได้ห้ามพิมพ์หรือวางค่าเกิน และการยิง REST ตรงข้ามหน้าจอได้ทั้งหมด
 *
 *   null/undefined = ยังไม่กรอก ถือว่าใช้ได้ (ไม่ใช่ 0)
 */
export function validateScore(
  item: Pick<GradeItem, 'max_score'>, value: number | null | undefined,
): string | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return 'ไม่ใช่ตัวเลข';
  const max = maxScoreOf(item);
  if (max == null) return 'หัวข้อนี้ยังตั้งคะแนนเต็มไม่ถูกต้อง';
  if (value < 0) return 'ติดลบไม่ได้';
  if (value > max) return `เกินคะแนนเต็ม (${max})`;
  return null;
}

/** น้ำหนักที่ตรวจแล้วครบ 100 หรือยัง (เผื่อความคลาดเคลื่อนของทศนิยม)
 *  รับอะไรก็ได้ที่มี usedWeight — ปัจจุบันคือ CourseScore จาก lib/grade-structure */
export function isFullyGraded(r: { usedWeight: number }): boolean {
  return r.usedWeight >= 99.99;
}

/**
 * แสดงตัวอักษรเกรดได้หรือยัง
 *
 * เงื่อนไขสองข้อต้องครบทั้งคู่
 *   1. ตรวจครบน้ำหนัก 100 แล้ว — ไม่งั้นเกรดที่เห็นคิดจากคะแนนแค่บางส่วน
 *   2. อาจารย์ประกาศผลแล้ว — ก่อนประกาศ คะแนนปลายภาคถูกปิดบังอยู่
 *      เกรดที่คำนวณได้จึงไม่ใช่เกรดจริง
 */
export function canShowLetterGrade(
  r: { usedWeight: number }, finalPublished: boolean,
): boolean {
  return isFullyGraded(r) && finalPublished;
}

/** วิธีจัดการคะแนนที่เกินคะแนนเต็มใหม่เมื่อลดคะแนนเต็มของหัวข้อ */
export type OverflowPolicy =
  /** ปฏิเสธการแก้ไข ให้อาจารย์ตัดสินใจก่อน (ค่าเริ่มต้น) */
  | 'reject'
  /** ปรับคะแนนทุกคนตามอัตราส่วน รักษาลำดับที่และสัดส่วนไว้ */
  | 'rescale'
  /** ตัดเฉพาะคนที่เกินให้เท่าเพดานใหม่ */
  | 'clamp';

/* saveGradeItem() ถูกถอดออกแล้ว — ใช้ saveComponentItems() ใน
   lib/grade-structure-data.ts แทน RPC เดิมเขียน grade_items.weight ที่เลิกใช้
   และไม่ตั้ง component_id ให้ รายการที่สร้างจึงไม่ถูกนับในคะแนน */

/** จำนวนคะแนนที่บันทึกไว้แล้วในหัวข้อหนึ่ง (ถามฐานข้อมูล ไม่นับจากที่โหลดมา
 *  เพราะหน้าจออาจโหลดมาไม่ครบทุกคน) */
export async function gradeItemScoreCount(itemId: string): Promise<number> {
  const { data, error } = await supabase.rpc('grade_item_score_count', { _item_id: itemId });
  if (error) { console.warn('gradeItemScoreCount', error); return 0; }
  return Number(data ?? 0);
}

/** ลบหัวข้อคะแนน ผ่าน RPC ที่ตรวจสิทธิ์และบันทึก audit log
 *  หัวข้อที่มีคะแนนอยู่แล้ว ต้องส่ง confirmName ให้ตรงชื่อหัวข้อ
 *  คืนจำนวนคะแนนนักศึกษาที่ถูกลบไปพร้อมกัน */
export async function deleteGradeItem(
  itemId: string, reason?: string | null, confirmName?: string | null,
) {
  return supabase.rpc('delete_grade_item', {
    _item_id: itemId,
    _reason: reason ?? undefined,
    _confirm_name: confirmName ?? undefined,
  });
}
