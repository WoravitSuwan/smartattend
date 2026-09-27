#!/usr/bin/env node
/**
 * สร้างบัญชีตัวอย่างสำหรับการสาธิต — รันจากเครื่องผู้พัฒนาเท่านั้น
 *
 * ของเดิมเป็น Edge Function `seed-demo-users` ที่ตั้ง verify_jwt = false
 * และมีรหัสผ่านแอดมินเขียนตรงในโค้ดบน repo ใครก็ยิง POST เข้ามาแล้วได้
 * สิทธิ์แอดมินทันที (แย่กว่านั้นคือมันรีเซ็ตรหัสผ่านของบัญชีที่มีอยู่แล้ว
 * กลับเป็นค่าในไฟล์ทุกครั้ง — เปลี่ยนรหัสผ่านเองก็ไม่ช่วย) จึงย้ายมาเป็น
 * สคริปต์ที่ต้องมี service role key อยู่ในมือถึงจะรันได้
 *
 * วิธีใช้ (อย่าใส่คีย์ลงไฟล์ ให้ส่งผ่าน environment variable):
 *
 *   export SUPABASE_URL="https://<project-ref>.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service role key>"
 *   export SEED_ADMIN_EMAIL="admin@example.ac.th"
 *   export SEED_ADMIN_PASSWORD="<รหัสผ่านที่ตั้งเอง ยาว 12 ตัวขึ้นไป>"
 *   node scripts/seed-demo-users.mjs
 *
 * ตัวแปรที่ใส่เพิ่มได้: SEED_INSTRUCTOR_EMAIL / SEED_INSTRUCTOR_PASSWORD /
 * SEED_INSTRUCTOR_NAME, SEED_STUDENT_EMAIL / SEED_STUDENT_PASSWORD /
 * SEED_STUDENT_NAME / SEED_STUDENT_CODE
 *
 * service role key ข้ามทุกนโยบาย RLS — ห้าม commit, ห้ามวางในแชต
 * และห้ามใส่ใน .env ของฝั่งเว็บ (ตัวแปร VITE_* ถูกฝังลงไฟล์ JS ที่ผู้ใช้โหลด)
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ก่อนรันสคริปต์นี้');
  process.exit(1);
}

/** บัญชีที่จะสร้าง — ทุกค่ามาจาก environment ไม่มีรหัสผ่านฝังในไฟล์ */
const accounts = [
  {
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    role: 'admin',
    name: process.env.SEED_ADMIN_NAME || 'ผู้ดูแลระบบ',
  },
  {
    email: process.env.SEED_INSTRUCTOR_EMAIL,
    password: process.env.SEED_INSTRUCTOR_PASSWORD,
    role: 'instructor',
    name: process.env.SEED_INSTRUCTOR_NAME || 'อาจารย์ผู้สอน (ตัวอย่าง)',
  },
  {
    email: process.env.SEED_STUDENT_EMAIL,
    password: process.env.SEED_STUDENT_PASSWORD,
    role: 'student',
    name: process.env.SEED_STUDENT_NAME || 'นักศึกษาตัวอย่าง',
    student_code: process.env.SEED_STUDENT_CODE || null,
  },
].filter(a => a.email && a.password);

if (accounts.length === 0) {
  console.error('ไม่มีบัญชีให้สร้าง — ตั้ง SEED_ADMIN_EMAIL และ SEED_ADMIN_PASSWORD เป็นอย่างน้อย');
  process.exit(1);
}

const weak = accounts.filter(a => a.password.length < 12);
if (weak.length > 0) {
  console.error(`รหัสผ่านสั้นเกินไป (ต้อง 12 ตัวขึ้นไป): ${weak.map(a => a.email).join(', ')}`);
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } });

/** ค้นหา user จากอีเมล — ไล่ทีละหน้าเพื่อไม่ตกหล่นเมื่อผู้ใช้เกินหนึ่งหน้า */
async function findUserId(email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = (data?.users ?? []).find(u => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

let created = 0;
let skipped = 0;

for (const acc of accounts) {
  const existing = await findUserId(acc.email);
  if (existing) {
    // ไม่รีเซ็ตรหัสผ่านของบัญชีที่มีอยู่แล้ว — ของเดิมทำ ซึ่งทำให้การเปลี่ยน
    // รหัสผ่านของผู้ดูแลระบบถูกย้อนกลับทุกครั้งที่สคริปต์ถูกเรียก
    console.log(`ข้าม ${acc.email} — มีบัญชีนี้อยู่แล้ว (ถ้าต้องการเปลี่ยนรหัสผ่าน ให้ทำใน Supabase Dashboard)`);
    skipped++;
    continue;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: acc.email,
    password: acc.password,
    email_confirm: true,
    user_metadata: { name: acc.name },
  });
  if (error || !data.user) {
    console.error(`สร้าง ${acc.email} ไม่สำเร็จ: ${error?.message ?? 'unknown'}`);
    continue;
  }
  const uid = data.user.id;

  await admin.from('profiles').upsert({
    user_id: uid, name: acc.name, email: acc.email,
    student_code: acc.student_code ?? null,
  }, { onConflict: 'user_id' });

  await admin.from('user_roles').upsert(
    { user_id: uid, role: acc.role },
    { onConflict: 'user_id,role', ignoreDuplicates: true },
  );

  // อาจารย์และแอดมินไม่ต้องผ่านขั้นลงทะเบียนใบหน้า
  // นักศึกษาตัวอย่าง "ต้อง" ลงทะเบียนใบหน้าเองตามขั้นตอนจริง จึงไม่ปลดล็อกให้
  if (acc.role !== 'student') {
    await admin.from('registration_statuses').upsert({
      user_id: uid, status: 'training_success', student_code: null, student_name: acc.name,
    }, { onConflict: 'user_id' });
  }

  console.log(`สร้าง ${acc.email} (${acc.role}) แล้ว`);
  created++;
}

console.log(`\nเสร็จสิ้น — สร้างใหม่ ${created} บัญชี, ข้าม ${skipped} บัญชี`);
