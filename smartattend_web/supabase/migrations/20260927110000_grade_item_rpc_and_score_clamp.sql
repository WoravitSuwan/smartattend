-- ═══════════════════════════════════════════════════════════════════════════
--  1. ปิดช่องกรอกคะแนนเกินเต็ม / ติดลบ ที่ระดับฐานข้อมูล
--  2. เพิ่ม RPC สำหรับ "แก้ไข" และ "ลบ" หัวข้อคะแนน พร้อม audit log
--
--  ทำไมต้องกันที่ RPC ไม่ใช่แค่ที่หน้าจอ
--    attribute max ของ <input type="number"> ไม่ได้ห้ามพิมพ์หรือวางค่าเกิน
--    มันแค่ทำให้ form invalid ซึ่งหน้านี้ไม่ได้ submit เป็น form อยู่แล้ว
--    และใครก็ยิง REST /rpc/upsert_student_grade ตรงได้ถ้ามี token อาจารย์
--    ดังนั้นด่านสุดท้ายต้องอยู่ในฐานข้อมูล
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. upsert_student_grade — clamp คะแนนให้อยู่ในช่วง 0..max_score
--    ถ้าค่าถูกปรับ จะเขียนเหตุผลต่อท้ายใน grade_audit_logs ให้ตรวจย้อนได้
--    ว่าคะแนนถูกระบบปรับ ไม่ใช่อาจารย์กรอกมาเท่านั้นจริง ๆ
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_student_grade(
  _grade_item_id uuid,
  _student_id uuid,
  _score numeric,
  _note text DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _course_id uuid;
  _max_score numeric;
  _row_id uuid;
  _old_score numeric;
  _clean numeric;
  _log_reason text;
BEGIN
  SELECT course_id, max_score INTO _course_id, _max_score
  FROM public.grade_items WHERE id = _grade_item_id;
  IF _course_id IS NULL THEN
    RAISE EXCEPTION 'grade_item_not_found';
  END IF;
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- คะแนนเต็มที่ใช้ไม่ได้ (ว่าง/0/ติดลบ) ให้ถือเป็น 100 เหมือนที่ฝั่งแอปทำ
  IF _max_score IS NULL OR _max_score <= 0 THEN
    _max_score := 100;
  END IF;

  _clean := _score;
  IF _clean IS NOT NULL THEN
    -- 'NaN'::numeric เทียบค่าได้แต่ LEAST/GREATEST จะถือว่ามากที่สุด
    -- ถ้าปล่อยผ่านจะกลายเป็นคะแนนเต็ม จึงต้องปฏิเสธไปเลย
    IF _clean = 'NaN'::numeric THEN
      RAISE EXCEPTION 'invalid_score';
    END IF;
    _clean := LEAST(GREATEST(_clean, 0), _max_score);
  END IF;

  IF _clean IS DISTINCT FROM _score THEN
    _log_reason := COALESCE(_reason || ' · ', '')
      || 'ระบบปรับคะแนนจาก ' || _score::text || ' เป็น ' || _clean::text
      || ' (ช่วงที่รับได้ 0-' || _max_score::text || ')';
  ELSE
    _log_reason := _reason;
  END IF;

  SELECT id, score INTO _row_id, _old_score
  FROM public.student_grades
  WHERE grade_item_id = _grade_item_id AND student_id = _student_id;

  IF _row_id IS NULL THEN
    INSERT INTO public.student_grades (grade_item_id, student_id, score, note)
    VALUES (_grade_item_id, _student_id, _clean, _note)
    RETURNING id INTO _row_id;
  ELSE
    UPDATE public.student_grades SET score = _clean, note = COALESCE(_note, note)
    WHERE id = _row_id;
  END IF;

  IF _old_score IS DISTINCT FROM _clean THEN
    INSERT INTO public.grade_audit_logs (student_grade_id, modified_by, previous_score, new_score, reason)
    VALUES (_row_id, auth.uid(), _old_score, _clean, _log_reason);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_student_grade(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_student_grade(uuid, uuid, numeric, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. save_grade_item — สร้างหรือแก้ไขหัวข้อคะแนน
--    ของเดิมหน้าเว็บ insert ลง grade_items ตรง ๆ และมีแต่ปุ่มลบ อาจารย์ที่
--    พิมพ์น้ำหนักผิดจึงต้องลบหัวข้อทิ้ง ซึ่ง cascade ลบคะแนนของนักศึกษา
--    ทั้งห้องไปด้วย  แก้ไขได้จึงสำคัญกว่าลบได้
--
--    ถ้าลดคะแนนเต็มลง คะแนนที่เคยบันทึกไว้เกินเต็มใหม่จะถูก clamp ตามไปด้วย
--    พร้อมลง grade_audit_logs ทุกแถว ไม่ปล่อยให้เหลือคะแนน 80 จากเต็ม 50
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_grade_item(
  _course_id uuid,
  _name text,
  _category text,
  _max_score numeric,
  _weight numeric,
  _item_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _before jsonb;
  _clamped integer := 0;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  _name := btrim(COALESCE(_name, ''));
  IF _name = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF _category NOT IN ('attendance','assignment','midterm','final','other') THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;
  IF _max_score IS NULL OR _max_score = 'NaN'::numeric OR _max_score <= 0 THEN
    RAISE EXCEPTION 'invalid_max_score';
  END IF;
  IF _weight IS NULL OR _weight = 'NaN'::numeric OR _weight < 0 OR _weight > 100 THEN
    RAISE EXCEPTION 'invalid_weight';
  END IF;

  IF _item_id IS NULL THEN
    INSERT INTO public.grade_items (course_id, name, category, max_score, weight)
    VALUES (_course_id, _name, _category, _max_score, _weight)
    RETURNING id INTO _id;

    PERFORM public.log_audit_event(
      'grade_item.create', 'grade_item', _id::text,
      'เพิ่มหัวข้อคะแนน "' || _name || '" เต็ม ' || _max_score::text
        || ' น้ำหนัก ' || _weight::text || '%',
      NULL::jsonb,
      jsonb_build_object('name', _name, 'category', _category,
                         'max_score', _max_score, 'weight', _weight),
      NULL::text);
    RETURN _id;
  END IF;

  SELECT jsonb_build_object('name', name, 'category', category,
                            'max_score', max_score, 'weight', weight)
    INTO _before
  FROM public.grade_items
  WHERE id = _item_id AND course_id = _course_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'grade_item_not_found'; END IF;

  UPDATE public.grade_items
     SET name = _name, category = _category, max_score = _max_score, weight = _weight
   WHERE id = _item_id;

  -- คะแนนที่เกินเต็มใหม่: clamp แล้วลง audit ทุกแถว
  WITH over_max AS (
    SELECT id, score FROM public.student_grades
    WHERE grade_item_id = _item_id AND score > _max_score
  ), upd AS (
    UPDATE public.student_grades sg SET score = _max_score
    FROM over_max o WHERE sg.id = o.id
    RETURNING sg.id, o.score AS old_score
  )
  INSERT INTO public.grade_audit_logs (student_grade_id, modified_by, previous_score, new_score, reason)
  SELECT u.id, auth.uid(), u.old_score, _max_score,
         'ลดคะแนนเต็มของหัวข้อเป็น ' || _max_score::text || ' ระบบจึงปรับคะแนนที่เกินลงมา'
  FROM upd u;
  GET DIAGNOSTICS _clamped = ROW_COUNT;

  PERFORM public.log_audit_event(
    'grade_item.update', 'grade_item', _item_id::text,
    'แก้ไขหัวข้อคะแนน "' || _name || '"'
      || CASE WHEN _clamped > 0
              THEN ' · ปรับคะแนนที่เกินเต็มใหม่ ' || _clamped::text || ' รายการ'
              ELSE '' END,
    _before,
    jsonb_build_object('name', _name, 'category', _category,
                       'max_score', _max_score, 'weight', _weight),
    NULL::text);

  RETURN _item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_grade_item(uuid, text, text, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_grade_item(uuid, text, text, numeric, numeric, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. delete_grade_item — ลบหัวข้อคะแนน คืนจำนวนคะแนนนักศึกษาที่หายไปด้วย
--    เพื่อให้หน้าจอบอกได้ว่ากำลังจะทิ้งคะแนนกี่รายการ และเหลือร่องรอยว่าใครลบ
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_grade_item(
  _item_id uuid,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _course_id uuid;
  _snapshot jsonb;
  _scores integer;
BEGIN
  SELECT course_id,
         jsonb_build_object('name', name, 'category', category,
                            'max_score', max_score, 'weight', weight)
    INTO _course_id, _snapshot
  FROM public.grade_items WHERE id = _item_id;
  IF _course_id IS NULL THEN RAISE EXCEPTION 'grade_item_not_found'; END IF;

  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO _scores
  FROM public.student_grades
  WHERE grade_item_id = _item_id AND score IS NOT NULL;

  DELETE FROM public.grade_items WHERE id = _item_id;

  PERFORM public.log_audit_event(
    'grade_item.delete', 'grade_item', _item_id::text,
    'ลบหัวข้อคะแนน "' || COALESCE(_snapshot->>'name', '?')
      || '" พร้อมคะแนนนักศึกษา ' || _scores::text || ' รายการ',
    _snapshot, NULL::jsonb, _reason);

  RETURN _scores;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_grade_item(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_grade_item(uuid, text) TO authenticated;
