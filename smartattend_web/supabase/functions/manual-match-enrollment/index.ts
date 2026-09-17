import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ ok: false, error: 'unauthorized' }, 401);
    const callerId = userData.user.id;

    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', callerId);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isAdmin = roleSet.has('admin');
    if (!roleSet.has('instructor') && !isAdmin) return json({ ok: false, error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'search') {
      const q = String(body.q ?? '').trim();
      if (q.length < 2) return json({ ok: true, results: [] });
      const digits = normalize(q);
      let query = admin.from('profiles').select('user_id, name, email, student_code').limit(20);
      if (digits.length >= 3) {
        query = query.ilike('student_code', `%${digits}%`);
      } else {
        query = query.ilike('name', `%${q}%`);
      }
      const { data, error } = await query;
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true, results: data ?? [] });
    }

    if (action === 'match') {
      const enrollmentId = String(body.enrollmentId ?? '');
      const studentId = String(body.studentId ?? '');
      if (!enrollmentId || !studentId) return json({ ok: false, error: 'invalid_input' }, 400);

      // Load enrollment + course, verify ownership
      const { data: enr, error: enrErr } = await admin
        .from('course_enrollments')
        .select('id, course_id, student_code_raw')
        .eq('id', enrollmentId)
        .single();
      if (enrErr || !enr) return json({ ok: false, error: 'enrollment_not_found' }, 404);

      const { data: course } = await admin
        .from('courses')
        .select('id, code, name, instructor_id')
        .eq('id', enr.course_id)
        .single();
      if (!course) return json({ ok: false, error: 'course_not_found' }, 404);
      if (!isAdmin && course.instructor_id !== callerId) return json({ ok: false, error: 'forbidden' }, 403);

      const { error: upErr } = await admin
        .from('course_enrollments')
        .update({ student_id: studentId, status: 'pending' })
        .eq('id', enrollmentId);
      if (upErr) return json({ ok: false, error: upErr.message }, 400);

      await admin.from('notifications').insert({
        user_id: studentId,
        type: 'course_invite',
        title: 'คำเชิญเข้าร่วมวิชา',
        body: `อาจารย์เพิ่มคุณเข้าวิชา ${course.code} ${course.name} กรุณายืนยัน`,
        related_id: course.id,
        action_required: true,
      });

      try {
        await admin.from('audit_logs').insert({
          actor_id: callerId,
          actor_role: isAdmin ? 'admin' : 'instructor',
          action: 'manual_match_enrollment',
          target: 'course_enrollment',
          target_id: enrollmentId,
          detail: JSON.stringify({
            courseCode: course.code,
            studentCode: enr.student_code_raw,
            matchedStudentId: studentId,
          }),
        });
      } catch (logErr) {
        console.error('audit log failed (manual_match_enrollment):', logErr);
      }

      return json({ ok: true });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('manual-match-enrollment error:', e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});
