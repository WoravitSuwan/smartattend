// Registration/training status shared between student and admin (cloud + realtime)
import { supabase } from '@/integrations/supabase/client';

export type RegStatusValue =
  | 'pending_registration' // รอนักศึกษาถ่ายรูป
  | 'pending_training'     // ถ่ายรูปแล้ว รอแอดมินเทรน
  | 'training_failed'      // เทรนไม่สำเร็จ (พร้อมเหตุผล)
  | 'training_success';    // เทรนสำเร็จ พร้อมเข้าสู่ระบบ

export interface RegistrationStatus {
  id: string;
  userId: string;
  studentCode: string | null;
  studentName: string;
  status: RegStatusValue;
  failureReason: string | null;
  trainedRunId: string | null;
  trainedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  user_id: string;
  student_code: string | null;
  student_name: string;
  status: string;
  failure_reason: string | null;
  trained_run_id: string | null;
  trained_at: string | null;
  created_at: string;
  updated_at: string;
}

const mapRow = (r: Row): RegistrationStatus => ({
  id: r.id,
  userId: r.user_id,
  studentCode: r.student_code,
  studentName: r.student_name,
  status: r.status as RegStatusValue,
  failureReason: r.failure_reason,
  trainedRunId: r.trained_run_id,
  trainedAt: r.trained_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** The signed-in student's own status row (null = never registered). */
export async function getCurrentAuthUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/** The signed-in student's own status row (null = never registered). */
export async function fetchMyRegStatus(userId: string): Promise<RegistrationStatus | null> {
  const { data, error } = await supabase
    .from('registration_statuses')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Student-side: create/refresh own row (allowed statuses only). Clears any previous failure. */
export async function upsertMyRegStatus(input: {
  userId: string;
  studentCode: string | null;
  studentName: string;
  status: 'pending_registration' | 'pending_training';
}): Promise<RegistrationStatus> {
  const { data, error } = await supabase
    .from('registration_statuses')
    .upsert({
      user_id: input.userId,
      student_code: input.studentCode,
      student_name: input.studentName,
      status: input.status,
      failure_reason: null,
      trained_run_id: null,
      trained_at: null,
    }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

/** Admin-side: record the training result for a student (RLS admin-only). */
export async function setRegStatusAsAdmin(
  userId: string,
  status: 'training_success' | 'training_failed',
  failureReason?: string | null,
  runId?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('registration_statuses')
    .update({
      status,
      failure_reason: status === 'training_failed' ? (failureReason ?? 'ไม่ทราบสาเหตุ') : null,
      trained_run_id: runId ?? null,
      trained_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw error;
}

/** Admin-side: every student's status (queue ordered by submission time). */
export async function fetchAllRegStatuses(): Promise<RegistrationStatus[]> {
  const { data, error } = await supabase
    .from('registration_statuses')
    .select('*')
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Realtime subscription — fires on any change (optionally scoped to one user). Returns unsubscribe. */
export function subscribeRegStatuses(onChange: () => void, userId?: string): () => void {
  const channel = supabase
    .channel(`reg-statuses-${userId ?? 'all'}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'registration_statuses',
        ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
      },
      () => onChange(),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
