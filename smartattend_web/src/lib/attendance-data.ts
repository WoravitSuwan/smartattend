import { supabase } from '@/integrations/supabase/client';

export type AttStatus = 'on_time' | 'late' | 'absent';

export interface AttendanceRow {
  id: string;
  sessionId: string;
  studentId: string;
  status: AttStatus;
  confidence: number | null;
  photo: string | null;
  checkedInAt: string | null;
  editedBy: string | null;
  editedAt: string | null;
  editReason: string | null;
  courseId: string;
  courseCode: string;
  courseName: string;
  startedAt: string;
}

export interface SummaryRow {
  student_id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  on_time_count: number;
  late_count: number;
  absent_count: number;
  total_sessions: number;
  attendance_rate: number | null;
}

const SELECT = `id, session_id, student_id, status, confidence, photo_data_url, checked_in_at, edited_by, edited_at, edit_reason,
  class_sessions!inner ( id, started_at, course_id, instructor_id, courses!inner ( id, code, name ) )`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): AttendanceRow {
  const cs = r.class_sessions;
  const c = cs?.courses;
  return {
    id: r.id,
    sessionId: r.session_id,
    studentId: r.student_id,
    status: r.status,
    confidence: r.confidence,
    photo: r.photo_data_url,
    checkedInAt: r.checked_in_at,
    editedBy: r.edited_by ?? null,
    editedAt: r.edited_at ?? null,
    editReason: r.edit_reason ?? null,
    courseId: cs?.course_id,
    courseCode: c?.code ?? '',
    courseName: c?.name ?? '',
    startedAt: cs?.started_at,
  };
}

export async function fetchMyAttendance(studentId: string): Promise<AttendanceRow[]> {
  // Order by the class session's date, not checked_in_at: an absent row has
  // no check-in time at all, and Postgres sorts NULLs first on a DESC order
  // by default — every absence would otherwise float to the top of the
  // list ahead of real, recent check-ins.
  const { data, error } = await (supabase as any)
    .from('attendance_records')
    .select(SELECT)
    .eq('student_id', studentId)
    .order('started_at', { referencedTable: 'class_sessions', ascending: false });
  if (error) { console.error('fetchMyAttendance', error); return []; }
  return (data ?? []).map(mapRow);
}

export async function fetchSessionAttendance(sessionId: string): Promise<AttendanceRow[]> {
  const { data, error } = await (supabase as any)
    .from('attendance_records')
    .select(SELECT)
    .eq('session_id', sessionId)
    .order('checked_in_at', { ascending: true });
  if (error) { console.error('fetchSessionAttendance', error); return []; }
  return (data ?? []).map(mapRow);
}

export async function fetchSummary(filter: { studentId?: string; courseId?: string }): Promise<SummaryRow[]> {
  let q = (supabase as any).from('v_attendance_summary').select('*');
  if (filter.studentId) q = q.eq('student_id', filter.studentId);
  if (filter.courseId) q = q.eq('course_id', filter.courseId);
  const { data, error } = await q;
  if (error) { console.error('fetchSummary', error); return []; }
  return (data ?? []) as SummaryRow[];
}

export async function fetchInstructorCourses(instructorId: string) {
  const { data, error } = await supabase
    .from('courses')
    .select('id, code, name, section, semester')
    .eq('instructor_id', instructorId)
    .order('code');
  if (error) { console.error('fetchInstructorCourses', error); return []; }
  return data ?? [];
}

/** Courses the student is actually part of — confirmed only. A pending
 * invite or a declined/unmatched row must not show up as "my course"
 * anywhere (dashboard widgets, open-session checks, etc.); those live in
 * their own "รอการยืนยัน" section on the courses page until confirmed. */
export async function fetchEnrolledCourses(studentId: string) {
  const { data, error } = await (supabase as any)
    .from('course_enrollments')
    .select('status, courses!inner ( id, code, name, section, semester )')
    .eq('student_id', studentId)
    .eq('status', 'confirmed');
  if (error) { console.error('fetchEnrolledCourses', error); return []; }
  return (data ?? []).map((r: any) => ({ ...r.courses, enrollStatus: r.status }));
}

export const statusLabel: Record<AttStatus, string> = {
  on_time: 'ตรงเวลา',
  late: 'มาสาย',
  absent: 'ขาดเรียน',
};

export const statusClass: Record<AttStatus, string> = {
  on_time: 'bg-success text-success-foreground',
  late: 'bg-warning text-warning-foreground',
  absent: 'bg-destructive text-destructive-foreground',
};

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}
