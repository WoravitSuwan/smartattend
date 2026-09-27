-- ═══════════════════════════════════════════════════════════════════════════
--  SmartAttend — โครงสร้างคะแนนสองชั้น งานที่ผูกคะแนน และคาบเรียนที่ตั้งเวลาได้
--
--  ต่อยอดจากของเดิม ไม่สร้างสคีมาซ้อน:
--    grade_items, student_grades, grade_audit_logs, upsert_student_grade(),
--    publish_final_grades(), courses.final_grade_published, assignments,
--    assignment_submissions, class_sessions, attendance_records,
--    course_enrollments.absent_count / attendance_blocked / scanning_paused
--
--  แก้จากสเปกต้นฉบับ 3 จุดที่จะพังหรือชนของเดิม:
--    1. ชื่อ policy เดิมของ grade_items คือ "Enrolled students view grade items"
--       (ไม่ใช่ "Students view grade items") — ถ้า drop ผิดชื่อ policy เก่าจะยังอยู่
--       และเพราะ RLS รวม policy แบบ OR การปิดบังคะแนนปลายภาคจะไม่มีผลเลย
--    2. ไม่เพิ่ม class_sessions.scan_enabled เพราะซ้ำหน้าที่กับ scanning_paused
--       ที่ปุ่ม "หยุดสแกนชั่วคราว" และ pi_agent.py ใช้อยู่แล้ว
--    3. ปิดบังคะแนนปลายภาคใน student_grades ให้ดูธง is_final_exam ของหมวดด้วย
--       ไม่ใช่ดูแค่ category = 'final'
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. โครงคะแนนสองชั้น: หมวด (grade_components) → รายการย่อย (grade_items)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.grade_components (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'other'
                  CHECK (kind IN ('attendance','assignment','lab','quiz',
                                  'midterm','final','affective','other')),
  weight_percent  numeric NOT NULL DEFAULT 0 CHECK (weight_percent >= 0 AND weight_percent <= 100),
  is_final_exam   boolean NOT NULL DEFAULT false,
  score_mode      text NOT NULL DEFAULT 'manual'
                  CHECK (score_mode IN ('manual','auto_attendance','auto_assignment')),
  late_credit     numeric NOT NULL DEFAULT 0.5 CHECK (late_credit BETWEEN 0 AND 1),
  excused_credit  numeric NOT NULL DEFAULT 1.0 CHECK (excused_credit BETWEEN 0 AND 1),
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, name)
);

ALTER TABLE public.grade_items
  ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES public.grade_components(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
      CHECK (source IN ('manual','assignment','attendance'));

CREATE INDEX IF NOT EXISTS idx_grade_items_component ON public.grade_items(component_id);
CREATE INDEX IF NOT EXISTS idx_grade_components_course ON public.grade_components(course_id);

-- ย้ายข้อมูลเดิม: รวม grade_items ที่มีอยู่เป็นหมวดตาม category แล้วผูกกลับ
-- (รันก่อนสร้าง constraint trigger ข้างล่าง จึงไม่ติดเงื่อนไขน้ำหนักรวม 100
--  ซึ่งสำคัญ เพราะข้อมูลเดิมส่วนใหญ่ยังไม่ครบ 100 — ของเดิมแค่เตือน ไม่ได้บังคับ)
DO $migrate$
DECLARE
  rec record;
  v_component_id uuid;
BEGIN
  FOR rec IN
    SELECT course_id, category, sum(weight) AS w
    FROM public.grade_items
    WHERE component_id IS NULL
    GROUP BY course_id, category
  LOOP
    INSERT INTO public.grade_components (course_id, name, kind, weight_percent, is_final_exam, score_mode)
    VALUES (
      rec.course_id,
      CASE rec.category
        WHEN 'attendance' THEN 'คะแนนการเข้าเรียน'
        WHEN 'assignment' THEN 'งานที่มอบหมาย'
        WHEN 'midterm'    THEN 'สอบกลางภาค'
        WHEN 'final'      THEN 'สอบปลายภาค'
        ELSE 'อื่น ๆ'
      END,
      rec.category,
      LEAST(COALESCE(rec.w, 0), 100),
      rec.category = 'final',
      CASE rec.category WHEN 'attendance' THEN 'auto_attendance' ELSE 'manual' END
    )
    ON CONFLICT (course_id, name) DO UPDATE SET weight_percent = EXCLUDED.weight_percent
    RETURNING id INTO v_component_id;

    UPDATE public.grade_items
      SET component_id = v_component_id
      WHERE course_id = rec.course_id AND category = rec.category AND component_id IS NULL;
  END LOOP;
END
$migrate$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. บังคับน้ำหนักรวมทุกหมวดในรายวิชา = 100 พอดี (ตรวจตอน commit)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_course_weight_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_course_id uuid := COALESCE(NEW.course_id, OLD.course_id);
  v_total numeric;
  v_count integer;
BEGIN
  SELECT count(*), COALESCE(sum(weight_percent), 0)
    INTO v_count, v_total
  FROM public.grade_components WHERE course_id = v_course_id;

  IF v_count > 0 AND round(v_total, 2) <> 100 THEN
    RAISE EXCEPTION 'น้ำหนักคะแนนรวมของรายวิชาต้องเท่ากับ 100 พอดี (ขณะนี้ %)', v_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_weight_total ON public.grade_components;
CREATE CONSTRAINT TRIGGER trg_course_weight_total
  AFTER INSERT OR UPDATE OR DELETE ON public.grade_components
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_course_weight_total();

-- บันทึกโครงสร้างคะแนนทั้งชุดในครั้งเดียว
CREATE OR REPLACE FUNCTION public.save_grade_structure(_course_id uuid, _components jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c jsonb;
  i integer := 0;
  v_keep uuid[] := '{}';
  v_id uuid;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(_components) LOOP
    i := i + 1;
    INSERT INTO public.grade_components
      (course_id, name, kind, weight_percent, is_final_exam, score_mode,
       late_credit, excused_credit, position)
    VALUES (
      _course_id,
      c->>'name',
      COALESCE(c->>'kind', 'other'),
      COALESCE((c->>'weight_percent')::numeric, 0),
      COALESCE((c->>'is_final_exam')::boolean, COALESCE(c->>'kind','') = 'final'),
      COALESCE(c->>'score_mode', 'manual'),
      COALESCE((c->>'late_credit')::numeric, 0.5),
      COALESCE((c->>'excused_credit')::numeric, 1.0),
      i
    )
    ON CONFLICT (course_id, name) DO UPDATE SET
      kind = EXCLUDED.kind,
      weight_percent = EXCLUDED.weight_percent,
      is_final_exam = EXCLUDED.is_final_exam,
      score_mode = EXCLUDED.score_mode,
      late_credit = EXCLUDED.late_credit,
      excused_credit = EXCLUDED.excused_credit,
      position = EXCLUDED.position
    RETURNING id INTO v_id;
    v_keep := v_keep || v_id;
  END LOOP;

  DELETE FROM public.grade_components
   WHERE course_id = _course_id AND NOT (id = ANY(v_keep));
END;
$$;

REVOKE ALL ON FUNCTION public.save_grade_structure(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_grade_structure(uuid, jsonb) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. งานที่มอบหมาย: หนึ่งงาน = หนึ่งรายการคะแนนในหมวดที่อาจารย์เลือก
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES public.grade_components(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grade_item_id uuid REFERENCES public.grade_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counts_toward_grade boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.sync_assignment_grade_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id uuid;
  v_category text;
BEGIN
  IF NOT NEW.counts_toward_grade OR NEW.component_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT CASE kind WHEN 'lab' THEN 'assignment' WHEN 'quiz' THEN 'assignment'
                   WHEN 'affective' THEN 'other'
                   ELSE kind END
    INTO v_category
  FROM public.grade_components WHERE id = NEW.component_id;

  IF NEW.grade_item_id IS NULL THEN
    INSERT INTO public.grade_items (course_id, component_id, name, category, max_score, weight, source)
    VALUES (NEW.course_id, NEW.component_id, NEW.title,
            COALESCE(v_category, 'assignment'), NEW.max_score, 0, 'assignment')
    RETURNING id INTO v_item_id;
    NEW.grade_item_id := v_item_id;
  ELSE
    UPDATE public.grade_items
       SET name = NEW.title, max_score = NEW.max_score, component_id = NEW.component_id
     WHERE id = NEW.grade_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_assignment_grade_item ON public.assignments;
CREATE TRIGGER trg_sync_assignment_grade_item
  BEFORE INSERT OR UPDATE OF title, max_score, component_id, counts_toward_grade
  ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_assignment_grade_item();

-- ตรวจงานแล้วคะแนนเข้าตารางคะแนนทันที ไม่ต้องกรอกซ้ำ
CREATE OR REPLACE FUNCTION public.sync_submission_score_to_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id uuid;
  v_old numeric;
  v_row_id uuid;
BEGIN
  IF NEW.score IS NULL THEN RETURN NEW; END IF;

  SELECT grade_item_id INTO v_item_id FROM public.assignments WHERE id = NEW.assignment_id;
  IF v_item_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, score INTO v_row_id, v_old
  FROM public.student_grades
  WHERE grade_item_id = v_item_id AND student_id = NEW.student_id;

  IF v_row_id IS NULL THEN
    INSERT INTO public.student_grades (grade_item_id, student_id, score)
    VALUES (v_item_id, NEW.student_id, NEW.score)
    RETURNING id INTO v_row_id;
  ELSE
    UPDATE public.student_grades SET score = NEW.score WHERE id = v_row_id;
  END IF;

  IF v_old IS DISTINCT FROM NEW.score THEN
    INSERT INTO public.grade_audit_logs (student_grade_id, modified_by, previous_score, new_score, reason)
    VALUES (v_row_id, COALESCE(NEW.graded_by, auth.uid()), v_old, NEW.score, 'ซิงก์จากการตรวจงาน');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_submission_score ON public.assignment_submissions;
CREATE TRIGGER trg_sync_submission_score
  AFTER INSERT OR UPDATE OF score ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.sync_submission_score_to_grade();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. คะแนนการเข้าเรียนคำนวณจากสถิติจริง
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalc_attendance_scores(_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp public.grade_components%ROWTYPE;
  v_item_id uuid;
  v_sessions integer;
  rec record;
  v_ratio numeric;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_comp FROM public.grade_components
   WHERE course_id = _course_id AND score_mode = 'auto_attendance' LIMIT 1;
  IF v_comp.id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_item_id FROM public.grade_items
   WHERE component_id = v_comp.id AND source = 'attendance' LIMIT 1;
  IF v_item_id IS NULL THEN
    INSERT INTO public.grade_items (course_id, component_id, name, category, max_score, weight, source)
    VALUES (_course_id, v_comp.id, 'คะแนนการเข้าเรียน', 'attendance', 100, 0, 'attendance')
    RETURNING id INTO v_item_id;
  END IF;

  SELECT count(*) INTO v_sessions
  FROM public.class_sessions WHERE course_id = _course_id AND status = 'closed';
  IF v_sessions = 0 THEN RETURN; END IF;

  FOR rec IN
    SELECT ce.student_id,
           count(*) FILTER (WHERE ar.status = 'on_time') AS n_on_time,
           count(*) FILTER (WHERE ar.status = 'late')    AS n_late,
           count(*) FILTER (WHERE ar.status = 'excused') AS n_excused
    FROM public.course_enrollments ce
    LEFT JOIN public.class_sessions cs ON cs.course_id = ce.course_id AND cs.status = 'closed'
    LEFT JOIN public.attendance_records ar ON ar.session_id = cs.id AND ar.student_id = ce.student_id
    WHERE ce.course_id = _course_id AND ce.status = 'confirmed' AND ce.student_id IS NOT NULL
    GROUP BY ce.student_id
  LOOP
    v_ratio := (rec.n_on_time + rec.n_late * v_comp.late_credit
                + rec.n_excused * v_comp.excused_credit)::numeric / v_sessions;
    v_ratio := least(greatest(v_ratio, 0), 1);

    INSERT INTO public.student_grades (grade_item_id, student_id, score, note)
    VALUES (v_item_id, rec.student_id, round(v_ratio * 100, 2), 'คำนวณอัตโนมัติจากสถิติการเข้าเรียน')
    ON CONFLICT (grade_item_id, student_id)
    DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_attendance_scores(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_attendance_scores(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. เกณฑ์เกรดและสรุปคะแนน (ปิดบังคะแนนปลายภาคที่ระดับฐานข้อมูล)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.grade_scales (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  grade      text NOT NULL,
  min_score  numeric NOT NULL,
  UNIQUE (course_id, grade)
);

CREATE OR REPLACE FUNCTION public.grade_letter(_course_id uuid, _total numeric)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT grade FROM public.grade_scales
      WHERE course_id = _course_id AND _total >= min_score
      ORDER BY min_score DESC LIMIT 1),
    CASE
      WHEN _total >= 80 THEN 'A'  WHEN _total >= 75 THEN 'B+'
      WHEN _total >= 70 THEN 'B'  WHEN _total >= 65 THEN 'C+'
      WHEN _total >= 60 THEN 'C'  WHEN _total >= 55 THEN 'D+'
      WHEN _total >= 50 THEN 'D'  ELSE 'F'
    END);
$$;

CREATE OR REPLACE FUNCTION public.get_student_score_summary(
  _course_id uuid,
  _student_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid := COALESCE(_student_id, auth.uid());
  v_is_staff boolean;
  v_published boolean;
  v_blocked boolean;
  v_components jsonb := '[]'::jsonb;
  v_visible numeric := 0;
  v_hidden  numeric := 0;
  rec record;
BEGIN
  v_is_staff := public.is_course_instructor(_course_id, auth.uid())
                OR internal.has_role(auth.uid(), 'admin'::app_role);

  IF NOT v_is_staff AND v_target <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT final_grade_published INTO v_published FROM public.courses WHERE id = _course_id;
  SELECT attendance_blocked INTO v_blocked FROM public.course_enrollments
   WHERE course_id = _course_id AND student_id = v_target;

  FOR rec IN
    SELECT gc.id, gc.name, gc.kind, gc.weight_percent, gc.is_final_exam,
           COALESCE(sum(sg.score), 0)     AS earned_raw,
           COALESCE(sum(gi.max_score), 0) AS max_raw,
           count(gi.id)                   AS item_count
    FROM public.grade_components gc
    LEFT JOIN public.grade_items gi ON gi.component_id = gc.id
    LEFT JOIN public.student_grades sg ON sg.grade_item_id = gi.id AND sg.student_id = v_target
    WHERE gc.course_id = _course_id
    GROUP BY gc.id, gc.name, gc.kind, gc.weight_percent, gc.is_final_exam, gc.position
    ORDER BY gc.position
  LOOP
    DECLARE
      v_pct numeric := CASE WHEN rec.max_raw > 0
                            THEN round(rec.earned_raw / rec.max_raw * rec.weight_percent, 2)
                            ELSE 0 END;
      v_hide boolean := rec.is_final_exam AND NOT COALESCE(v_published, false) AND NOT v_is_staff;
    BEGIN
      IF v_hide THEN
        v_hidden := v_hidden + rec.weight_percent;
      ELSE
        v_visible := v_visible + v_pct;
      END IF;

      v_components := v_components || jsonb_build_object(
        'component_id',   rec.id,
        'name',           rec.name,
        'kind',           rec.kind,
        'weight',         rec.weight_percent,
        'item_count',     rec.item_count,
        'earned_raw',     CASE WHEN v_hide THEN NULL ELSE rec.earned_raw END,
        'max_raw',        CASE WHEN v_hide THEN NULL ELSE rec.max_raw END,
        'earned_percent', CASE WHEN v_hide THEN NULL ELSE v_pct END,
        'masked',         v_hide
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'course_id',          _course_id,
    'student_id',         v_target,
    'components',         v_components,
    'visible_percent',    round(v_visible, 2),
    'masked_weight',      round(v_hidden, 2),
    'final_published',    COALESCE(v_published, false),
    'total_percent',      CASE WHEN v_is_staff OR COALESCE(v_published,false)
                               THEN round(v_visible, 2) ELSE NULL END,
    'grade',              CASE WHEN v_is_staff OR COALESCE(v_published,false)
                               THEN public.grade_letter(_course_id, v_visible) ELSE NULL END,
    'attendance_blocked', COALESCE(v_blocked, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_score_summary(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_score_summary(uuid, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. ตารางเรียนและคาบที่ตั้งเวลาล่วงหน้าได้ — อาจารย์เลือกวันและเวลาเองได้
-- ───────────────────────────────────────────────────────────────────────────
-- pi_agent/supabase_client.py ดึง courses(code,name,room) มาตลอดเพื่อกรองห้อง
-- ตาม ENV ROOM แต่ตาราง courses ไม่เคยมีคอลัมน์นี้ — PostgREST จึงตอบ 400 และ
-- Pi มองไม่เห็นคาบเรียนเลย เพิ่มคอลัมน์ให้ฟีเจอร์กรองห้องใช้งานได้จริง
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS room text;

CREATE TABLE IF NOT EXISTS public.course_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = อาทิตย์
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  room        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

-- ไม่เพิ่ม scan_enabled — ใช้ scanning_paused ที่มีอยู่แล้วเป็นสวิตช์เดียว
ALTER TABLE public.class_sessions
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('auto','manual')),
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end timestamptz;

ALTER TABLE public.class_sessions DROP CONSTRAINT IF EXISTS class_sessions_status_check;
ALTER TABLE public.class_sessions
  ADD CONSTRAINT class_sessions_status_check
  CHECK (status IN ('scheduled','open','closed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_class_sessions_scheduled
  ON public.class_sessions(status, scheduled_start);

-- อาจารย์ตั้งคาบล่วงหน้าเองได้ เลือกวันและเวลา รวมถึงคาบชดเชย
CREATE OR REPLACE FUNCTION public.schedule_class_session(
  _course_id uuid,
  _start timestamptz,
  _end timestamptz,
  _late_after_minutes integer DEFAULT 15,
  _title text DEFAULT NULL,
  _mode text DEFAULT 'manual'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _end <= _start THEN
    RAISE EXCEPTION 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม';
  END IF;

  INSERT INTO public.class_sessions
    (course_id, instructor_id, started_at, status, mode, title,
     scheduled_start, scheduled_end, late_after_minutes)
  VALUES (_course_id, auth.uid(), _start, 'scheduled', _mode, _title,
          _start, _end, _late_after_minutes)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_class_session(uuid, timestamptz, timestamptz, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_class_session(uuid, timestamptz, timestamptz, integer, text, text)
  TO authenticated;

-- เปิดคาบที่ถึงเวลา ปิดคาบที่หมดเวลา (อุปกรณ์เรียกทุกรอบการถาม หรือจาก cron)
CREATE OR REPLACE FUNCTION public.sync_scheduled_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.class_sessions
     SET status = 'open'
   WHERE status = 'scheduled'
     AND scheduled_start <= now()
     AND (scheduled_end IS NULL OR scheduled_end > now());

  UPDATE public.class_sessions
     SET status = 'closed', closed_at = now()
   WHERE status = 'open'
     AND scheduled_end IS NOT NULL
     AND scheduled_end <= now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_scheduled_sessions() TO authenticated, service_role;

-- มุมมองสำหรับอุปกรณ์: คาบที่เปิดอยู่และยังไม่ถูกอาจารย์สั่งหยุดสแกน
DROP VIEW IF EXISTS public.v_active_scan_session;
CREATE VIEW public.v_active_scan_session AS
SELECT cs.id, cs.course_id, cs.started_at, cs.late_after_minutes, cs.status,
       cs.scheduled_start, cs.scheduled_end, cs.scanning_paused, cs.title, cs.mode,
       c.code, c.name, c.section, c.semester, c.room
FROM public.class_sessions cs
JOIN public.courses c ON c.id = cs.course_id
WHERE cs.status = 'open' AND NOT cs.scanning_paused;

GRANT SELECT ON public.v_active_scan_session TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. รายชื่อสำหรับอุปกรณ์ ตัดผู้ถูกระงับสิทธิ์ออกตั้งแต่ต้นทาง
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_scan_roster(_course_id uuid)
RETURNS TABLE (student_id uuid, student_code text, student_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ce.student_id, p.student_code, p.name
  FROM public.course_enrollments ce
  LEFT JOIN public.profiles p ON p.user_id = ce.student_id
  WHERE ce.course_id = _course_id
    AND ce.status = 'confirmed'
    AND ce.student_id IS NOT NULL
    AND NOT ce.attendance_blocked;
$$;

GRANT EXECUTE ON FUNCTION public.get_scan_roster(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. นโยบายการเข้าถึงข้อมูล
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.grade_components  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_scales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_schedules  ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_components, public.grade_scales,
      public.course_schedules TO authenticated;
GRANT ALL ON public.grade_components, public.grade_scales, public.course_schedules TO service_role;

DROP POLICY IF EXISTS "Instructors manage grade components" ON public.grade_components;
CREATE POLICY "Instructors manage grade components" ON public.grade_components
  FOR ALL TO authenticated
  USING (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role));

-- นักศึกษาเห็นโครงสร้าง (ชื่อหมวด/น้ำหนัก) ได้ แต่คะแนนปลายภาคถูกกันไว้อีกชั้น
DROP POLICY IF EXISTS "Students view grade components" ON public.grade_components;
CREATE POLICY "Students view grade components" ON public.grade_components
  FOR SELECT TO authenticated
  USING (public.is_enrolled_student(course_id, auth.uid()));

DROP POLICY IF EXISTS "Course members view schedules" ON public.course_schedules;
CREATE POLICY "Course members view schedules" ON public.course_schedules
  FOR SELECT TO authenticated
  USING (public.is_enrolled_student(course_id, auth.uid())
         OR public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Instructors manage schedules" ON public.course_schedules;
CREATE POLICY "Instructors manage schedules" ON public.course_schedules
  FOR ALL TO authenticated
  USING (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Course members view grade scales" ON public.grade_scales;
CREATE POLICY "Course members view grade scales" ON public.grade_scales
  FOR SELECT TO authenticated
  USING (course_id IS NULL
         OR public.is_enrolled_student(course_id, auth.uid())
         OR public.is_course_instructor(course_id, auth.uid()));

DROP POLICY IF EXISTS "Instructors manage grade scales" ON public.grade_scales;
CREATE POLICY "Instructors manage grade scales" ON public.grade_scales
  FOR ALL TO authenticated
  USING (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role));

-- กันคะแนนปลายภาคหลุดผ่านตาราง grade_items
-- ชื่อ policy เดิมคือ "Enrolled students view grade items" — ต้อง drop ชื่อนี้
-- ไม่งั้น policy เก่าจะยังอยู่และ RLS จะ OR กัน ทำให้การปิดบังไม่มีผล
DROP POLICY IF EXISTS "Enrolled students view grade items" ON public.grade_items;
DROP POLICY IF EXISTS "Students view grade items" ON public.grade_items;
CREATE POLICY "Students view grade items" ON public.grade_items
  FOR SELECT TO authenticated
  USING (
    public.is_enrolled_student(course_id, auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.grade_components gc
      JOIN public.courses c ON c.id = gc.course_id
      WHERE gc.id = grade_items.component_id
        AND gc.is_final_exam
        AND NOT c.final_grade_published
    )
  );

-- ปิดบังใน student_grades ให้ดูธง is_final_exam ของหมวดด้วย ไม่ใช่แค่ category
DROP POLICY IF EXISTS "Students view own grades" ON public.student_grades;
CREATE POLICY "Students view own grades" ON public.student_grades
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.grade_items gi
      JOIN public.courses c ON c.id = gi.course_id
      LEFT JOIN public.grade_components gc ON gc.id = gi.component_id
      WHERE gi.id = student_grades.grade_item_id
        AND NOT c.final_grade_published
        AND (gi.category = 'final' OR COALESCE(gc.is_final_exam, false))
    )
  );
