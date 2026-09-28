-- ═══════════════════════════════════════════════════════════════════════════
--  บันทึก "รายการคะแนนทั้งหมดของหมวดหนึ่ง" ในทรานแซกชันเดียว
--
--  ทำไมต้องมี
--    หน้าจอฝั่งอาจารย์ยังสร้าง/แก้รายการคะแนนผ่าน save_grade_item ซึ่งเป็น RPC
--    ของโครงสร้างเดิม มันเขียน grade_items.weight (คอลัมน์ที่เลิกใช้แล้ว) และ
--    ไม่ตั้ง component_id ให้เลย ผลคือรายการที่สร้างจากหน้าจอกลายเป็นรายการ
--    ที่ไม่อยู่ในหมวดใด ไม่ถูกนับในคะแนน และมีน้ำหนักสองชุดในระบบพร้อมกัน
--
--    RPC นี้เขียนให้ตรงกับโครงสร้างสามระดับ
--      - component_id ตั้งให้ทุกแถวเสมอ
--      - max_score เป็นคะแนนดิบ
--      - weight_in_component ใช้เฉพาะหมวดโหมด weighted_items
--      - position มาจากลำดับในอาเรย์ที่ส่งมา
--      - category (คอลัมน์เดิม) เดามาจาก kind ของหมวด เพื่อให้ข้อมูลเดิมและ
--        นโยบาย RLS ที่ยังอ่าน category อยู่ไม่เพี้ยน
--      - weight (คอลัมน์ที่เลิกใช้) ไม่ถูกเขียนเลย แถวใหม่ได้ค่า default 0
--
--  ทำไมต้องบันทึกทั้งหมวดในครั้งเดียว
--    trigger trg_component_item_weights เป็น CONSTRAINT TRIGGER แบบ DEFERRABLE
--    INITIALLY DEFERRED ที่บังคับว่าน้ำหนักย่อยในหมวดโหมด weighted_items ต้อง
--    รวมได้ 100 พอดี การบันทึกทีละรายการจะผิดกฎกลางทางเสมอ (เช่นแก้จาก 60/40
--    เป็น 50/50 รายการแรกที่บันทึกทำให้ผลรวมเป็น 90) ส่งมาทั้งชุดจึงตรวจ
--    ตอน COMMIT ครั้งเดียวและผ่าน
--
--  กฎที่ยึดไว้เหมือนเดิม
--    - ลบรายการที่มีคะแนนของนักศึกษาอยู่ "ไม่ได้" จาก RPC นี้ ต้องไปใช้
--      delete_grade_item ที่บังคับให้พิมพ์ชื่อรายการยืนยัน
--    - ลดคะแนนเต็มแล้วมีคะแนนเกิน ต้องให้อาจารย์เลือกวิธี (reject/rescale/clamp)
--      ไม่ตัดสินใจแทน และทุกการปรับลง grade_audit_logs ทุกแถว
--    - รายการที่คะแนนมาจากที่อื่น (source <> 'manual' เช่นดึงจากการตรวจงาน)
--      แก้ได้แต่ลำดับและน้ำหนักย่อย ชื่อกับคะแนนเต็มยังมาจากต้นทาง
--    - คะแนนถูกล็อกหลังประกาศผล แก้โครงสร้างไม่ได้จนกว่าจะปลดล็อก
-- ═══════════════════════════════════════════════════════════════════════════

/** category เดิมที่ตรงกับ kind ของหมวด — คอลัมน์ category เป็น NOT NULL CHECK
 *  และยังมีนโยบาย RLS ที่อ่านมันอยู่ จึงต้องเติมให้ถูกทุกแถว */
CREATE OR REPLACE FUNCTION public.category_of_component_kind(_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _kind
           WHEN 'attendance' THEN 'attendance'
           WHEN 'assignment' THEN 'assignment'
           WHEN 'lab'        THEN 'assignment'
           WHEN 'midterm'    THEN 'midterm'
           WHEN 'final'      THEN 'final'
           ELSE 'other'
         END;
$$;

COMMENT ON FUNCTION public.category_of_component_kind(text) IS
  'แปลง kind ของหมวดคะแนนเป็น category เดิมของ grade_items '
  'quiz กับ affective ไม่มี category ที่ตรงกัน จึงลงเป็น other';

CREATE OR REPLACE FUNCTION public.save_component_items(
  _component_id uuid,
  _items jsonb,
  _delete_missing boolean DEFAULT false,
  _on_overflow text DEFAULT 'reject',
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_kind text;
  v_category text;
  v_calc_mode text;
  v_component_name text;
  it jsonb;
  i integer := 0;
  v_id uuid;
  v_name text;
  v_max numeric;
  v_wic numeric;
  v_source text;
  v_old_name text;
  v_old_max numeric;
  v_over integer;
  v_changed integer;
  v_keep uuid[] := '{}';
  v_created integer := 0;
  v_updated integer := 0;
  v_adjusted integer := 0;
  v_removed integer := 0;
  v_blocked text[] := '{}';
  v_before jsonb;
  v_names text[] := '{}';
BEGIN
  SELECT gc.course_id, gc.kind, gc.calc_mode, gc.name
    INTO v_course_id, v_kind, v_calc_mode, v_component_name
  FROM public.grade_components gc WHERE gc.id = _component_id;

  IF v_course_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบหมวดคะแนนนี้ (อาจถูกลบไปแล้ว)' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.is_course_instructor(v_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้รายการคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.course_grades_locked(v_course_id) THEN
    RAISE EXCEPTION 'คะแนนของรายวิชานี้ถูกล็อกหลังประกาศผล ต้องปลดล็อกพร้อมระบุเหตุผลก่อนแก้โครงสร้าง'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลรายการคะแนนไม่ถูกต้อง' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF _on_overflow NOT IN ('reject','rescale','clamp') THEN
    RAISE EXCEPTION 'วิธีจัดการคะแนนที่เกินไม่ถูกต้อง' USING ERRCODE = 'check_violation';
  END IF;

  v_category := public.category_of_component_kind(v_kind);

  -- ── สภาพก่อนแก้ ไว้ลง audit log ────────────────────────────────────────
  SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'max_score', max_score,
           'weight_in_component', weight_in_component, 'position', position)
         ORDER BY position)
    INTO v_before
  FROM public.grade_items WHERE component_id = _component_id;

  -- ── ไล่ทีละรายการตามลำดับที่ส่งมา ──────────────────────────────────────
  FOR it IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    i := i + 1;
    v_id   := NULLIF(it->>'id', '')::uuid;
    v_name := btrim(COALESCE(it->>'name', ''));
    v_max  := NULLIF(it->>'max_score', '')::numeric;
    v_wic  := COALESCE(NULLIF(it->>'weight_in_component', '')::numeric, 0);

    IF v_name = '' THEN
      RAISE EXCEPTION 'รายการที่ % ยังไม่ได้ใส่ชื่อ', i USING ERRCODE = 'check_violation';
    END IF;
    IF v_name = ANY (v_names) THEN
      RAISE EXCEPTION 'ชื่อรายการ "%" ซ้ำกันในหมวดเดียวกัน', v_name
        USING ERRCODE = 'check_violation';
    END IF;
    v_names := v_names || v_name;

    IF v_max IS NULL OR v_max = 'NaN'::numeric OR v_max <= 0 THEN
      RAISE EXCEPTION 'คะแนนเต็มของ "%" ต้องมากกว่า 0', v_name USING ERRCODE = 'check_violation';
    END IF;
    IF v_wic = 'NaN'::numeric OR v_wic < 0 OR v_wic > 100 THEN
      RAISE EXCEPTION 'น้ำหนักย่อยของ "%" ต้องอยู่ระหว่าง 0 - 100', v_name
        USING ERRCODE = 'check_violation';
    END IF;

    -- ── รายการใหม่ ──────────────────────────────────────────────────────
    IF v_id IS NULL THEN
      INSERT INTO public.grade_items
        (course_id, component_id, name, category, max_score,
         weight_in_component, position, source)
      VALUES (v_course_id, _component_id, v_name, v_category, v_max,
              v_wic, i, 'manual')
      RETURNING id INTO v_id;
      v_created := v_created + 1;
      v_keep := v_keep || v_id;
      CONTINUE;
    END IF;

    -- ── รายการเดิม ──────────────────────────────────────────────────────
    SELECT name, max_score, source INTO v_old_name, v_old_max, v_source
    FROM public.grade_items
    WHERE id = v_id AND course_id = v_course_id;

    IF v_old_name IS NULL THEN
      RAISE EXCEPTION 'ไม่พบรายการคะแนน "%" ในรายวิชานี้ (อาจถูกลบไปแล้ว)', v_name
        USING ERRCODE = 'no_data_found';
    END IF;

    v_keep := v_keep || v_id;

    -- รายการที่คะแนนมาจากที่อื่น: ชื่อกับคะแนนเต็มเป็นของต้นทาง แก้ที่นี่ไม่ได้
    IF v_source <> 'manual' THEN
      UPDATE public.grade_items
         SET component_id = _component_id,
             weight_in_component = v_wic,
             position = i
       WHERE id = v_id;
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    -- ลดคะแนนเต็มแล้วมีคะแนนเกิน ต้องให้อาจารย์เลือกวิธีก่อน
    SELECT count(*) INTO v_over
    FROM public.student_grades
    WHERE grade_item_id = v_id AND score IS NOT NULL AND score > v_max;

    IF v_over > 0 AND _on_overflow = 'reject' THEN
      RAISE EXCEPTION 'มีคะแนนของนักศึกษา % คนที่เกินคะแนนเต็มใหม่ (%) ของ "%" กรุณาเลือกวิธีจัดการก่อน',
        v_over, v_max, v_name
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.grade_items
       SET component_id = _component_id,
           name = v_name,
           category = v_category,
           max_score = v_max,
           weight_in_component = v_wic,
           position = i
     WHERE id = v_id;
    v_updated := v_updated + 1;

    v_changed := 0;
    IF v_over > 0 AND _on_overflow = 'rescale' AND v_old_max > 0 THEN
      -- ปรับทุกคนตามอัตราส่วน ไม่ใช่เฉพาะคนที่เกิน ไม่งั้นสัดส่วนระหว่างคนจะเพี้ยน
      -- ต้องเก็บคะแนนเดิมไว้ก่อน เพราะ RETURNING ของ UPDATE คืนค่าใหม่
      WITH snap AS (
        SELECT id, score AS old_score FROM public.student_grades
        WHERE grade_item_id = v_id AND score IS NOT NULL
      ), upd AS (
        UPDATE public.student_grades sg
           SET score = LEAST(round(s.old_score * (v_max / v_old_max), 2), v_max)
          FROM snap s WHERE sg.id = s.id
        RETURNING sg.id, s.old_score, sg.score AS new_score
      )
      INSERT INTO public.grade_audit_logs
        (student_grade_id, modified_by, previous_score, new_score, reason)
      SELECT u.id, auth.uid(), u.old_score, u.new_score,
             COALESCE(_reason || ' · ', '')
             || 'ปรับคะแนนตามอัตราส่วนเมื่อเปลี่ยนคะแนนเต็มของ "' || v_name
             || '" จาก ' || v_old_max::text || ' เป็น ' || v_max::text
      FROM upd u WHERE u.old_score IS DISTINCT FROM u.new_score;
      GET DIAGNOSTICS v_changed = ROW_COUNT;

    ELSIF v_over > 0 AND _on_overflow = 'clamp' THEN
      WITH over_max AS (
        SELECT id, score FROM public.student_grades
        WHERE grade_item_id = v_id AND score > v_max
      ), upd AS (
        UPDATE public.student_grades sg SET score = v_max
        FROM over_max o WHERE sg.id = o.id
        RETURNING sg.id, o.score AS old_score
      )
      INSERT INTO public.grade_audit_logs
        (student_grade_id, modified_by, previous_score, new_score, reason)
      SELECT u.id, auth.uid(), u.old_score, v_max,
             COALESCE(_reason || ' · ', '')
             || 'ตัดคะแนนที่เกินของ "' || v_name || '" ลงเป็นคะแนนเต็มใหม่ ' || v_max::text
      FROM upd u;
      GET DIAGNOSTICS v_changed = ROW_COUNT;
    END IF;
    v_adjusted := v_adjusted + COALESCE(v_changed, 0);
  END LOOP;

  -- ── รายการที่หายไปจากรายชื่อ ───────────────────────────────────────────
  IF _delete_missing THEN
    -- รายการที่มีคะแนนอยู่ ลบจากที่นี่ไม่ได้ ต้องไปใช้ delete_grade_item
    -- ที่บังคับให้พิมพ์ชื่อรายการยืนยัน — ไม่ลบคะแนนของทั้งห้องเงียบ ๆ
    SELECT COALESCE(array_agg(gi.name ORDER BY gi.position), '{}')
      INTO v_blocked
    FROM public.grade_items gi
    WHERE gi.component_id = _component_id
      AND NOT (gi.id = ANY (v_keep))
      AND EXISTS (SELECT 1 FROM public.student_grades sg
                  WHERE sg.grade_item_id = gi.id AND sg.score IS NOT NULL);

    DELETE FROM public.grade_items gi
    WHERE gi.component_id = _component_id
      AND NOT (gi.id = ANY (v_keep))
      AND NOT EXISTS (SELECT 1 FROM public.student_grades sg
                      WHERE sg.grade_item_id = gi.id AND sg.score IS NOT NULL);
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  PERFORM public.log_audit_event(
    'grade_component.items', 'grade_component', _component_id::text,
    'แก้รายการคะแนนของหมวด "' || v_component_name || '"'
      || ' · เพิ่ม ' || v_created::text
      || ' · แก้ ' || v_updated::text
      || CASE WHEN v_removed > 0 THEN ' · ลบ ' || v_removed::text ELSE '' END
      || CASE WHEN v_adjusted > 0
              THEN ' · ปรับคะแนนนักศึกษา ' || v_adjusted::text || ' รายการ' ELSE '' END,
    v_before, _items, _reason);

  RETURN jsonb_build_object(
    'component_id', _component_id,
    'created', v_created,
    'updated', v_updated,
    'removed', v_removed,
    'adjusted', v_adjusted,
    'blocked', to_jsonb(v_blocked),
    'calc_mode', v_calc_mode);
END;
$$;

REVOKE ALL ON FUNCTION public.save_component_items(uuid, jsonb, boolean, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_component_items(uuid, jsonb, boolean, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.save_component_items(uuid, jsonb, boolean, text, text) IS
  'บันทึกรายการคะแนนทั้งหมดของหมวดหนึ่งในทรานแซกชันเดียว ตั้ง component_id / '
  'max_score / weight_in_component / position ให้ครบ และไม่เขียน grade_items.weight '
  'ที่เลิกใช้แล้ว ต้องบันทึกทั้งหมวดพร้อมกันเพราะ trigger น้ำหนักย่อยรวม 100 '
  'เป็นแบบ DEFERRED ที่ตรวจตอน COMMIT';

-- ── เลิกใช้ RPC ของโครงสร้างเดิม (ขั้นที่หนึ่ง: เลิกอ่านในโค้ด) ────────────
--  ยังไม่ DROP เพราะอาจมีเซสชันเก่าค้างอยู่ และการลบฟังก์ชันไม่ใช่การแก้ที่
--  ย้อนกลับได้ง่าย ขั้นที่สองคือลบทั้ง save_grade_item, save_grade_item_weights
--  และคอลัมน์ grade_items.weight พร้อมกันในเฟสถัดไป เมื่อยืนยันว่าไม่มีใครเรียก
COMMENT ON FUNCTION public.save_grade_item(uuid, text, text, numeric, numeric, uuid, text, text) IS
  'เลิกใช้แล้ว — ใช้ save_component_items() แทน RPC นี้เขียน grade_items.weight '
  'ซึ่งเลิกใช้แล้ว และไม่ตั้ง component_id ทำให้รายการที่สร้างไม่ถูกนับในคะแนน';

COMMENT ON FUNCTION public.save_grade_item_weights(uuid, jsonb, text) IS
  'เลิกใช้แล้ว — น้ำหนักอยู่ที่ grade_components.weight_percent ใช้ save_grade_structure_v2() แทน';
