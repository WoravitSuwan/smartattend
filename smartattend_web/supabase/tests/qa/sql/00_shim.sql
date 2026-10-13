-- ═══════════════════════════════════════════════════════════════════════════
--  จำลองส่วนของ Supabase ที่ migration อ้างถึง
--
--  ใช้เฉพาะตอนสร้างฐานข้อมูลทดสอบจากศูนย์บนเครื่อง ไม่ได้ใช้ตอนชี้ไปฐานข้อมูล
--  จริงผ่าน DATABASE_URL เพราะของจริงมีของพวกนี้อยู่แล้ว
--
--  auth.uid() อ่านจาก request.jwt.claims เหมือนของจริงทุกประการ จึงสวมบทบาท
--  ผู้ใช้ในเทสต์ได้ด้วยการ set_config แล้ว RLS จะทำงานเหมือนตอนเรียกผ่าน API
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$ BEGIN CREATE ROLE anon          NOLOGIN NOINHERIT;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text UNIQUE,
  encrypted_password text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at         timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  current_user::text);
$$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT email FROM auth.users WHERE id = auth.uid();
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text, public boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb,
  created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/'); $$;

-- Supabase มี publication นี้มาให้ migration หลายไฟล์ ALTER ใส่ตาราง
DO $$ BEGIN CREATE PUBLICATION supabase_realtime;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;

-- ── สิทธิ์ระดับตารางที่ Supabase ตั้งให้อัตโนมัติ ──────────────────────────
--  บน Supabase จริง role anon/authenticated/service_role ได้สิทธิ์ตารางใน
--  สคีมา public มาตั้งแต่ต้นผ่าน default privileges  migration ของโปรเจกต์นี้
--  จึงเขียน GRANT เองเฉพาะบางตาราง (face_images, profiles, user_roles ฯลฯ)
--  และพึ่ง default privileges สำหรับที่เหลือ
--
--  ถ้าไม่จำลองตรงนี้ เทสต์ RLS จะพังด้วย "permission denied for table"
--  ตั้งแต่ก่อนที่ RLS จะได้ทำงาน แล้วเราจะรายงานข้อบกพร่องผิด ๆ
--  เพราะใน PostgreSQL สิทธิ์ตารางถูกตรวจ "ก่อน" นโยบาย RLS เสมอ
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
