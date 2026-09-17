import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StudentRow { studentCode: string; studentCodeRaw?: string; studentName: string; }

// Normalize a student code — strip everything except digits, so "67543210014-6"
// and "675432100146" both normalize to "675432100146".
const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ ok: false, error: 'unauthorized' }, 401);
    const callerId = userData.user.id;

    const { data: roles } = await admin
      .from('user_roles').select('role').eq('user_id', callerId);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has('instructor') && !roleSet.has('admin')) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const courseCode = String(body.courseCode ?? '').trim();
    const courseName = String(body.courseName ?? '').trim();
    const section = body.section ? String(body.section).trim() : '';
    const semester = body.semester ? String(body.semester).trim() : null;
    const students: StudentRow[] = Array.isArray(body.students) ? body.students : [];

    if (!courseCode || !courseName || students.length === 0) {
      return json({ ok: false, error: 'invalid_input' }, 400);
    }

    // Upsert course
    const { data: course, error: courseErr } = await admin
      .from('courses')
      .upsert(
        { instructor_id: callerId, code: courseCode, name: courseName, section, semester },
        { onConflict: 'instructor_id,code,section' },
      )
      .select('id')
      .single();
    if (courseErr || !course) {
      console.error('course upsert error:', courseErr);
      return json({ ok: false, error: courseErr?.message ?? 'course_upsert_failed' }, 400);
    }
    const courseId = course.id as string;

    // Fetch ALL profiles that have a student_code — we normalize on the server
    // side so quirks like "67543210014-6" vs "675432100146" still match.
    const { data: allProfiles } = await admin
      .from('profiles')
      .select('user_id, student_code')
      .not('student_code', 'is', null);

    const normalizedProfileMap = new Map<string, string>(); // normalized -> user_id
    const profileDebug: Array<{ raw: string; normalized: string }> = [];
    for (const row of (allProfiles ?? [])) {
      const raw = String(row.student_code ?? '');
      const n = normalize(raw);
      if (n) {
        normalizedProfileMap.set(n, row.user_id);
        profileDebug.push({ raw, normalized: n });
      }
    }

    // Existing enrollments for this course, keyed by normalized code, so a
    // re-import can't downgrade a student who already confirmed (or was
    // already matched) back to pending/unmatched.
    const { data: existingRows } = await admin
      .from('course_enrollments')
      .select('student_code_raw, student_id, status')
      .eq('course_id', courseId);
    const existingByCode = new Map<string, { student_id: string | null; status: string }>();
    for (const row of (existingRows ?? [])) {
      const n = normalize(row.student_code_raw);
      if (n) existingByCode.set(n, { student_id: row.student_id, status: row.status });
    }

    // De-dupe rows within this same import batch first — the same student
    // can legitimately appear twice in a source file (e.g. cross-listed
    // sections), and Postgres's ON CONFLICT errors out (or the DB driver
    // silently drops rows) if a single upsert batch contains the same
    // conflict key twice.
    const seenCodes = new Set<string>();
    const importDebug: Array<{ raw: string; normalized: string; matched: boolean }> = [];
    const enrollmentRows: Array<{
      course_id: string; student_id: string | null;
      student_code_raw: string; student_name_raw: string; status: string;
    }> = [];
    for (const s of students) {
      // Prefer the true original cell text (studentCodeRaw); studentCode
      // has already had a trailing "-N" stripped client-side, which used to
      // get stored as-is here. That meant the SAME student's code could be
      // stored as "67543210014" from one import and "675432100146" from
      // another (whichever the source file happened to use that time),
      // and each variant created its own row on every re-import instead of
      // updating the existing one — that's the reported "grows every time
      // I click import" bug. Normalizing to digits-only before storing
      // makes the dedup key stable regardless of dash formatting.
      const original = String(s.studentCodeRaw ?? s.studentCode ?? '').trim();
      const name = String(s.studentName ?? '').replace(/\s+/g, ' ').trim();
      const n = normalize(original);
      if (!n) continue;
      if (seenCodes.has(n)) continue; // duplicate row within this same file
      seenCodes.add(n);
      const uid = normalizedProfileMap.get(n) ?? null;
      importDebug.push({ raw: original, normalized: n, matched: !!uid });

      // A student's own decision (confirmed / declined) is never overwritten
      // by a re-import — only 'pending' and 'unmatched' get refreshed.
      const existing = existingByCode.get(n);
      const preserveExisting = existing?.status === 'confirmed' || existing?.status === 'declined';
      enrollmentRows.push({
        course_id: courseId,
        student_id: preserveExisting ? existing!.student_id : uid,
        student_code_raw: n,
        student_name_raw: name,
        status: preserveExisting ? existing!.status : (uid ? 'pending' : 'unmatched'),
      });
    }

    const { error: enrollErr } = await admin
      .from('course_enrollments')
      .upsert(enrollmentRows, { onConflict: 'course_id,student_code_raw' });
    if (enrollErr) {
      console.error('enrollments upsert error:', enrollErr);
      return json({ ok: false, error: enrollErr.message }, 400);
    }

    // Notifications for newly-matched students only — re-notifying someone
    // who already confirmed on every re-import would be noise, not news.
    const notifRows = enrollmentRows
      .filter(r => r.status === 'pending')
      .map(r => ({
        user_id: r.student_id!,
        type: 'course_invite',
        title: 'คำเชิญเข้าร่วมวิชา',
        body: `อาจารย์เพิ่มคุณเข้าวิชา ${courseCode} ${courseName} กรุณายืนยัน`,
        related_id: courseId,
        action_required: true,
      }));
    if (notifRows.length > 0) {
      await admin.from('notifications').insert(notifRows);
    }

    const matchedCount = enrollmentRows.filter(r => r.student_id).length;
    const unmatchedList = enrollmentRows
      .filter(r => !r.student_id)
      .map(r => ({ studentCode: r.student_code_raw, studentName: r.student_name_raw }));

    try {
      await admin.from('audit_logs').insert({
        actor_id: callerId,
        actor_role: roleSet.has('admin') ? 'admin' : 'instructor',
        action: 'import_course_roster',
        target: 'course',
        target_id: courseId,
        detail: JSON.stringify({
          courseCode, courseName,
          matchedCount, unmatchedCount: unmatchedList.length,
        }),
      });
    } catch (logErr) {
      console.error('audit log failed (import_course_roster):', logErr);
    }

    return json({
      ok: true,
      courseId,
      matchedCount,
      unmatchedCount: unmatchedList.length,
      unmatchedList,
      debug: {
        importedNormalized: importDebug,
        profileSample: profileDebug.slice(0, 50),
        profileTotal: profileDebug.length,
      },
    });
  } catch (e) {
    console.error('import-course-roster error:', e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
