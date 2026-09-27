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

/** คะแนนเต็มของหัวข้อ — ใช้ 100 เฉพาะเมื่อค่าใช้ไม่ได้จริง (ว่าง/ติดลบ/ไม่ใช่ตัวเลข)
 *  ห้ามใช้ `Number(x) || 100` เพราะคะแนนเต็ม 0 จะถูกเปลี่ยนเป็น 100 เงียบ ๆ */
export function maxScoreOf(item: Pick<GradeItem, 'max_score'>): number {
  const n = Number(item.max_score);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

export interface WeightedResult {
  /** คะแนนที่ได้ เทียบกับ 100 คะแนนเต็มของวิชา — หัวข้อที่ยังไม่ตรวจนับเป็น 0 */
  total: number;
  /** ผลรวมน้ำหนัก (%) ของหัวข้อที่มีคะแนนแล้ว */
  usedWeight: number;
  /** ผลรวมน้ำหนัก (%) ของหัวข้อทั้งหมดที่อาจารย์ตั้งไว้ */
  declaredWeight: number;
  /**
   * เปอร์เซ็นต์ "เฉพาะส่วนที่ตรวจแล้ว" = total ÷ usedWeight × 100
   * นี่คือตัวเลขที่ใช้เทียบเกรด ถ้าเอา total ไปเทียบตรง ๆ ทั้งห้องจะได้ F
   * ตอนต้นเทอมเพราะน้ำหนักที่เหลือยังไม่ถูกตรวจ  null = ยังไม่มีคะแนนเลย
   */
  percentOfGraded: number | null;
  /** true เมื่อทุกหัวข้อที่มีน้ำหนักถูกตรวจครบแล้ว (เกรดนิ่งแล้ว) */
  complete: boolean;
}

/**
 * Weighted total for one student across the course grade items.
 * Items with weight 0 are ignored so partial setups don't distort the total.
 */
export function weightedTotal(
  items: GradeItem[], scoreOf: (itemId: string) => number | null,
): WeightedResult {
  let total = 0;
  let usedWeight = 0;
  let declaredWeight = 0;
  for (const it of items) {
    const w = Number(it.weight) || 0;
    if (w <= 0) continue;
    declaredWeight += w;
    const s = scoreOf(it.id);
    if (s == null) continue;
    const max = maxScoreOf(it);
    total += (s / max) * w;
    usedWeight += w;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    total: round2(total),
    usedWeight: round2(usedWeight),
    declaredWeight: round2(declaredWeight),
    percentOfGraded: usedWeight > 0 ? round2((total / usedWeight) * 100) : null,
    complete: declaredWeight > 0 && usedWeight >= declaredWeight - 0.01,
  };
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
