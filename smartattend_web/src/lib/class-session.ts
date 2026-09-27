import { supabase } from '@/integrations/supabase/client';

/** เปิดคาบเรียนทันที คืนแถวคาบที่เพิ่งเปิด */
export async function startClassSession(params: {
  courseId: string;
  lateAfterMinutes: number;
  durationMinutes: number;
}) {
  const { data, error } = await supabase.functions.invoke('start-class-session', {
    body: {
      course_id: params.courseId,
      late_after_minutes: params.lateAfterMinutes,
      duration_minutes: params.durationMinutes,
    },
  });
  if (error) throw error;
  if (!data?.session) throw new Error(data?.error ?? 'ไม่สามารถเริ่มคลาสได้');
  return data as { session: Record<string, unknown>; notified_count?: number };
}

/** ปิดคาบเรียน พร้อมบันทึก "ขาดเรียน" ให้ทุกคนที่ยืนยันเข้าร่วมวิชาแต่ไม่ได้สแกน
 *  คืนจำนวนคนที่ถูกบันทึกว่าขาด */
export async function closeClassSession(sessionId: string, courseId: string): Promise<number> {
  const { data: enrolled } = await supabase
    .from('course_enrollments')
    .select('student_id')
    .eq('course_id', courseId)
    .eq('status', 'confirmed')
    .not('student_id', 'is', null);

  const { data: existing } = await supabase
    .from('attendance_records')
    .select('student_id')
    .eq('session_id', sessionId);

  const present = new Set((existing ?? []).map(r => r.student_id));
  const absentRows = (enrolled ?? [])
    .map(e => e.student_id as string)
    .filter(id => id && !present.has(id))
    .map(id => ({
      session_id: sessionId,
      student_id: id,
      status: 'absent',
      checked_in_at: null,
      photo_data_url: null,
      confidence: 0,
    }));

  if (absentRows.length > 0) {
    const { error } = await supabase.from('attendance_records').insert(absentRows);
    if (error) throw error;
  }

  const { error: upErr } = await supabase
    .from('class_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (upErr) throw upErr;

  return absentRows.length;
}
