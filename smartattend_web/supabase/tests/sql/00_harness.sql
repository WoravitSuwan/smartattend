-- ═══════════════════════════════════════════════════════════════════════════
--  ตัวช่วยเขียนเทสต์ — เก็บผลลงตาราง แล้วสรุปตอนท้ายด้วย 99_report.sql
--
--  ทำไมต้องมี SET CONSTRAINTS ALL IMMEDIATE ใน t.raises()
--    กฎ "น้ำหนักย่อยในหมวดต้องรวมเป็น 100" บังคับด้วย CONSTRAINT TRIGGER แบบ
--    DEFERRABLE INITIALLY DEFERRED ซึ่งทำงานตอน COMMIT ไม่ใช่ตอนสั่ง
--    ถ้าเรียกฟังก์ชันใน BEGIN/EXCEPTION เฉย ๆ trigger จะยังไม่ทำงาน เทสต์จะ
--    ผ่านทั้งที่ควรพัง SET CONSTRAINTS ALL IMMEDIATE บังคับให้ตรวจเดี๋ยวนั้น
--    ซึ่งให้ผลเหมือนตอน COMMIT จริง (พิสูจน์แล้วบน PostgreSQL 16)
-- ═══════════════════════════════════════════════════════════════════════════

DROP SCHEMA IF EXISTS t CASCADE;
CREATE SCHEMA t;

CREATE TABLE t.results (
  id       serial PRIMARY KEY,
  suite    text NOT NULL,
  name     text NOT NULL,
  passed   boolean NOT NULL,
  detail   text
);

CREATE FUNCTION t.record(_suite text, _name text, _passed boolean, _detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t.results (suite, name, passed, detail) VALUES (_suite, _name, _passed, _detail);
  RAISE NOTICE '%  %  %', CASE WHEN _passed THEN 'ผ่าน  ' ELSE 'ไม่ผ่าน' END,
               _name, COALESCE('— ' || _detail, '');
END $$;

/** เงื่อนไขต้องเป็นจริง */
CREATE FUNCTION t.ok(_suite text, _name text, _cond boolean, _detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.record(_suite, _name, COALESCE(_cond, false), _detail);
END $$;

/** ค่าที่ได้ต้องตรงกับที่คาด */
CREATE FUNCTION t.eq(_suite text, _name text, _got anyelement, _want anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.record(_suite, _name, _got IS NOT DISTINCT FROM _want,
                   format('ได้ %L คาดว่า %L', _got, _want));
END $$;

/** คำสั่งต้องสำเร็จ */
CREATE FUNCTION t.runs(_suite text, _name text, _sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    PERFORM t.record(_suite, _name, true);
  EXCEPTION WHEN others THEN
    PERFORM t.record(_suite, _name, false, 'ไม่ควร error แต่ได้: ' || SQLERRM);
  END;
END $$;

/** คำสั่งต้องถูกปฏิเสธ และข้อความต้องมีคำที่คาดไว้ */
CREATE FUNCTION t.raises(_suite text, _name text, _sql text, _expect text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN
    EXECUTE _sql;
    -- บังคับให้ CONSTRAINT TRIGGER ที่ถูกเลื่อนไว้ทำงานเดี๋ยวนี้
    SET CONSTRAINTS ALL IMMEDIATE;
    PERFORM t.record(_suite, _name, false, 'ควรถูกปฏิเสธ แต่กลับสำเร็จ');
    RETURN;
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
  END;
  PERFORM t.record(_suite, _name, position(_expect in msg) > 0,
                   format('ได้ข้อความ %L คาดว่ามีคำว่า %L', msg, _expect));
END $$;

/** สลับผู้ใช้ที่กำลังเรียก (auth.uid) และบทบาทใน JWT */
CREATE FUNCTION t.act_as(_uid uuid, _jwt_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.uid', COALESCE(_uid::text, ''), false);
  PERFORM set_config('request.jwt.claims',
                     jsonb_build_object('role', _jwt_role)::text, false);
END $$;
