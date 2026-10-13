-- สรุปผลการทดสอบ และคืน exit code ไม่เป็นศูนย์เมื่อมีกรณีที่ไม่ผ่าน
\pset pager off
\echo ''
\echo '═══════════════════════════════════════════════════════════'
SELECT grp AS "กลุ่ม",
       count(*)                            AS "ทั้งหมด",
       count(*) FILTER (WHERE passed)      AS "ผ่าน",
       count(*) FILTER (WHERE NOT passed)  AS "ไม่ผ่าน"
FROM q.results GROUP BY grp ORDER BY grp;

\echo 'ตารางผลการทดสอบ (คัดลอกลงเล่มได้)'
SELECT code AS "รหัส", name AS "กรณีทดสอบ", expect AS "ผลที่คาดหวัง",
       got AS "ผลที่ได้", CASE WHEN passed THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END AS "สถานะ"
FROM q.results ORDER BY code;

\echo 'กรณีที่ไม่ผ่าน'
SELECT code AS "รหัส", name AS "กรณีทดสอบ", got AS "ผลที่ได้"
FROM q.results WHERE NOT passed ORDER BY code;

DO $$
DECLARE v_fail integer; v_all integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO v_fail, v_all FROM q.results;
  IF v_all = 0 THEN
    RAISE EXCEPTION 'ไม่มีกรณีทดสอบถูกรันเลย — น่าจะมีไฟล์ที่โหลดไม่สำเร็จ';
  END IF;
  RAISE NOTICE 'รันไป % กรณี ผ่าน % ไม่ผ่าน %', v_all, v_all - v_fail, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'มีกรณีที่ไม่ผ่าน % กรณี', v_fail;
  END IF;
END $$;
