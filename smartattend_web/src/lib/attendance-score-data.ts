import { supabase } from '@/integrations/supabase/client';

/** ที่มาของคะแนนการเข้าเรียนของนักศึกษาหนึ่งคน — ใช้อธิบายให้เห็นทุกตัวเลข */
export interface AttendanceScoreDetail {
  counted_sessions: number;
  cancelled_sessions: number;
  on_time: number;
  late: number;
  excused: number;
  absent: number;
  credit_sum: number;
  ratio: number | null;
  weight: number;
  earned: number;
  credits: { on_time: number; late: number; excused: number; absent: number };
  joined_at: string | null;
  withdrawn_at: string | null;
}

export async function fetchAttendanceDetail(
  componentId: string, studentId: string,
): Promise<AttendanceScoreDetail | null> {
  const { data, error } = await supabase.rpc('attendance_score_detail', {
    _component_id: componentId, _student_id: studentId,
  });
  if (error) { console.warn('fetchAttendanceDetail', error); return null; }
  return data as unknown as AttendanceScoreDetail;
}

export interface AttendancePreviewRow {
  student_id: string;
  name: string;
  code: string;
  on_time: number;
  late: number;
  excused: number;
  absent: number;
  counted_sessions: number;
  cancelled_sessions: number;
  ratio: number | null;
  earned: number | null;
  weight: number;
}

/** ตัวอย่างคะแนนของนักศึกษาจริงด้วยเกณฑ์ที่กำลังปรับ (ยังไม่บันทึก) */
export async function previewAttendanceScores(
  componentId: string,
  credits?: { on_time?: number; late?: number; excused?: number; absent?: number },
  limit = 5,
): Promise<AttendancePreviewRow[]> {
  const { data, error } = await supabase.rpc('preview_attendance_scores', {
    _component_id: componentId,
    _credit_on_time: credits?.on_time ?? undefined,
    _credit_late: credits?.late ?? undefined,
    _credit_excused: credits?.excused ?? undefined,
    _credit_absent: credits?.absent ?? undefined,
    _limit: limit,
  });
  if (error) { console.warn('previewAttendanceScores', error); return []; }
  return (data ?? []) as unknown as AttendancePreviewRow[];
}

export interface RecalcResult {
  updated: number;
  skipped: number;
  skipped_names: string[];
  grade_item_id: string;
  credits: { on_time: number; late: number; excused: number; absent: number };
}

/** คำนวณคะแนนการเข้าเรียนลงตารางคะแนน คืนรายงานสามกลุ่ม */
export async function recalcAttendanceScores(courseId: string) {
  const { data, error } = await supabase.rpc('recalc_attendance_scores', { _course_id: courseId });
  return { result: (data ?? null) as unknown as RecalcResult | null, error };
}

export interface CriteriaImpact {
  closed_sessions: number;
  affected_students: number;
  has_recorded_scores: boolean;
}

/** แก้เกณฑ์แล้วกระทบใครบ้าง — ใช้เตือนก่อนบันทึก */
export async function fetchCriteriaImpact(componentId: string): Promise<CriteriaImpact | null> {
  const { data, error } = await supabase.rpc('attendance_criteria_impact', {
    _component_id: componentId,
  });
  if (error) { console.warn('fetchCriteriaImpact', error); return null; }
  return data as unknown as CriteriaImpact;
}

/** ยกเลิกคาบเรียน — ต้องระบุเหตุผล และเลือกว่าจะทำอย่างไรกับระเบียนที่มีอยู่ */
export async function cancelClassSession(params: {
  sessionId: string;
  reason: string;
  records: 'keep' | 'delete';
  makeupStart?: string | null;
  makeupEnd?: string | null;
}) {
  return supabase.rpc('cancel_class_session', {
    _session_id: params.sessionId,
    _reason: params.reason,
    _records: params.records,
    _makeup_start: params.makeupStart ?? undefined,
    _makeup_end: params.makeupEnd ?? undefined,
  });
}

/** สรุปสถานะการเข้าเรียนเป็นข้อความไทยที่อ่านรู้เรื่อง ใช้ทั้งฝั่งอาจารย์และนักศึกษา */
export function describeAttendance(d: AttendanceScoreDetail): string {
  const parts = [
    `ตรงเวลา ${d.on_time}`,
    `สาย ${d.late}`,
    `ลา ${d.excused}`,
    `ขาด ${d.absent}`,
  ];
  let s = `${parts.join(' · ')} จาก ${d.counted_sessions} คาบที่นับ`;
  if (d.cancelled_sessions > 0) s += ` (ยกเลิก ${d.cancelled_sessions} คาบ ไม่นับ)`;
  if (d.ratio != null) {
    s += ` — คิดเป็น ${d.earned.toFixed(2)} จาก ${d.weight} คะแนน`;
  }
  return s;
}
