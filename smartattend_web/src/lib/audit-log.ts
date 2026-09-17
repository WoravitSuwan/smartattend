import { supabase } from '@/integrations/supabase/client';

export type AuditAction =
  | 'user.delete'
  | 'user.create'
  | 'user.invite'
  | 'user.invite.revoke'
  | 'user.invite.resend'
  | 'grade.update'
  | 'attendance.manual_edit'
  | 'edit_attendance'
  | 'attendance.flagged_liveness'
  | 'leave.submit'
  | 'leave.approve'
  | 'leave.reject'
  | 'grade.announce'
  | 'training.failed'
  | 'training.run'
  | 'login';

export interface AuditPayload {
  action: AuditAction;
  target?: string;
  targetId?: string;
  detail?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/** Best-effort audit log write. Never throws — auditing must not break user flows.
 * Actor identity/role are derived server-side by the log_audit_event SECURITY DEFINER
 * function to prevent spoofing. */
export async function logAudit(p: AuditPayload): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('log_audit_event', {
      _action: p.action,
      _target: p.target ?? null,
      _target_id: p.targetId ?? null,
      _detail: p.detail ?? null,
      _before: (p.before ?? null) as unknown,
      _after: (p.after ?? null) as unknown,
      _reason: p.reason ?? null,
    });
    if (error) console.warn('[audit] rpc failed', error);
  } catch (e) {
    console.warn('[audit] insert failed', e);
  }
}
