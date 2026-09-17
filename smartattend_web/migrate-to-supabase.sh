#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  ย้ายฐานข้อมูลไปยัง Supabase ของตัวเอง
#
#  ใช้: ./migrate-to-supabase.sh <project-ref>
#  หา project-ref ได้จาก URL ของ dashboard
#      https://supabase.com/dashboard/project/xxxxxxxxxxxx
#                                             ^^^^^^^^^^^^ นี่คือ project-ref
# ═══════════════════════════════════════════════════════════════
set -e

REF="$1"
if [ -z "$REF" ]; then
  echo "ใช้งาน: ./migrate-to-supabase.sh <project-ref>"
  echo "ตัวอย่าง: ./migrate-to-supabase.sh abcdefghijklmnop"
  exit 1
fi

echo "══════════════════════════════════════════"
echo " ย้ายฐานข้อมูลไปยังโปรเจกต์: $REF"
echo "══════════════════════════════════════════"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ไม่พบ Supabase CLI — ติดตั้งก่อนด้วย:"
  echo "  brew install supabase/tap/supabase"
  exit 1
fi

echo ""
echo "==> [1/3] เชื่อมต่อโปรเจกต์ (จะถามรหัสผ่านฐานข้อมูล)"
supabase link --project-ref "$REF"

echo ""
echo "==> [2/3] สร้างตาราง มุมมอง ทริกเกอร์ และนโยบายความปลอดภัย"
echo "     (รัน migration ทั้งหมด 34 ไฟล์ตามลำดับ)"
supabase db push

echo ""
echo "==> [3/3] อัปโหลด edge functions"
supabase functions deploy

echo ""
echo "══════════════════════════════════════════"
echo " เสร็จขั้นตอนอัตโนมัติแล้ว"
echo "══════════════════════════════════════════"
echo ""
echo "เหลืออีก 3 ขั้นที่ต้องทำเองใน Dashboard:"
echo ""
echo "  1. สร้าง Storage bucket"
echo "     SQL Editor > วางเนื้อหาไฟล์ supabase/setup/01_storage_buckets.sql > Run"
echo ""
echo "  2. แก้ไฟล์ .env ให้ชี้โปรเจกต์ใหม่"
echo "     ค่าอยู่ที่ Project Settings > API"
echo "       VITE_SUPABASE_URL              = Project URL"
echo "       VITE_SUPABASE_PUBLISHABLE_KEY  = anon public key"
echo "       VITE_SUPABASE_PROJECT_ID       = $REF"
echo ""
echo "  3. สมัครบัญชีผ่านหน้าเว็บ แล้วรัน supabase/setup/02_create_admin.sql"
echo "     เพื่อตั้งตัวเองเป็นผู้ดูแลระบบ"
