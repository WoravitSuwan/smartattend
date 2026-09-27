-- แก้หัวข้อคะแนนโดยคะแนนของนักศึกษาไม่หาย และให้อาจารย์เลือกวิธีจัดการคะแนน
-- ที่เกินคะแนนเต็มใหม่
--
-- ของเดิม (migration 20260927110000) ลดคะแนนเต็มแล้ว clamp คะแนนที่เกินลงมา
-- เป็นค่าใหม่ให้เลย ซึ่งเป็นการตัดสินใจแทนอาจารย์
--   ถ้าเต็ม 100 ลดเป็น 50 แล้วคนได้ 80 กับคนได้ 100 จะกลายเป็น 50 เท่ากันทั้งคู่
--   ลำดับที่ของนักศึกษาหายไปเงียบ ๆ
--
-- ของใหม่: _on_overflow เลือกได้ 3 แบบ
--   'reject'  (ค่าเริ่มต้น) ปฏิเสธการแก้ พร้อมบอกว่ากระทบกี่คน ให้อาจารย์ตัดสินใจ
--   'rescale' ปรับคะแนนทุกคนตามอัตราส่วน newMax/oldMax — รักษาลำดับที่และ
--             สัดส่วนคะแนนไว้ เหมาะกับกรณี "เปลี่ยนคะแนนเต็มของข้อสอบเดิม"
--   'clamp'   ตัดเฉพาะคนที่เกินให้เท่าเพดานใหม่ เหมาะกับกรณี "ตัดข้อออก"
-- ทุกแบบลง grade_audit_logs ทุกแถวที่เปลี่ยน

CREATE OR REPLACE FUNCTION public.save_grade_item(
  _course_id uuid,
  _name text,
  _category text,
  _max_score numeric,
  _weight numeric,
  _item_id uuid DEFAULT NULL,
  _on_overflow text DEFAULT 'reject',
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _before jsonb;
  _old_max numeric;
  _over_count integer := 0;
  _changed integer := 0;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้หัวข้อคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  _name := btrim(COALESCE(_name, ''));
  IF _name = '' THEN
    RAISE EXCEPTION 'กรุณาระบุชื่อหัวข้อคะแนน' USING ERRCODE = 'check_violation';
  END IF;
  IF _category NOT IN ('attendance','assignment','midterm','final','other') THEN
    RAISE EXCEPTION 'ประเภทคะแนนไม่ถูกต้อง' USING ERRCODE = 'check_violation';
  END IF;
  IF _max_score IS NULL OR _max_score = 'NaN'::numeric OR _max_score <= 0 THEN
    RAISE EXCEPTION 'คะแนนเต็มต้องมากกว่า 0' USING ERRCODE = 'check_violation';
  END IF;
  IF _weight IS NULL OR _weight = 'NaN'::numeric OR _weight < 0 OR _weight > 100 THEN
    RAISE EXCEPTION 'น้ำหนักต้องอยู่ระหว่าง 0 - 100%%' USING ERRCODE = 'check_violation';
  END IF;
  IF _on_overflow NOT IN ('reject','rescale','clamp') THEN
    RAISE EXCEPTION 'วิธีจัดการคะแนนที่เกินไม่ถูกต้อง' USING ERRCODE = 'check_violation';
  END IF;

  -- ── สร้างใหม่ ────────────────────────────────────────────────────────────
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
      _reason);
    RETURN jsonb_build_object('item_id', _id, 'adjusted', 0, 'action', 'created');
  END IF;

  -- ── แก้ไขของเดิม ─────────────────────────────────────────────────────────
  SELECT max_score,
         jsonb_build_object('name', name, 'category', category,
                            'max_score', max_score, 'weight', weight)
    INTO _old_max, _before
  FROM public.grade_items
  WHERE id = _item_id AND course_id = _course_id;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'ไม่พบหัวข้อคะแนนนี้ (อาจถูกลบไปแล้ว)' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO _over_count
  FROM public.student_grades
  WHERE grade_item_id = _item_id AND score IS NOT NULL AND score > _max_score;

  IF _over_count > 0 AND _on_overflow = 'reject' THEN
    RAISE EXCEPTION 'มีคะแนนของนักศึกษา % คนที่เกินคะแนนเต็มใหม่ (%) กรุณาเลือกวิธีจัดการก่อน',
      _over_count, _max_score
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.grade_items
     SET name = _name, category = _category, max_score = _max_score, weight = _weight
   WHERE id = _item_id;

  IF _over_count > 0 AND _on_overflow = 'rescale'
     AND _old_max IS NOT NULL AND _old_max > 0 THEN
    -- ปรับ "ทุกคน" ตามอัตราส่วน ไม่ใช่เฉพาะคนที่เกิน ไม่งั้นสัดส่วนระหว่างคนจะเพี้ยน
    -- ต้องเก็บคะแนนเดิมไว้ใน CTE ก่อน เพราะ RETURNING ของ UPDATE ให้ค่าใหม่
    -- การคำนวณค่าเดิมย้อนกลับจากค่าใหม่จะคลาดเคลื่อนและลง audit log ผิด
    WITH snap AS (
      SELECT id, score AS old_score
      FROM public.student_grades
      WHERE grade_item_id = _item_id AND score IS NOT NULL
    ), upd AS (
      UPDATE public.student_grades sg
         SET score = LEAST(round(s.old_score * (_max_score / _old_max), 2), _max_score)
        FROM snap s
       WHERE sg.id = s.id
      RETURNING sg.id, s.old_score, sg.score AS new_score
    )
    INSERT INTO public.grade_audit_logs
      (student_grade_id, modified_by, previous_score, new_score, reason)
    SELECT u.id, auth.uid(), u.old_score, u.new_score,
           COALESCE(_reason || ' · ', '')
           || 'ปรับคะแนนตามอัตราส่วนเมื่อเปลี่ยนคะแนนเต็มจาก '
           || _old_max::text || ' เป็น ' || _max_score::text
    FROM upd u
    WHERE u.old_score IS DISTINCT FROM u.new_score;
    GET DIAGNOSTICS _changed = ROW_COUNT;

  ELSIF _over_count > 0 AND _on_overflow = 'clamp' THEN
    WITH over_max AS (
      SELECT id, score FROM public.student_grades
      WHERE grade_item_id = _item_id AND score > _max_score
    ), upd AS (
      UPDATE public.student_grades sg SET score = _max_score
      FROM over_max o WHERE sg.id = o.id
      RETURNING sg.id, o.score AS old_score
    )
    INSERT INTO public.grade_audit_logs
      (student_grade_id, modified_by, previous_score, new_score, reason)
    SELECT u.id, auth.uid(), u.old_score, _max_score,
           COALESCE(_reason || ' · ', '')
           || 'ตัดคะแนนที่เกินลงเป็นคะแนนเต็มใหม่ ' || _max_score::text
    FROM upd u;
    GET DIAGNOSTICS _changed = ROW_COUNT;
  END IF;

  PERFORM public.log_audit_event(
    'grade_item.update', 'grade_item', _item_id::text,
    'แก้ไขหัวข้อคะแนน "' || _name || '"'
      || CASE WHEN _changed > 0
              THEN ' · ' || CASE _on_overflow
                              WHEN 'rescale' THEN 'ปรับคะแนนตามอัตราส่วน '
                              ELSE 'ตัดคะแนนที่เกิน ' END
                   || _changed::text || ' รายการ'
              ELSE '' END,
    _before,
    jsonb_build_object('name', _name, 'category', _category,
                       'max_score', _max_score, 'weight', _weight,
                       'on_overflow', _on_overflow, 'adjusted', _changed),
    _reason);

  RETURN jsonb_build_object('item_id', _item_id, 'adjusted', _changed,
                            'action', 'updated', 'on_overflow', _on_overflow);
END;
$$;

REVOKE ALL ON FUNCTION public.save_grade_item(uuid, text, text, numeric, numeric, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_grade_item(uuid, text, text, numeric, numeric, uuid, text, text)
  TO authenticated;

-- เลิกใช้ลายเซ็นเดิม (6 พารามิเตอร์) เพื่อไม่ให้มีสองทางที่พฤติกรรมต่างกัน
DROP FUNCTION IF EXISTS public.save_grade_item(uuid, text, text, numeric, numeric, uuid);

-- ── นับจำนวนคะแนนที่จะหายถ้าลบหัวข้อ ให้หน้าจอถามยืนยันได้ตรงตัวเลข ────────
CREATE OR REPLACE FUNCTION public.grade_item_score_count(_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _course_id uuid; _n integer;
BEGIN
  SELECT course_id INTO _course_id FROM public.grade_items WHERE id = _item_id;
  IF _course_id IS NULL THEN RETURN 0; END IF;
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูข้อมูลของรายวิชานี้' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO _n FROM public.student_grades
   WHERE grade_item_id = _item_id AND score IS NOT NULL;
  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grade_item_score_count(uuid) TO authenticated;

-- ── ลบหัวข้อคะแนน: บังคับส่งชื่อหัวข้อมายืนยัน ─────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_grade_item(
  _item_id uuid,
  _reason text DEFAULT NULL,
  _confirm_name text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _course_id uuid;
  _name text;
  _snapshot jsonb;
  _scores integer;
BEGIN
  SELECT course_id, name,
         jsonb_build_object('name', name, 'category', category,
                            'max_score', max_score, 'weight', weight)
    INTO _course_id, _name, _snapshot
  FROM public.grade_items WHERE id = _item_id;
  IF _course_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบหัวข้อคะแนนนี้ (อาจถูกลบไปแล้ว)' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ลบหัวข้อคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO _scores
  FROM public.student_grades
  WHERE grade_item_id = _item_id AND score IS NOT NULL;

  -- หัวข้อที่มีคะแนนอยู่แล้ว ต้องพิมพ์ชื่อหัวข้อยืนยัน
  -- กันการกดพลาดที่ทำให้คะแนนทั้งห้องหายโดยกู้ไม่ได้
  IF _scores > 0 AND btrim(COALESCE(_confirm_name, '')) <> _name THEN
    RAISE EXCEPTION 'หัวข้อนี้มีคะแนนของนักศึกษา % คน ต้องพิมพ์ชื่อหัวข้อ "%" เพื่อยืนยันการลบ',
      _scores, _name
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.grade_items WHERE id = _item_id;

  PERFORM public.log_audit_event(
    'grade_item.delete', 'grade_item', _item_id::text,
    'ลบหัวข้อคะแนน "' || _name || '" พร้อมคะแนนนักศึกษา ' || _scores::text || ' รายการ',
    _snapshot, NULL::jsonb, _reason);

  RETURN _scores;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_grade_item(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_grade_item(uuid, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.delete_grade_item(uuid, text);
