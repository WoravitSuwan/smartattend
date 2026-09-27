-- ═══════════════════════════════════════════════════════════════════════════
--  2.1 งานที่มอบหมายผูกกับรายการคะแนนอัตโนมัติ
--  2.2 หักคะแนนงานที่ส่งช้า พร้อมยกเว้นรายคน
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. กฎการหักคะแนนส่งช้า — ตั้งได้ทั้งระดับหมวดและระดับงาน
--    ระดับงานเป็น NULL = ใช้ค่าของหมวด (ไม่ต้องตั้งซ้ำทุกงาน)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.grade_components
  ADD COLUMN IF NOT EXISTS late_penalty_per_day numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_penalty_max numeric NOT NULL DEFAULT 100;

ALTER TABLE public.grade_components DROP CONSTRAINT IF EXISTS grade_components_late_penalty_check;
ALTER TABLE public.grade_components
  ADD CONSTRAINT grade_components_late_penalty_check
  CHECK (late_penalty_per_day >= 0 AND late_penalty_per_day <= 100
     AND late_penalty_max >= 0 AND late_penalty_max <= 100);

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS late_penalty_per_day numeric,
  ADD COLUMN IF NOT EXISTS late_penalty_max numeric;

ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_late_penalty_check;
ALTER TABLE public.assignments
  ADD CONSTRAINT assignments_late_penalty_check
  CHECK ((late_penalty_per_day IS NULL OR (late_penalty_per_day >= 0 AND late_penalty_per_day <= 100))
     AND (late_penalty_max IS NULL OR (late_penalty_max >= 0 AND late_penalty_max <= 100)));

COMMENT ON COLUMN public.assignments.late_penalty_per_day IS
  'หักกี่เปอร์เซ็นต์ของคะแนนเต็มต่อวันที่ส่งช้า — NULL = ใช้ค่าของหมวดคะแนน';
COMMENT ON COLUMN public.assignments.late_penalty_max IS
  'หักได้สูงสุดกี่เปอร์เซ็นต์ของคะแนนเต็ม — NULL = ใช้ค่าของหมวดคะแนน';

-- ยกเว้นการหักเป็นรายคน พร้อมเหตุผล
ALTER TABLE public.assignment_submissions
  ADD COLUMN IF NOT EXISTS late_penalty_waived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_waiver_reason text,
  ADD COLUMN IF NOT EXISTS late_days integer,
  ADD COLUMN IF NOT EXISTS penalty_points numeric,
  ADD COLUMN IF NOT EXISTS net_score numeric;

COMMENT ON COLUMN public.assignment_submissions.score IS
  'คะแนนดิบที่อาจารย์ตรวจให้ ก่อนหักส่งช้า';
COMMENT ON COLUMN public.assignment_submissions.penalty_points IS
  'คะแนนที่ถูกหักเพราะส่งช้า (คำนวณโดยระบบ)';
COMMENT ON COLUMN public.assignment_submissions.net_score IS
  'คะแนนสุทธิ = score - penalty_points (ค่านี้คือค่าที่เข้าตารางคะแนน)';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. คำนวณการหักคะแนนส่งช้า — ใช้เวลาของเซิร์ฟเวอร์เท่านั้น
--
--    วันที่ส่งช้า = ceil((submitted_at - due_at) / 1 วัน) นับขึ้นเต็มวัน
--    ส่งช้า 1 นาทีก็นับเป็น 1 วัน เพราะกำหนดส่งคือเส้นตาย ไม่ใช่ค่าประมาณ
--    (ถ้าต้องการผ่อนผัน ให้อาจารย์ตั้ง due_at ให้ตรงกับที่ต้องการจริง)
--
--    คะแนนที่หัก = min(วันที่ช้า × per_day, max) % ของคะแนนเต็ม
--    คะแนนสุทธิไม่ต่ำกว่า 0
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_late_penalty(
  _max_score numeric,
  _due_at timestamptz,
  _submitted_at timestamptz,
  _per_day numeric,
  _max_penalty numeric
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  WITH d AS (
    SELECT CASE
             WHEN _due_at IS NULL OR _submitted_at IS NULL THEN 0
             WHEN _submitted_at <= _due_at THEN 0
             ELSE ceil(EXTRACT(EPOCH FROM (_submitted_at - _due_at)) / 86400.0)::int
           END AS late_days
  ),
  p AS (
    SELECT d.late_days,
           LEAST(d.late_days * COALESCE(_per_day, 0), COALESCE(_max_penalty, 100)) AS pct
    FROM d
  )
  SELECT jsonb_build_object(
    'late_days', p.late_days,
    'penalty_percent', round(p.pct, 4),
    'penalty_points', round(COALESCE(_max_score, 0) * p.pct / 100.0, 2))
  FROM p;
$$;

GRANT EXECUTE ON FUNCTION public.compute_late_penalty(numeric, timestamptz, timestamptz, numeric, numeric)
  TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. ตรวจงานแล้วคะแนนเข้าตารางคะแนนทันที พร้อมหักส่งช้าและลง audit
--
--    แทน trigger เดิม sync_submission_score_to_grade ซึ่ง
--      - เขียนคะแนนดิบเข้า student_grades โดยไม่หักส่งช้า
--      - ไม่ตรวจว่าคะแนนเกินคะแนนเต็มของรายการหรือไม่
--      - ไม่คำนวณหรือเก็บสามค่า (ดิบ / ที่หัก / สุทธิ) ให้เห็น
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_submission_score_to_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  v_per_day numeric;
  v_max_pen numeric;
  v_calc jsonb;
  v_net numeric;
  v_row_id uuid;
  v_old numeric;
BEGIN
  SELECT asg.id, asg.grade_item_id, asg.max_score, asg.due_at,
         asg.late_penalty_per_day, asg.late_penalty_max, asg.component_id,
         gc.late_penalty_per_day AS comp_per_day, gc.late_penalty_max AS comp_max
    INTO a
  FROM public.assignments asg
  LEFT JOIN public.grade_components gc ON gc.id = asg.component_id
  WHERE asg.id = NEW.assignment_id;

  IF a.id IS NULL THEN RETURN NEW; END IF;

  -- กฎระดับงานทับกฎระดับหมวด ถ้าไม่ตั้งที่งานให้ใช้ของหมวด
  v_per_day := COALESCE(a.late_penalty_per_day, a.comp_per_day, 0);
  v_max_pen := COALESCE(a.late_penalty_max, a.comp_max, 100);

  IF NEW.score IS NULL THEN
    -- ยังไม่ตรวจ ล้างค่าที่คำนวณไว้และลบคะแนนในตารางคะแนนออก
    NEW.late_days := NULL;
    NEW.penalty_points := NULL;
    NEW.net_score := NULL;
    IF a.grade_item_id IS NOT NULL THEN
      UPDATE public.student_grades SET score = NULL
       WHERE grade_item_id = a.grade_item_id AND student_id = NEW.student_id;
    END IF;
    RETURN NEW;
  END IF;

  v_calc := public.compute_late_penalty(
    a.max_score, a.due_at, NEW.submitted_at,
    CASE WHEN NEW.late_penalty_waived THEN 0 ELSE v_per_day END,
    v_max_pen);

  NEW.late_days      := (v_calc->>'late_days')::int;
  NEW.penalty_points := (v_calc->>'penalty_points')::numeric;
  v_net := GREATEST(NEW.score - NEW.penalty_points, 0);
  -- ไม่ให้เกินคะแนนเต็มของงาน เผื่ออาจารย์กรอกเกิน
  v_net := LEAST(v_net, COALESCE(a.max_score, v_net));
  NEW.net_score := v_net;

  IF a.grade_item_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, score INTO v_row_id, v_old
  FROM public.student_grades
  WHERE grade_item_id = a.grade_item_id AND student_id = NEW.student_id;

  IF v_row_id IS NULL THEN
    INSERT INTO public.student_grades (grade_item_id, student_id, score)
    VALUES (a.grade_item_id, NEW.student_id, v_net)
    RETURNING id INTO v_row_id;
  ELSE
    UPDATE public.student_grades SET score = v_net WHERE id = v_row_id;
  END IF;

  IF v_old IS DISTINCT FROM v_net THEN
    INSERT INTO public.grade_audit_logs
      (student_grade_id, modified_by, previous_score, new_score, reason)
    VALUES (v_row_id, COALESCE(NEW.graded_by, auth.uid()), v_old, v_net,
            'ซิงก์จากการตรวจงาน · คะแนนดิบ ' || NEW.score::text
            || CASE WHEN COALESCE(NEW.penalty_points, 0) > 0
                    THEN ' · หักส่งช้า ' || NEW.late_days::text || ' วัน = '
                         || NEW.penalty_points::text || ' คะแนน'
                    WHEN NEW.late_penalty_waived AND COALESCE(NEW.late_days, 0) > 0
                    THEN ' · ส่งช้า ' || NEW.late_days::text || ' วัน แต่อาจารย์ยกเว้นการหัก'
                    ELSE '' END);
  END IF;

  RETURN NEW;
END;
$$;

-- ต้องเป็น BEFORE เพื่อให้เขียน late_days / penalty_points / net_score ลงแถวเดียวกันได้
DROP TRIGGER IF EXISTS trg_sync_submission_score ON public.assignment_submissions;
CREATE TRIGGER trg_sync_submission_score
  BEFORE INSERT OR UPDATE OF score, late_penalty_waived
  ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.sync_submission_score_to_grade();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. งาน -> รายการคะแนน: จัดการกรณีที่ trigger เดิมทำไม่ครบ
--
--    ของเดิม `IF NOT NEW.counts_toward_grade OR NEW.component_id IS NULL THEN
--             RETURN NEW; END IF;`
--    คือถ้าอาจารย์ปิดสวิตช์ counts_toward_grade ภายหลัง รายการคะแนนที่สร้างไว้
--    จะยังอยู่และยังถูกนับในคะแนนรวมต่อไป โดยไม่มีใครรู้
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_assignment_grade_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id uuid;
  v_category text;
  v_calc_mode text;
  v_has_scores boolean;
BEGIN
  -- ── ไม่นับเป็นคะแนนแล้ว หรือถอดออกจากหมวด ──────────────────────────────
  IF NOT NEW.counts_toward_grade OR NEW.component_id IS NULL THEN
    IF NEW.grade_item_id IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM public.student_grades
                      WHERE grade_item_id = NEW.grade_item_id AND score IS NOT NULL)
        INTO v_has_scores;

      IF v_has_scores THEN
        -- มีคะแนนอยู่แล้ว ลบทิ้งเงียบ ๆ ไม่ได้ ต้องให้อาจารย์ตัดสินใจเอง
        RAISE EXCEPTION 'งานนี้มีคะแนนของนักศึกษาอยู่ในตารางคะแนนแล้ว ถ้าต้องการไม่ให้นับเป็นคะแนน ให้ลบรายการคะแนน "%" ในหน้าคะแนนก่อน',
          (SELECT name FROM public.grade_items WHERE id = NEW.grade_item_id)
          USING ERRCODE = 'check_violation';
      END IF;

      -- แค่ถอดการผูก ไม่ลบที่นี่
      -- ลบใน trigger AFTER แทน เพราะ assignments.grade_item_id มี FK แบบ
      -- ON DELETE SET NULL ถ้าลบในนี้ FK จะย้อนกลับมาแก้แถว assignments แถวเดิม
      -- ที่กำลังถูก UPDATE อยู่ แล้ว PostgreSQL จะปฏิเสธด้วย
      -- "tuple to be updated was already modified by an operation triggered by
      --  the current command"
      NEW.grade_item_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT CASE kind WHEN 'lab' THEN 'assignment' WHEN 'quiz' THEN 'assignment'
                   WHEN 'affective' THEN 'other'
                   ELSE kind END,
         calc_mode
    INTO v_category, v_calc_mode
  FROM public.grade_components WHERE id = NEW.component_id;

  -- หมวดที่คิดแบบถ่วงน้ำหนักรายการย่อย ต้องกำหนดน้ำหนักย่อยเอง ระบบเดาไม่ได้
  IF v_calc_mode = 'weighted_items' AND NEW.grade_item_id IS NULL THEN
    RAISE EXCEPTION 'หมวดคะแนนที่เลือกคิดแบบถ่วงน้ำหนักรายการย่อย ระบบกำหนดน้ำหนักย่อยของงานนี้ให้เองไม่ได้ กรุณาเลือกหมวดที่คิดตามสัดส่วนคะแนนรวม หรือสร้างรายการคะแนนในหน้าคะแนนแล้วตั้งน้ำหนักย่อยเอง'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.grade_item_id IS NULL THEN
    INSERT INTO public.grade_items
      (course_id, component_id, name, category, max_score, weight, source)
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

-- เก็บกวาดรายการคะแนนที่ถูกถอดการผูกแล้วไม่มีงานไหนอ้างถึงอีก
-- ทำใน AFTER เพื่อไม่ให้ FK ย้อนกลับมาแก้แถวที่ยังอยู่ในคำสั่งเดียวกัน
-- ลบเฉพาะรายการที่ระบบสร้างจากงาน (source = 'assignment') และไม่มีคะแนนอยู่
-- รายการที่อาจารย์สร้างเองหรือมีคะแนนแล้วไม่ถูกแตะ
CREATE OR REPLACE FUNCTION public.cleanup_orphan_assignment_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.grade_items gi
   WHERE gi.course_id = NEW.course_id
     AND gi.source = 'assignment'
     AND NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.grade_item_id = gi.id)
     AND NOT EXISTS (SELECT 1 FROM public.student_grades sg
                      WHERE sg.grade_item_id = gi.id AND sg.score IS NOT NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_orphan_assignment_items ON public.assignments;
CREATE TRIGGER trg_cleanup_orphan_assignment_items
  AFTER UPDATE OF component_id, counts_toward_grade ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_orphan_assignment_items();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. ยกเว้นการหักคะแนนส่งช้าเป็นรายคน (ต้องระบุเหตุผล)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.waive_late_penalty(
  _submission_id uuid,
  _waived boolean,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_student uuid;
  v_row record;
BEGIN
  SELECT a.course_id, s.student_id INTO v_course_id, v_student
  FROM public.assignment_submissions s
  JOIN public.assignments a ON a.id = s.assignment_id
  WHERE s.id = _submission_id;

  IF v_course_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบการส่งงานนี้' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (public.is_course_instructor(v_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้การส่งงานของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _waived AND btrim(COALESCE(_reason, '')) = '' THEN
    RAISE EXCEPTION 'การยกเว้นการหักคะแนนต้องระบุเหตุผล' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.assignment_submissions
     SET late_penalty_waived = _waived,
         late_waiver_reason = CASE WHEN _waived THEN btrim(_reason) ELSE NULL END
   WHERE id = _submission_id;

  SELECT late_days, penalty_points, net_score, score INTO v_row
  FROM public.assignment_submissions WHERE id = _submission_id;

  PERFORM public.log_audit_event(
    'assignment.late_waiver', 'submission', _submission_id::text,
    CASE WHEN _waived THEN 'ยกเว้นการหักคะแนนส่งช้า' ELSE 'ยกเลิกการยกเว้นการหักคะแนนส่งช้า' END
      || ' · คะแนนสุทธิใหม่ ' || COALESCE(v_row.net_score::text, '-'),
    NULL::jsonb,
    jsonb_build_object('late_days', v_row.late_days, 'penalty_points', v_row.penalty_points,
                       'net_score', v_row.net_score),
    _reason);

  RETURN jsonb_build_object('late_days', v_row.late_days,
                            'penalty_points', v_row.penalty_points,
                            'raw_score', v_row.score,
                            'net_score', v_row.net_score);
END;
$$;

REVOKE ALL ON FUNCTION public.waive_late_penalty(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waive_late_penalty(uuid, boolean, text) TO authenticated;
