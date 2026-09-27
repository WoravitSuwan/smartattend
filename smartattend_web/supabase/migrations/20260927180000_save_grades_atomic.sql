-- บันทึกคะแนนทั้งชุดในทรานแซกชันเดียว
--
-- ของเดิม หน้าจอใช้ Promise.all ยิง upsert_student_grade ทีละช่อง
--   ถ้าช่องที่ 40 ล้มเหลว ช่อง 1-39 ถูกบันทึกไปแล้ว หน้าจอกับฐานข้อมูลไม่ตรงกัน
--   และข้อความที่ผู้ใช้เห็นคือ "บันทึกไม่สำเร็จ 1 รายการ" โดยไม่รู้ว่าช่องไหน
--   อาจารย์ที่กรอกคะแนนทั้งห้องแล้วเจอแบบนี้ ต้องเดาว่าอะไรเข้าไปแล้วอะไรไม่เข้า
--
-- ของใหม่ RPC เดียว สองรอบ
--   รอบตรวจ  ตรวจทุกแถวก่อน ถ้ามีแถวใดผิด คืนรายการที่ผิดทั้งหมดพร้อมเหตุผล
--            โดยยังไม่เขียนอะไรเลย (จึงไม่มีอะไรต้องย้อนกลับ)
--   รอบเขียน ผ่านแล้วจึงเขียนทั้งชุดพร้อม audit log ทุกแถว
--            ถ้าเกิดข้อผิดพลาดที่คาดไม่ถึงตอนเขียน exception จะ rollback ทั้งก้อน
--
-- คืน jsonb: {ok, saved, errors:[{grade_item_id, student_id, reason}]}
-- หน้าจอเอา errors ไปไฮไลต์ช่องที่ผิดได้ตรงช่อง

CREATE OR REPLACE FUNCTION public.save_student_grades(
  _course_id uuid,
  _changes jsonb,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c jsonb;
  _errors jsonb := '[]'::jsonb;
  _saved integer := 0;
  _item record;
  _score numeric;
  _row_id uuid;
  _old_score numeric;
  _published boolean;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้คะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'array' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลคะแนนไม่ถูกต้อง' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF jsonb_array_length(_changes) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'saved', 0, 'errors', '[]'::jsonb);
  END IF;

  SELECT final_grade_published INTO _published FROM public.courses WHERE id = _course_id;

  -- ── รอบที่ 1: ตรวจทุกแถว ยังไม่เขียนอะไร ────────────────────────────────
  FOR c IN SELECT * FROM jsonb_array_elements(_changes) LOOP
    _item := NULL;
    SELECT gi.id, gi.name, gi.max_score, gi.course_id
      INTO _item
    FROM public.grade_items gi
    WHERE gi.id = (c->>'grade_item_id')::uuid;

    IF _item.id IS NULL THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', c->>'grade_item_id', 'student_id', c->>'student_id',
        'reason', 'ไม่พบหัวข้อคะแนนนี้ (อาจถูกลบไปแล้ว)');
      CONTINUE;
    END IF;

    IF _item.course_id <> _course_id THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', c->>'grade_item_id', 'student_id', c->>'student_id',
        'reason', 'หัวข้อคะแนนนี้ไม่ได้อยู่ในรายวิชานี้');
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.course_enrollments ce
      WHERE ce.course_id = _course_id
        AND ce.student_id = (c->>'student_id')::uuid
        AND ce.status = 'confirmed'
    ) THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'นักศึกษาคนนี้ไม่ได้ลงทะเบียนรายวิชานี้');
      CONTINUE;
    END IF;

    IF (c->'score') IS NULL OR jsonb_typeof(c->'score') = 'null' THEN
      CONTINUE;   -- ลบคะแนนออก ใช้ได้
    END IF;

    IF jsonb_typeof(c->'score') <> 'number' THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'คะแนนไม่ใช่ตัวเลข');
      CONTINUE;
    END IF;

    _score := (c->>'score')::numeric;

    IF _item.max_score IS NULL OR _item.max_score <= 0 THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'หัวข้อ "' || _item.name || '" ยังตั้งคะแนนเต็มไม่ถูกต้อง');
    ELSIF _score < 0 THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'คะแนนติดลบไม่ได้');
    ELSIF _score > _item.max_score THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'เกินคะแนนเต็ม (' || _item.max_score::text || ')');
    END IF;
  END LOOP;

  -- มีแถวผิด: คืนรายการทั้งหมด ยังไม่เขียนอะไรเลย
  IF jsonb_array_length(_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'saved', 0, 'errors', _errors);
  END IF;

  -- ── รอบที่ 2: เขียนทั้งชุด ────────────────────────────────────────────────
  -- ถึงจุดนี้ทุกแถวผ่านการตรวจแล้ว ถ้ายังล้มเหลวจะเป็นข้อผิดพลาดที่คาดไม่ถึง
  -- exception จะทำให้ทรานแซกชันทั้งก้อน rollback ไม่มีการบันทึกครึ่ง ๆ กลาง ๆ
  FOR c IN SELECT * FROM jsonb_array_elements(_changes) LOOP
    _score := CASE WHEN jsonb_typeof(c->'score') = 'number'
                   THEN (c->>'score')::numeric ELSE NULL END;

    SELECT id, score INTO _row_id, _old_score
    FROM public.student_grades
    WHERE grade_item_id = (c->>'grade_item_id')::uuid
      AND student_id = (c->>'student_id')::uuid;

    IF _row_id IS NULL THEN
      INSERT INTO public.student_grades (grade_item_id, student_id, score, note)
      VALUES ((c->>'grade_item_id')::uuid, (c->>'student_id')::uuid, _score, c->>'note')
      RETURNING id INTO _row_id;
      _old_score := NULL;
    ELSE
      UPDATE public.student_grades
         SET score = _score, note = COALESCE(c->>'note', note)
       WHERE id = _row_id;
    END IF;

    IF _old_score IS DISTINCT FROM _score THEN
      INSERT INTO public.grade_audit_logs
        (student_grade_id, modified_by, previous_score, new_score, reason)
      VALUES (_row_id, auth.uid(), _old_score, _score,
              CASE WHEN COALESCE(_published, false)
                   THEN COALESCE(_reason || ' · ', '') || 'แก้ไขหลังประกาศผลแล้ว'
                   ELSE _reason END);
      _saved := _saved + 1;
    END IF;
  END LOOP;

  PERFORM public.log_audit_event(
    'grade.update', 'course', _course_id::text,
    'บันทึกคะแนน ' || _saved::text || ' รายการ'
      || CASE WHEN COALESCE(_published, false) THEN ' (รายวิชาประกาศผลแล้ว)' ELSE '' END,
    NULL::jsonb, NULL::jsonb, _reason);

  RETURN jsonb_build_object('ok', true, 'saved', _saved, 'errors', '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.save_student_grades(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_student_grades(uuid, jsonb, text) TO authenticated;
