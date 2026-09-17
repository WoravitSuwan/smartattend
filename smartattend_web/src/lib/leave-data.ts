import { supabase } from '@/integrations/supabase/client';

export type LeaveType = 'sick' | 'personal' | 'activity';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequestRow {
  id: string;
  student_id: string;
  course_id: string;
  session_id: string | null;
  leave_type: LeaveType;
  leave_date: string;
  reason: string;
  attachment_path: string | null;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  courseCode?: string;
  courseName?: string;
  studentName?: string;
  studentCode?: string;
}

export const leaveTypeLabels: Record<LeaveType, string> = {
  sick: '🏥 ลาป่วย',
  personal: '📋 ลากิจ',
  activity: '🎓 ลากิจกรรม',
};

export const leaveStatusLabels: Record<LeaveStatus, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
};

export const leaveStatusClass: Record<LeaveStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  rejected: 'bg-destructive/15 text-destructive',
};

export const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtDate(d: string | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const SELECT = `id, student_id, course_id, session_id, leave_type, leave_date, reason, attachment_path,
  status, reviewed_by, reviewed_at, review_note, created_at,
  courses!inner ( code, name )`;

function mapRow(r: any): LeaveRequestRow {
  return { ...r, courseCode: r.courses?.code ?? '', courseName: r.courses?.name ?? '' };
}

export async function fetchMyLeaves(studentId: string): Promise<LeaveRequestRow[]> {
  const { data, error } = await (supabase as any)
    .from('leave_requests')
    .select(SELECT)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) { console.error('fetchMyLeaves', error); return []; }
  return (data ?? []).map(mapRow);
}

export async function fetchInstructorLeaves(courseIds: string[]): Promise<LeaveRequestRow[]> {
  if (courseIds.length === 0) return [];
  const { data, error } = await (supabase as any)
    .from('leave_requests')
    .select(SELECT)
    .in('course_id', courseIds)
    .order('created_at', { ascending: false });
  if (error) { console.error('fetchInstructorLeaves', error); return []; }
  const rows: LeaveRequestRow[] = (data ?? []).map(mapRow);

  const ids = Array.from(new Set(rows.map(r => r.student_id)));
  if (ids.length > 0) {
    const { data: profs } = await (supabase as any)
      .from('profiles').select('user_id, name, student_code').in('user_id', ids);
    const map = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));
    rows.forEach(r => {
      const p = map.get(r.student_id);
      r.studentName = p?.name ?? 'นักศึกษา';
      r.studentCode = p?.student_code ?? '';
    });
  }
  return rows;
}

export async function uploadLeaveAttachment(userId: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('leave-attachments').upload(path, file);
  if (error) { console.error('uploadLeaveAttachment', error); return null; }
  return path;
}

export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('leave-attachments').createSignedUrl(path, 300);
  if (error) { console.error('getAttachmentUrl', error); return null; }
  return data?.signedUrl ?? null;
}

/** Find an open/closed session for the course on the given date so approval can excuse it. */
export async function findSessionForDate(courseId: string, date: string): Promise<string | null> {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59`);
  const { data } = await (supabase as any)
    .from('class_sessions')
    .select('id')
    .eq('course_id', courseId)
    .gte('started_at', start.toISOString())
    .lte('started_at', end.toISOString())
    .limit(1);
  return data?.[0]?.id ?? null;
}
