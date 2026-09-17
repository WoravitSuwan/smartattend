import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { data: roles } = await admin
      .from('user_roles').select('role').eq('user_id', userData.user.id);
    if (!(roles ?? []).some((r: { role: string }) => r.role === 'admin')) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body.request_id ?? '').trim();
    const decision = String(body.decision ?? '');
    if (!requestId) return json({ ok: false, error: 'missing_request_id' }, 400);
    if (decision !== 'approve' && decision !== 'reject') {
      return json({ ok: false, error: 'invalid_decision' }, 400);
    }

    const { data: reqRow, error: reqErr } = await admin
      .from('role_requests')
      .select('id, user_id, requested_role, status')
      .eq('id', requestId).maybeSingle();
    if (reqErr || !reqRow) return json({ ok: false, error: 'not_found' }, 404);
    if (reqRow.status !== 'pending') {
      return json({ ok: false, error: `already_${reqRow.status}` }, 400);
    }

    if (decision === 'approve') {
      const { error: upErr } = await admin.from('user_roles').upsert(
        { user_id: reqRow.user_id, role: reqRow.requested_role },
        { onConflict: 'user_id,role', ignoreDuplicates: true },
      );
      if (upErr) return json({ ok: false, error: upErr.message }, 400);
    }

    const { error: updErr } = await admin.from('role_requests').update({
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewed_by: userData.user.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', requestId);
    if (updErr) return json({ ok: false, error: updErr.message }, 400);

    await admin.from('audit_logs').insert({
      actor_id: userData.user.id,
      actor_role: 'admin',
      action: decision === 'approve' ? 'role_request.approve' : 'role_request.reject',
      target: 'role_request',
      target_id: requestId,
      detail: `${decision === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}คำขอเป็น ${reqRow.requested_role}`,
    });

    return json({ ok: true });
  } catch (e) {
    console.error('admin-review-role-request error:', e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
