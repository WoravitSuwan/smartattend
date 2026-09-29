-- ═══════════════════════════════════════════════════════════════════════════
--  สคีมาจำลองเท่าที่ฟังก์ชันที่ทดสอบต้องใช้
--
--  ทำไมไม่โหลด migration ทั้งชุด
--    migration ชุดเต็มพึ่ง Supabase (auth, storage, realtime, นโยบาย RLS
--    ที่อ้าง auth.uid()) ซึ่งยกมาทั้งก้อนใน Postgres เปล่า ๆ ไม่ได้
--    ไฟล์นี้สร้างเฉพาะตารางและฟังก์ชันตัวช่วยที่ RPC สองตัวที่ทดสอบเรียกใช้
--    ส่วน "ตัวฟังก์ชันที่ทดสอบ" ดึงจากไฟล์ migration จริงใน 02 ไม่ได้คัดลอกมา
--    เทสต์จึงพังทันทีถ้ามีใครแก้ migration แล้วพฤติกรรมเปลี่ยน ซึ่งเป็นสิ่งที่ต้องการ
--
--  ⚠️ ถ้าคอลัมน์ในไฟล์นี้ไม่ตรงกับของจริง เทสต์จะพังด้วย column does not exist
--     ซึ่งเป็นสัญญาณให้มาปรับไฟล์นี้ ไม่ใช่ปรับเทสต์
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS internal;

DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('admin', 'instructor', 'student');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── auth ────────────────────────────────────────────────────────────────────
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- ในของจริงอ่านจากตาราง user_roles ที่นี่ให้ตั้งผ่าน test.admins ได้
CREATE FUNCTION internal.has_role(_uid uuid, _r app_role) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT _r = 'admin'::app_role
     AND position(_uid::text in COALESCE(current_setting('test.admins', true), '')) > 0
$$;

-- ── ตารางหลัก ───────────────────────────────────────────────────────────────
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, name text, instructor_id uuid,
  final_grade_published boolean NOT NULL DEFAULT false,
  grades_locked boolean NOT NULL DEFAULT false);

CREATE TABLE public.course_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  student_id uuid,
  status text NOT NULL DEFAULT 'confirmed',
  attendance_blocked boolean NOT NULL DEFAULT false);

CREATE TABLE public.class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  late_after_minutes integer NOT NULL DEFAULT 15,
  scanning_paused boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open');

CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  status text NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  photo_data_url text,
  confidence numeric,
  UNIQUE (session_id, student_id));

CREATE TABLE public.grade_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  weight_percent numeric NOT NULL DEFAULT 0,
  calc_mode text NOT NULL DEFAULT 'proportional',
  drop_lowest integer NOT NULL DEFAULT 0,
  is_final_exam boolean NOT NULL DEFAULT false,
  score_mode text NOT NULL DEFAULT 'manual',
  position integer NOT NULL DEFAULT 0);

CREATE TABLE public.grade_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  component_id uuid REFERENCES public.grade_components(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL
    CHECK (category IN ('attendance','assignment','midterm','final','other')),
  max_score numeric NOT NULL DEFAULT 100,
  weight numeric NOT NULL DEFAULT 0,
  weight_in_component numeric NOT NULL DEFAULT 0
    CHECK (weight_in_component >= 0 AND weight_in_component <= 100),
  position integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.student_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_item_id uuid NOT NULL REFERENCES public.grade_items(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  score numeric,
  note text);

CREATE TABLE public.grade_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_grade_id uuid, modified_by uuid,
  previous_score numeric, new_score numeric, reason text,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid, action text, target text, target_id text, detail text,
  before jsonb, after jsonb, reason text,
  created_at timestamptz NOT NULL DEFAULT now());

-- ── ฟังก์ชันตัวช่วยที่ RPC เรียกใช้ ──────────────────────────────────────────
CREATE FUNCTION public.log_audit_event(
  _action text, _target text DEFAULT NULL, _target_id text DEFAULT NULL,
  _detail text DEFAULT NULL, _before jsonb DEFAULT NULL, _after jsonb DEFAULT NULL,
  _reason text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; BEGIN
  INSERT INTO public.audit_logs (actor, action, target, target_id, detail, before, after, reason)
  VALUES (auth.uid(), _action, _target, _target_id, _detail, _before, _after, _reason)
  RETURNING id INTO v; RETURN v;
END $$;

CREATE FUNCTION public.is_course_instructor(_course_id uuid, _uid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.courses
                 WHERE id = _course_id AND instructor_id = _uid)
$$;

CREATE FUNCTION public.course_grades_locked(_course_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(grades_locked, false) FROM public.courses WHERE id = _course_id
$$;

-- ฟังก์ชันที่ migration 20260928100000 อ้างถึงใน COMMENT เท่านั้น
-- สร้างเป็นตัวเปล่าไว้ให้ COMMENT ON ไม่ล้ม
CREATE FUNCTION public.save_grade_item(
  _course_id uuid, _name text, _category text, _max_score numeric, _weight numeric,
  _item_id uuid DEFAULT NULL, _on_overflow text DEFAULT 'reject', _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

CREATE FUNCTION public.save_grade_item_weights(
  _course_id uuid, _weights jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

-- ── CONSTRAINT TRIGGER ตัวจริงจาก migration 20260927190000 ───────────────────
--    คัดลอกมาทั้งดุ้น เพราะ migration นั้นโหลดทั้งไฟล์ไม่ได้
CREATE OR REPLACE FUNCTION public.check_component_item_weights()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_component_id uuid := COALESCE(NEW.component_id, OLD.component_id);
  v_mode text; v_total numeric; v_count integer;
BEGIN
  IF v_component_id IS NULL THEN RETURN NULL; END IF;
  SELECT calc_mode INTO v_mode FROM public.grade_components WHERE id = v_component_id;
  IF v_mode IS DISTINCT FROM 'weighted_items' THEN RETURN NULL; END IF;
  SELECT count(*), COALESCE(sum(weight_in_component), 0) INTO v_count, v_total
  FROM public.grade_items WHERE component_id = v_component_id;
  IF v_count > 0 AND round(v_total, 2) <> 100 THEN
    RAISE EXCEPTION 'หมวดที่คิดคะแนนแบบน้ำหนักย่อย ต้องมีน้ำหนักย่อยรวมเท่ากับ 100 พอดี (ขณะนี้ %)', v_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_component_item_weights
  AFTER INSERT OR UPDATE OR DELETE ON public.grade_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_component_item_weights();
