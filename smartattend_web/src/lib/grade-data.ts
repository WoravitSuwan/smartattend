import { supabase } from '@/integrations/supabase/client';

export type GradeCategory = 'attendance' | 'assignment' | 'midterm' | 'final' | 'other';

export interface GradeItem {
  id: string;
  course_id: string;
  name: string;
  category: GradeCategory;
  max_score: number;
  weight: number;
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

/** Thai university letter grade from a 0-100 weighted total. */
export function letterGrade(total: number): string {
  if (total >= 80) return 'A';
  if (total >= 75) return 'B+';
  if (total >= 70) return 'B';
  if (total >= 65) return 'C+';
  if (total >= 60) return 'C';
  if (total >= 55) return 'D+';
  if (total >= 50) return 'D';
  return 'F';
}

export function gradePoint(g: string): number {
  const map: Record<string, number> = { A: 4, 'B+': 3.5, B: 3, 'C+': 2.5, C: 2, 'D+': 1.5, D: 1, F: 0 };
  return map[g] ?? 0;
}

export function gradeColor(g: string): string {
  if (g === 'A') return 'text-success';
  if (g.startsWith('B')) return 'text-primary';
  if (g.startsWith('C')) return 'text-warning';
  return 'text-destructive';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function fetchGradeItems(courseId: string): Promise<GradeItem[]> {
  const { data, error } = await (supabase as any)
    .from('grade_items').select('*').eq('course_id', courseId).order('created_at');
  if (error) { console.error('fetchGradeItems', error); return []; }
  return (data ?? []) as GradeItem[];
}

export async function fetchStudentGrades(itemIds: string[], studentId?: string): Promise<StudentGrade[]> {
  if (itemIds.length === 0) return [];
  let q = (supabase as any).from('student_grades').select('*').in('grade_item_id', itemIds);
  if (studentId) q = q.eq('student_id', studentId);
  const { data, error } = await q;
  if (error) { console.error('fetchStudentGrades', error); return []; }
  return (data ?? []) as StudentGrade[];
}

/** Upserts a student's score through the audited RPC (records who/old/new/
 *  when, plus an optional reason) instead of writing student_grades
 *  directly — every correction gets a paper trail. */
export async function upsertGrade(
  gradeItemId: string, studentId: string, score: number | null,
  note?: string | null, reason?: string | null,
) {
  return supabase.rpc('upsert_student_grade', {
    _grade_item_id: gradeItemId,
    _student_id: studentId,
    _score: score,
    _note: note ?? undefined,
    _reason: reason ?? undefined,
  });
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

export interface WeightedResult {
  /** คะแนนที่ได้จริง มีหน่วยเป็น "คะแนนของวิชา" — เทียบกับ usedWeight ไม่ใช่ 100
   *  ยังไม่ปัดเศษ ให้หน้าจอปัดตอนแสดงผลเท่านั้น */
  earned: number;
  /** ผลรวมน้ำหนัก (%) ของหัวข้อที่ตรวจแล้ว = ตัวหารที่ถูกต้องของ earned */
  usedWeight: number;
  /** ผลรวมน้ำหนัก (%) ของหัวข้อทั้งหมดที่อาจารย์ตั้งไว้ */
  declaredWeight: number;
  /** earned ÷ usedWeight × 100 — ร้อยละของ "ส่วนที่ตรวจแล้ว"
   *  null = ยังไม่มีคะแนนเลย (ยังไม่มีอะไรให้คิดร้อยละ) */
  normalized: number | null;
  /** หัวข้อที่ข้ามเพราะคะแนนเต็มใช้คำนวณไม่ได้ — ให้หน้าจอเตือนอาจารย์ */
  invalidItems: string[];
}

/**
 * คะแนนถ่วงน้ำหนักของนักศึกษาหนึ่งคนในรายวิชาหนึ่ง
 *
 * กฎที่ต้องไม่พลาด
 *   - หัวข้อที่ยังไม่ตรวจ (score = null) ไม่ถูกนับเป็น 0 และไม่ถูกนับในตัวหาร
 *     ถ้านับ ต้นเทอมทุกคนจะกลายเป็น F ทั้งห้อง
 *   - หัวข้อที่ถูก RLS ปิดบัง (เช่นคะแนนปลายภาคก่อนประกาศผล) มาถึงที่นี่เป็น
 *     null เหมือนกัน จึงไม่ถูกนับใน usedWeight โดยอัตโนมัติ
 *   - score = 0 คือ "ตรวจแล้วได้ศูนย์" ต่างจาก null คือ "ยังไม่ตรวจ" เด็ดขาด
 *   - ไม่ปัดเศษระหว่างสะสมผลรวม ปัดเฉพาะตอนแสดงผล
 */
export function weightedTotal(
  items: GradeItem[], scoreOf: (itemId: string) => number | null,
): WeightedResult {
  let earned = 0;
  let usedWeight = 0;
  let declaredWeight = 0;
  const invalidItems: string[] = [];

  for (const it of items) {
    const w = Number(it.weight);
    if (!Number.isFinite(w) || w <= 0) continue;

    const max = maxScoreOf(it);
    if (max == null) {
      // คะแนนเต็มใช้คำนวณไม่ได้ — ข้ามทั้งตัวตั้งและตัวหาร แล้วรายงานกลับไป
      // ดีกว่าเดาเป็น 100 ซึ่งทำให้คะแนนของนักศึกษาผิดโดยไม่มีใครรู้
      invalidItems.push(it.name);
      continue;
    }

    declaredWeight += w;

    const score = scoreOf(it.id);
    if (score == null) continue;   // null = ยังไม่ตรวจ (ไม่ใช่ 0)

    earned += (score / max) * w;
    usedWeight += w;
  }

  return {
    earned,
    usedWeight,
    declaredWeight,
    normalized: usedWeight > 0 ? (earned / usedWeight) * 100 : null,
    invalidItems,
  };
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

/** น้ำหนักที่ตรวจแล้วครบ 100 หรือยัง (เผื่อความคลาดเคลื่อนของทศนิยม) */
export function isFullyGraded(r: Pick<WeightedResult, 'usedWeight'>): boolean {
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
  r: Pick<WeightedResult, 'usedWeight'>, finalPublished: boolean,
): boolean {
  return isFullyGraded(r) && finalPublished;
}

/** Auto attendance score (0..max) derived from the attendance summary view. */
export function attendanceScore(rate: number | null, maxScore: number): number {
  const r = Math.max(0, Math.min(100, Number(rate ?? 0)));
  return Math.round((r / 100) * maxScore * 100) / 100;
}

/** สร้าง/แก้ไขหัวข้อคะแนน ผ่าน RPC ที่ตรวจสิทธิ์และบันทึก audit log ให้
 *  ส่ง itemId มาด้วย = แก้ไขหัวข้อเดิม, ไม่ส่ง = สร้างใหม่ */
export async function saveGradeItem(params: {
  courseId: string;
  itemId?: string | null;
  name: string;
  category: GradeCategory;
  maxScore: number;
  weight: number;
}) {
  return supabase.rpc('save_grade_item', {
    _course_id: params.courseId,
    _item_id: params.itemId ?? undefined,
    _name: params.name,
    _category: params.category,
    _max_score: params.maxScore,
    _weight: params.weight,
  });
}

/** ลบหัวข้อคะแนน ผ่าน RPC ที่ตรวจสิทธิ์และบันทึก audit log
 *  คืนจำนวนคะแนนนักศึกษาที่ถูกลบไปพร้อมกัน */
export async function deleteGradeItem(itemId: string, reason?: string | null) {
  return supabase.rpc('delete_grade_item', {
    _item_id: itemId,
    _reason: reason ?? undefined,
  });
}
