-- ═══════════════════════════════════════════════════════════════════════════
--  ตัวช่วยเขียนกรณีทดสอบ QA — แยกจาก schema t ของชุดทดสอบ RPC เดิม
--
--  ต่างจาก t.act_as ของชุดเดิมตรงที่ชุดนี้รันบน "สคีมาเต็ม" ที่สร้างจาก
--  migration ทุกไฟล์ auth.uid() จึงเป็นตัวจริงที่อ่าน request.jwt.claims
--  การทดสอบ RLS ต้อง SET ROLE authenticated ด้วย เพราะ postgres เป็น
--  superuser ซึ่งข้าม RLS ทุกนโยบาย ถ้าไม่สลับ role เทสต์จะผ่านหมดอย่างผิด ๆ
-- ═══════════════════════════════════════════════════════════════════════════
DROP SCHEMA IF EXISTS q CASCADE;
CREATE SCHEMA q;

CREATE TABLE q.results (
  id      serial PRIMARY KEY,
  grp     text NOT NULL,          -- กลุ่ม A–H
  code    text NOT NULL,          -- รหัสกรณี เช่น F-05
  name    text NOT NULL,          -- ชื่อกรณี
  expect  text NOT NULL,          -- ผลที่คาดหวัง
  got     text,                   -- ผลที่ได้จริง
  passed  boolean NOT NULL,
  ran_at  timestamptz NOT NULL DEFAULT now()
);

-- เทสต์รันในฐานะ authenticated จึงต้องเขียนผลลงตารางนี้ได้
GRANT USAGE ON SCHEMA q TO authenticated, anon;
GRANT INSERT, SELECT ON q.results TO authenticated, anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA q TO authenticated, anon;

-- มีเพียง q.record ที่เป็น SECURITY DEFINER เพราะต้องเขียนลงตารางผล
-- ตัวอื่นต้องเป็น INVOKER ไม่งั้น EXECUTE ข้างในจะรันในฐานะ postgres
-- ซึ่งเป็น superuser และข้าม RLS ทุกนโยบาย ทำให้เทสต์ RLS ผ่านอย่างผิด ๆ
CREATE FUNCTION q.record(_grp text, _code text, _name text, _expect text,
                         _got text, _passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO q.results (grp, code, name, expect, got, passed)
  VALUES (_grp, _code, _name, _expect, _got, _passed);
  RAISE NOTICE '% % — %', CASE WHEN _passed THEN 'ผ่าน   ' ELSE 'ไม่ผ่าน' END,
               _code, COALESCE(_got, '');
END $$;

/** เงื่อนไขต้องเป็นจริง */
CREATE FUNCTION q.ok(_grp text, _code text, _name text, _expect text,
                     _cond boolean, _got text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM q.record(_grp, _code, _name, _expect,
                   COALESCE(_got, CASE WHEN _cond THEN 'เป็นจริง' ELSE 'เป็นเท็จ' END),
                   COALESCE(_cond, false));
END $$;

/** ค่าที่ได้ต้องตรงกับที่คาด */
CREATE FUNCTION q.eq(_grp text, _code text, _name text, _expect text,
                     _got anyelement, _want anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM q.record(_grp, _code, _name, _expect,
                   format('ได้ %s (ต้องการ %s)', COALESCE(_got::text,'NULL'),
                                                  COALESCE(_want::text,'NULL')),
                   _got IS NOT DISTINCT FROM _want);
END $$;

/** คำสั่งต้องสำเร็จ */
CREATE FUNCTION q.runs(_grp text, _code text, _name text, _expect text, _sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
    SET CONSTRAINTS ALL IMMEDIATE;      -- บังคับ trigger ที่ถูกเลื่อนให้ตรวจเดี๋ยวนี้
    PERFORM q.record(_grp, _code, _name, _expect, 'ทำงานสำเร็จ', true);
  EXCEPTION WHEN others THEN
    PERFORM q.record(_grp, _code, _name, _expect, 'ถูกปฏิเสธ: ' || SQLERRM, false);
  END;
END $$;

/** คำสั่งต้องถูกปฏิเสธ และข้อความต้องมีคำที่คาดไว้ */
CREATE FUNCTION q.raises(_grp text, _code text, _name text, _expect text,
                         _sql text, _needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN
    EXECUTE _sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    PERFORM q.record(_grp, _code, _name, _expect, 'ไม่ถูกปฏิเสธ กลับทำสำเร็จ', false);
    RETURN;
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
  END;
  PERFORM q.record(_grp, _code, _name, _expect,
                   'ถูกปฏิเสธ: ' || msg, position(_needle in msg) > 0);
END $$;

/** สวมบทบาทผู้ใช้ — ต้อง SET ROLE เองต่างหากถ้าจะทดสอบ RLS */
CREATE FUNCTION q.act_as(_uid uuid, _jwt_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', _uid, 'role', _jwt_role)::text, false);
END $$;
GRANT EXECUTE ON FUNCTION q.act_as(uuid, text) TO authenticated, anon;

/** ล้างตัวตน — ใช้ทดสอบกรณีผู้ใช้ที่ยังไม่ล็อกอิน */
CREATE FUNCTION q.act_as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, false);
END $$;
GRANT EXECUTE ON FUNCTION q.act_as_anon() TO authenticated, anon;

GRANT EXECUTE ON FUNCTION q.record(text,text,text,text,text,boolean) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION q.ok(text,text,text,text,boolean,text)     TO authenticated, anon;
GRANT EXECUTE ON FUNCTION q.runs(text,text,text,text,text)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION q.raises(text,text,text,text,text,text)    TO authenticated, anon;
