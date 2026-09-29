-- สรุปผล และทำให้ psql คืน exit code ไม่เป็นศูนย์เมื่อมีข้อที่ไม่ผ่าน
\pset pager off
\echo ''
\echo '───────────────────────────────────────────────────────────'

SELECT suite AS "ชุดทดสอบ",
       count(*) FILTER (WHERE passed)       AS "ผ่าน",
       count(*) FILTER (WHERE NOT passed)   AS "ไม่ผ่าน"
FROM t.results GROUP BY suite ORDER BY suite;

\echo 'รายการที่ไม่ผ่าน (ถ้ามี)'
SELECT suite AS "ชุดทดสอบ", name AS "ข้อ", detail AS "รายละเอียด"
FROM t.results WHERE NOT passed ORDER BY id;

DO $$
DECLARE v_fail integer; v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO v_fail, v_all FROM t.results;
  IF v_all = 0 THEN
    RAISE EXCEPTION 'ไม่มีเทสต์ถูกรันเลย — น่าจะมีไฟล์ที่โหลดไม่สำเร็จ';
  END IF;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'ไม่ผ่าน % ข้อ จากทั้งหมด % ข้อ', v_fail, v_all;
  END IF;
  RAISE NOTICE 'ผ่านครบทั้ง % ข้อ', v_all;
END $$;
