import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    // User client — only used to identify the caller.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const instructorId = userData.user.id;

    // Fresh service client — no auth header carry-over.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const course_id = String(body.course_id ?? '');
    const late_after_minutes = Math.max(1, Math.min(120, Number(body.late_after_minutes) || 15));
    const duration_minutes = Math.max(5, Math.min(360, Number(body.duration_minutes) || 60));
    if (!course_id) {
      return new Response(JSON.stringify({ error: 'course_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify instructor owns this course.
    const { data: course, error: courseErr } = await admin
      .from('courses')
      .select('id, code, name, section, instructor_id')
      .eq('id', course_id)
      .maybeSingle();
    if (courseErr) throw new Error(`course lookup failed: ${courseErr.message}`);
    if (!course) throw new Error('course not found');
    if (course.instructor_id !== instructorId) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Close any existing open session for this course.
    const nowIso = new Date().toISOString();
    const { error: closeErr } = await admin
      .from('class_sessions')
      .update({ status: 'closed', closed_at: nowIso })
      .eq('course_id', course_id)
      .eq('status', 'open');
    if (closeErr) throw new Error(`close previous sessions failed: ${closeErr.message}`);

    // Insert new session.
    const started = new Date();
    const plannedEnd = new Date(started.getTime() + duration_minutes * 60_000);
    const { data: sess, error: insErr } = await admin
      .from('class_sessions')
      .insert({
        course_id,
        instructor_id: instructorId,
        status: 'open',
        late_after_minutes,
        planned_end_time: plannedEnd.toISOString(),
      })
      .select()
      .single();
    if (insErr) throw new Error(`create session failed: ${insErr.message}`);

    // Load confirmed enrollments.
    const { data: enrolls, error: enrErr } = await admin
      .from('course_enrollments')
      .select('student_id')
      .eq('course_id', course_id)
      .eq('status', 'confirmed');
    if (enrErr) throw new Error(`load enrollments failed: ${enrErr.message}`);

    const studentIds = (enrolls ?? []).map(e => e.student_id).filter(Boolean);
    let notified_count = 0;
    if (studentIds.length) {
      const rows = studentIds.map(sid => ({
        user_id: sid,
        type: 'class_started',
        title: 'คลาสเริ่มแล้ว',
        body: `กดเพื่อเข้าคลาส ${course.code} ${course.name} ตอนนี้`,
        related_id: sess.id,
        action_required: true,
        status: 'unread',
      }));
      const { error: notifErr, count } = await admin
        .from('notifications')
        .insert(rows, { count: 'exact' });
      if (notifErr) throw new Error(`notify students failed: ${notifErr.message}`);
      notified_count = count ?? studentIds.length;
    }

    return new Response(JSON.stringify({ session: sess, notified_count }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
