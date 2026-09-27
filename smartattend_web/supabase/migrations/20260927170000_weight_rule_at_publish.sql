-- แยกกฎ "น้ำหนักรวมต้องเท่ากับ 100" ออกจากการบันทึกคะแนน
--
-- ของเดิม การตรวจน้ำหนักอยู่ในขั้นตอนบันทึกคะแนน (saveAll ในหน้าจอ)
--   1. อาจารย์ที่ยังตั้งน้ำหนักไม่ครบ กรอกคะแนนระหว่างเทอมไม่ได้เลย ทั้งที่
--      สองเรื่องนี้ไม่เกี่ยวกัน — ต้นเทอมยังไม่รู้ว่าจะมีงานกี่ชิ้นเป็นเรื่องปกติ
--   2. เป็นการตรวจฝั่งเบราว์เซอร์ล้วน ยิง REST ตรงเลี่ยงได้ทั้งหมด
--
-- ของใหม่ ย้ายกฎไปไว้ที่ "จุดที่มันสำคัญจริง" คือตอนประกาศผล
--   - ระหว่างเทอม น้ำหนักไม่ครบ 100 ได้ กรอกคะแนนได้ปกติ หน้าจอเตือนค้างไว้
--   - ตอนประกาศผล ฐานข้อมูลปฏิเสธถ้าน้ำหนักรวมไม่เท่ากับ 100 พอดี
--   - constraint trigger แบบ deferrable initially deferred กันการแก้น้ำหนักให้
--     เพี้ยนหลังประกาศผลแล้ว โดยตรวจตอน commit จึงยังแก้ทั้งชุดในทรานแซกชัน
--     เดียวได้ (เช่นย้ายน้ำหนัก 10% จากหัวข้อ A ไป B)
--
-- ทำไมไม่บังคับ 100 ตลอดเวลา
--   ถ้าบังคับตั้งแต่แถวแรก อาจารย์จะสร้างหัวข้อแรกไม่ได้เลย เพราะหัวข้อเดียว
--   น้ำหนัก 20% ก็ผิดกฎแล้ว ต้องสร้างครบทุกหัวข้อในทรานแซกชันเดียวเท่านั้น
--   ซึ่งขัดกับการทำงานจริงที่ทยอยเพิ่มงานตลอดเทอม

-- ── ผลรวมน้ำหนักของรายวิชา ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.course_total_weight(_course_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(sum(weight), 0)
  FROM public.grade_items
  WHERE course_id = _course_id;
$$;

GRANT EXECUTE ON FUNCTION public.course_total_weight(uuid) TO authenticated;

-- ── กันน้ำหนักเพี้ยนหลังประกาศผลแล้ว ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_published_course_weight()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_course_id uuid := COALESCE(NEW.course_id, OLD.course_id);
  v_published boolean;
  v_total numeric;
BEGIN
  SELECT final_grade_published INTO v_published
  FROM public.courses WHERE id = v_course_id;

  -- รายวิชาถูกลบไปแล้ว (cascade) ไม่มีอะไรต้องตรวจ
  IF v_published IS NULL THEN RETURN NULL; END IF;
  -- ยังไม่ประกาศผล น้ำหนักไม่ครบได้ตามปกติ
  IF NOT v_published THEN RETURN NULL; END IF;

  v_total := public.course_total_weight(v_course_id);
  IF round(v_total, 2) <> 100 THEN
    RAISE EXCEPTION 'รายวิชานี้ประกาศผลแล้ว น้ำหนักคะแนนรวมต้องเท่ากับ 100 พอดี (ขณะนี้ %)', v_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_published_course_weight ON public.grade_items;
CREATE CONSTRAINT TRIGGER trg_published_course_weight
  AFTER INSERT OR UPDATE OR DELETE ON public.grade_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_published_course_weight();

-- ── ประกาศผล: ตรวจน้ำหนักที่ฐานข้อมูล ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_final_grades(_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total numeric;
  _items integer;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ประกาศผลของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*), COALESCE(sum(weight), 0) INTO _items, _total
  FROM public.grade_items WHERE course_id = _course_id;

  IF _items = 0 THEN
    RAISE EXCEPTION 'ยังไม่มีหัวข้อคะแนนในรายวิชานี้ ประกาศผลไม่ได้'
      USING ERRCODE = 'check_violation';
  END IF;

  -- กฎน้ำหนักรวม 100 บังคับ "ที่นี่" ไม่ใช่ตอนกรอกคะแนน
  IF round(_total, 2) <> 100 THEN
    RAISE EXCEPTION 'น้ำหนักคะแนนรวมต้องเท่ากับ 100 พอดีก่อนประกาศผล (ขณะนี้ %)', _total
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.courses SET final_grade_published = true WHERE id = _course_id;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  SELECT ce.student_id, 'grade_posted', 'ประกาศผลคะแนนปลายภาคแล้ว',
    'วิชา ' || c.code || ' ประกาศผลสอบปลายภาคและเกรดรวมแล้ว เข้าไปดูได้ที่หน้าคะแนนเก็บ',
    _course_id, false, 'unread'
  FROM public.course_enrollments ce
  JOIN public.courses c ON c.id = _course_id
  WHERE ce.course_id = _course_id AND ce.status = 'confirmed' AND ce.student_id IS NOT NULL;

  PERFORM public.log_audit_event(
    'grade.announce', 'course', _course_id::text,
    'ประกาศผลคะแนนปลายภาคและเกรดรวม (น้ำหนักรวม ' || _total::text || '%)',
    NULL::jsonb, NULL::jsonb, NULL::text);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_final_grades(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_final_grades(uuid) TO authenticated;

-- ── บันทึกน้ำหนักของหัวข้อทั้งชุดในทรานแซกชันเดียว ────────────────────────
-- ใช้เวลาต้องรีบาลานซ์น้ำหนัก เช่นย้าย 10% จากหัวข้อ A ไป B — ถ้าแก้ทีละแถว
-- รายวิชาที่ประกาศผลแล้วจะติด constraint กลางทาง
CREATE OR REPLACE FUNCTION public.save_grade_item_weights(
  _course_id uuid,
  _weights jsonb,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w jsonb;
  _n integer := 0;
  _before jsonb;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้น้ำหนักคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'weight', weight) ORDER BY created_at)
    INTO _before
  FROM public.grade_items WHERE course_id = _course_id;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_weights, '[]'::jsonb)) e
    WHERE (e->>'weight') IS NULL
       OR (e->>'weight')::numeric < 0
       OR (e->>'weight')::numeric > 100
  ) THEN
    RAISE EXCEPTION 'น้ำหนักทุกหัวข้อต้องอยู่ระหว่าง 0 - 100%%' USING ERRCODE = 'check_violation';
  END IF;

  FOR w IN SELECT * FROM jsonb_array_elements(COALESCE(_weights, '[]'::jsonb)) LOOP
    UPDATE public.grade_items
       SET weight = (w->>'weight')::numeric
     WHERE id = (w->>'id')::uuid AND course_id = _course_id;
    IF FOUND THEN _n := _n + 1; END IF;
  END LOOP;

  PERFORM public.log_audit_event(
    'grade_item.weights', 'course', _course_id::text,
    'ปรับน้ำหนักหัวข้อคะแนน ' || _n::text || ' หัวข้อ · น้ำหนักรวมใหม่ '
      || public.course_total_weight(_course_id)::text || '%',
    _before, _weights, _reason);

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.save_grade_item_weights(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_grade_item_weights(uuid, jsonb, text) TO authenticated;
