import { supabase } from '@/integrations/supabase/client';

export type SubmissionStatus = 'submitted' | 'graded' | 'late';

export interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  max_score: number;
  created_at: string;
  attachment_path: string | null;
  attachment_name: string | null;
  courseCode?: string;
  courseName?: string;
}

export interface SubmissionRow {
  id: string;
  assignment_id: string;
  student_id: string;
  content: string | null;
  file_path: string | null;
  submitted_at: string;
  score: number | null;
  feedback: string | null;
  status: SubmissionStatus;
  graded_at: string | null;
  studentName?: string;
  studentCode?: string;
}

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'zip', 'rar', 'txt'];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return 'ไม่กำหนด';
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function fetchAssignments(courseIds: string[]): Promise<AssignmentRow[]> {
  if (courseIds.length === 0) return [];
  const { data, error } = await (supabase as any)
    .from('assignments')
    .select('id, course_id, title, description, due_at, max_score, created_at, attachment_path, attachment_name, courses!inner ( code, name )')
    .in('course_id', courseIds)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) { console.error('fetchAssignments', error); return []; }
  return (data ?? []).map((r: any) => ({ ...r, courseCode: r.courses?.code ?? '', courseName: r.courses?.name ?? '' }));
}

export async function fetchMySubmissions(studentId: string, assignmentIds: string[]): Promise<SubmissionRow[]> {
  if (assignmentIds.length === 0) return [];
  const { data, error } = await (supabase as any)
    .from('assignment_submissions').select('*')
    .eq('student_id', studentId).in('assignment_id', assignmentIds);
  if (error) { console.error('fetchMySubmissions', error); return []; }
  return (data ?? []) as SubmissionRow[];
}

export async function fetchAssignmentSubmissions(assignmentId: string): Promise<SubmissionRow[]> {
  const { data, error } = await (supabase as any)
    .from('assignment_submissions').select('*')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: true });
  if (error) { console.error('fetchAssignmentSubmissions', error); return []; }
  const rows = (data ?? []) as SubmissionRow[];
  const ids = Array.from(new Set(rows.map(r => r.student_id)));
  if (ids.length > 0) {
    const { data: profs } = await (supabase as any)
      .from('profiles').select('user_id, name, student_code').in('user_id', ids);
    const map = new Map<string, any>((profs ?? []).map((p: any) => [p.user_id, p]));
    rows.forEach(r => {
      r.studentName = map.get(r.student_id)?.name ?? 'นักศึกษา';
      r.studentCode = map.get(r.student_id)?.student_code ?? '';
    });
  }
  return rows;
}

export async function uploadSubmissionFile(userId: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('assignment-files').upload(path, file);
  if (error) { console.error('uploadSubmissionFile', error); return null; }
  return path;
}

/** Same bucket/path convention as a student's submission — an instructor
 * uploading to their own uid folder is already covered by the same
 * storage policy, just used here for the assignment's own reference file
 * instead of what a student sends back. */
export const uploadAssignmentAttachment = uploadSubmissionFile;

export async function getSubmissionFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('assignment-files').createSignedUrl(path, 300);
  if (error) { console.error('getSubmissionFileUrl', error); return null; }
  return data?.signedUrl ?? null;
}
