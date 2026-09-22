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

/**
 * Weighted total (0-100) for one student across the course grade items.
 * Items with weight 0 are ignored so partial setups don't distort the total.
 */
export function weightedTotal(items: GradeItem[], scoreOf: (itemId: string) => number | null): {
  total: number; usedWeight: number;
} {
  let total = 0;
  let usedWeight = 0;
  for (const it of items) {
    const w = Number(it.weight) || 0;
    if (w <= 0) continue;
    const s = scoreOf(it.id);
    if (s == null) continue;
    const max = Number(it.max_score) || 100;
    total += (s / max) * w;
    usedWeight += w;
  }
  return { total: Math.round(total * 100) / 100, usedWeight };
}

/** Auto attendance score (0..max) derived from the attendance summary view. */
export function attendanceScore(rate: number | null, maxScore: number): number {
  const r = Math.max(0, Math.min(100, Number(rate ?? 0)));
  return Math.round((r / 100) * maxScore * 100) / 100;
}
