import { supabase } from '@/integrations/supabase/client';

export interface BlankCell {
  student_name: string;
  student_code: string;
  component: string;
  item: string;
}

export interface SpecialGradeSuggestion {
  student_id: string;
  name: string;
  code: string;
  grade: string;
  source: 'incomplete' | 'withdrawn' | 'absence_blocked' | 'manual';
  why: string;
}

export interface PublishReadiness {
  total_weight: number;
  weight_ok: boolean;
  blank_count: number;
  blanks: BlankCell[];
  blanks_truncated: boolean;
  suggested_special: SpecialGradeSuggestion[];
  ready: boolean;
}

/** ตรวจว่าพร้อมประกาศผลหรือยัง — ช่องว่างกี่ช่อง ใครบ้าง ใครควรได้ I หรือ W */
export async function fetchPublishReadiness(courseId: string): Promise<PublishReadiness | null> {
  const { data, error } = await supabase.rpc('publish_readiness', { _course_id: courseId });
  if (error) { console.warn('fetchPublishReadiness', error); return null; }
  return data as unknown as PublishReadiness;
}

export interface SpecialGradeInput {
  student_id: string;
  grade: string;
  source: SpecialGradeSuggestion['source'];
  reason?: string | null;
}

/** ประกาศผล — force = ยืนยันประกาศทั้งที่คะแนนยังไม่ครบ (ต้องมีเหตุผล) */
export async function publishFinalGrades(params: {
  courseId: string;
  force?: boolean;
  reason?: string | null;
  special?: SpecialGradeInput[];
}) {
  return supabase.rpc('publish_final_grades', {
    _course_id: params.courseId,
    _force: params.force ?? false,
    _reason: params.reason ?? undefined,
    _special: (params.special ?? []) as unknown as never,
  });
}

export async function unlockCourseGrades(courseId: string, reason: string) {
  return supabase.rpc('unlock_course_grades', { _course_id: courseId, _reason: reason });
}

export async function relockCourseGrades(courseId: string) {
  return supabase.rpc('relock_course_grades', { _course_id: courseId });
}

export const gradeSourceLabels: Record<string, string> = {
  computed: 'คิดจากคะแนน',
  incomplete: 'I — ผลการเรียนไม่สมบูรณ์',
  withdrawn: 'W — ถอนรายวิชา',
  absence_blocked: 'F — ขาดเรียนเกินเกณฑ์',
  manual: 'อาจารย์กำหนดเอง',
};
