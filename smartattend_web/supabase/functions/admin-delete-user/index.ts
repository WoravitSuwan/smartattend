import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { data: roles } = await admin
      .from('user_roles').select('role').eq('user_id', userData.user.id);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin');
    if (!isAdmin) return json({ ok: false, error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const targetId = String(body.user_id ?? '').trim();
    if (!targetId) return json({ ok: false, error: 'invalid_input' }, 400);
    if (targetId === userData.user.id) return json({ ok: false, error: 'cannot_delete_self' }, 400);

    // Snapshot the target before deletion so the audit trail keeps who was removed.
    const { data: targetProfile } = await admin
      .from('profiles').select('name, email').eq('user_id', targetId).maybeSingle();
    const { data: targetRoles } = await admin
      .from('user_roles').select('role').eq('user_id', targetId);

    await admin.from('face_images').delete().eq('user_id', targetId);
    await admin.from('registration_statuses').delete().eq('user_id', targetId);
    await admin.from('student_courses').delete().eq('user_id', targetId);
    await admin.from('user_roles').delete().eq('user_id', targetId);
    await admin.from('profiles').delete().eq('user_id', targetId);

    const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
    if (delErr) return json({ ok: false, error: delErr.message }, 400);

    try {
      await admin.from('audit_logs').insert({
        actor_id: userData.user.id,
        actor_role: 'admin',
        action: 'delete_user',
        target: 'user',
        target_id: targetId,
        detail: JSON.stringify({
          email: targetProfile?.email ?? null,
          name: targetProfile?.name ?? null,
          role: (targetRoles ?? []).map((r: { role: string }) => r.role).join(',') || null,
        }),
      });
    } catch (logErr) {
      console.error('audit log failed (delete_user):', logErr);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('admin-delete-user error:', e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
