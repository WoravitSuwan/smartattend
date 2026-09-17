import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Role = 'admin' | 'instructor' | 'student';

interface DemoAccount {
  email: string;
  password: string;
  role: Role;
  name: string;
  student_code?: string | null;
  department?: string | null;
  phone?: string | null;
}

const demoAccounts: DemoAccount[] = [
  { email: 'admin@rmutl.ac.th', password: 'admin1234', role: 'admin', name: 'ผู้ดูแลระบบ' },
  {
    email: 'worawit.s@rmutl.ac.th',
    password: 'Student@2026',
    role: 'student',
    name: 'นายวรวิทย์ สุวรรณ',
    student_code: '65543210001',
    department: 'วิศวกรรมคอมพิวเตอร์',
    phone: '0812345678',
  },
  {
    email: 'rujiphan.k@rmutl.ac.th',
    password: 'Teacher@2026',
    role: 'instructor',
    name: 'ผศ. ดร. รุจิพันธุ์ โกษารัตน์',
    department: 'วิศวกรรมคอมพิวเตอร์',
    phone: '0898765432',
  },
];

const demoCourses = [
  { code: 'ENGCE101', name: 'การเขียนโปรแกรมคอมพิวเตอร์', section: '1', credits: '3(2-2-5)', schedule: 'จ 08:00-11:00', room: 'C4-301', instructor: 'ผศ. ดร. รุจิพันธุ์ โกษารัตน์' },
  { code: 'ENGCE202', name: 'โครงสร้างข้อมูลและอัลกอริทึม', section: '1', credits: '3(3-0-6)', schedule: 'อ 13:00-16:00', room: 'C4-302', instructor: 'ผศ. ดร. รุจิพันธุ์ โกษารัตน์' },
  { code: 'ENGCE305', name: 'ระบบฐานข้อมูล', section: '2', credits: '3(2-2-5)', schedule: 'พ 09:00-12:00', room: 'C4-401', instructor: 'อ. สมชาย ใจดี' },
  { code: 'ENGCE310', name: 'เครือข่ายคอมพิวเตอร์', section: '1', credits: '3(2-2-5)', schedule: 'พฤ 13:00-16:00', room: 'C4-402', instructor: 'อ. อารีย์ ทองคำ' },
  { code: 'GEBLC101', name: 'ภาษาอังกฤษเพื่อการสื่อสาร', section: '3', credits: '3(3-0-6)', schedule: 'ศ 08:00-11:00', room: 'B1-101', instructor: 'อ. Jennifer Smith' },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { data: existing, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) throw listErr;
    const byEmail = new Map(
      (existing?.users ?? []).map((u) => [u.email?.toLowerCase() ?? '', u.id]),
    );

    const results: Record<string, string> = {};

    for (const acc of demoAccounts) {
      let uid = byEmail.get(acc.email);
      if (!uid) {
        const { data, error } = await admin.auth.admin.createUser({
          email: acc.email,
          password: acc.password,
          email_confirm: true,
          user_metadata: { name: acc.name },
        });
        if (error) { console.error('create failed', acc.email, error.message); continue; }
        uid = data.user?.id;
      } else {
        // Reset password so the credentials in this file always work
        await admin.auth.admin.updateUserById(uid, { password: acc.password });
      }
      if (!uid) continue;
      results[acc.email] = uid;

      await admin.from('profiles').upsert({
        user_id: uid,
        name: acc.name,
        email: acc.email,
        student_code: acc.student_code ?? null,
        department: acc.department ?? null,
        phone: acc.phone ?? null,
      }, { onConflict: 'user_id' });

      await admin.from('user_roles').upsert(
        { user_id: uid, role: acc.role },
        { onConflict: 'user_id,role', ignoreDuplicates: true },
      );

      // All demo accounts skip the face-training gate so login works immediately
      await admin.from('registration_statuses').upsert({
        user_id: uid,
        status: 'training_success',
        student_code: acc.student_code ?? null,
        student_name: acc.name,
        trained_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      // Seed courses only for the demo student
      if (acc.role === 'student') {
        for (const c of demoCourses) {
          await admin.from('student_courses').upsert({
            user_id: uid,
            code: c.code,
            name: c.name,
            section: c.section,
            credits: c.credits,
            schedule: c.schedule,
            room: c.room,
            instructor: c.instructor,
            source: 'demo-seed',
          }, { onConflict: 'user_id,code' });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, users: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('seed-demo-users error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
