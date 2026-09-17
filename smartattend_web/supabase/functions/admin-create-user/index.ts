import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Role = 'admin' | 'instructor' | 'student';

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

    // Verify caller is admin
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ ok: false, error: 'unauthorized' }, 401);

    const { data: roles } = await admin
      .from('user_roles').select('role').eq('user_id', userData.user.id);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin');
    if (!isAdmin) return json({ ok: false, error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const name = String(body.name ?? '').trim();
    const role = (body.role ?? 'instructor') as Role;
    const department = String(body.department ?? '').trim() || null;

    if (!email || !password || password.length < 8 || !name) {
      return json({ ok: false, error: 'invalid_input' }, 400);
    }
    if (!['admin', 'instructor', 'student'].includes(role)) {
      return json({ ok: false, error: 'invalid_role' }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name },
    });
    if (createErr || !created.user) {
      return json({ ok: false, error: createErr?.message ?? 'create_failed' }, 400);
    }
    const uid = created.user.id;

    await admin.from('profiles').upsert({
      user_id: uid, name, email, department,
    }, { onConflict: 'user_id' });

    await admin.from('user_roles').upsert(
      { user_id: uid, role },
      { onConflict: 'user_id,role', ignoreDuplicates: true },
    );

    // Instructors skip the face-training gate
    if (role !== 'student') {
      await admin.from('registration_statuses').upsert(
        { user_id: uid, status: 'training_success', student_code: null, student_name: name },
        { onConflict: 'user_id' },
      );
    }

    return json({ ok: true, user_id: uid });
  } catch (e) {
    console.error('admin-create-user error:', e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
