#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  SmartAttend — ตรวจความพร้อมก่อนสอบ
#
#    ./scripts/preflight.sh
#
#  ทุกคำสั่งในสคริปต์นี้เป็นการ "อ่านอย่างเดียว" ไม่มี INSERT/UPDATE/DELETE
#  ไม่มี ALTER ไม่มี DROP และไม่แตะข้อมูลของรายวิชาใดทั้งสิ้น
#
#  ถ้าต่อฐานข้อมูลไม่ได้ สคริปต์จะไม่เงียบ แต่จะพิมพ์ SQL ออกมาให้คัดลอก
#  ไปรันเองใน Supabase Dashboard แล้วทำข้ออื่นต่อจนครบ
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WEB="$ROOT/smartattend_web"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
PASS=0; FAIL=0; MANUAL=0
declare -a TODO=()

ok()     { printf '%s  ผ่าน%s    %s\n' "$GRN" "$RST" "$1"; PASS=$((PASS+1)); }
bad()    { printf '%s  ไม่ผ่าน%s %s\n' "$RED" "$RST" "$1"; FAIL=$((FAIL+1)); TODO+=("$2"); }
manual() { printf '%s  ต้องรันเอง%s %s\n' "$YEL" "$RST" "$1"; MANUAL=$((MANUAL+1)); }
head2()  { printf '\n%s── %s%s\n' "$BLD" "$1" "$RST"; }

# ───────────────────────────────────────────────────────────────────────────
#  หาวิธีต่อฐานข้อมูล — ลองสามทางตามลำดับ
# ───────────────────────────────────────────────────────────────────────────
DB_MODE="none"; PSQL_ARGS=()

detect_db() {
  # 1) supabase CLI ที่ link ไว้แล้ว
  if [ -f "$WEB/supabase/.temp/project-ref" ] \
     && command -v npx >/dev/null 2>&1 \
     && (cd "$WEB" && npx --no-install supabase --version >/dev/null 2>&1); then
    DB_MODE="supabase"; return
  fi
  # 2) DATABASE_URL จาก .env (ไม่พิมพ์ค่าออกมา)
  for envf in "$WEB/.env" "$ROOT/.env" "$ROOT/smartattend_pi/.env"; do
    [ -f "$envf" ] || continue
    local url
    url="$(grep -E '^[[:space:]]*DATABASE_URL=' "$envf" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
    if [ -n "${url:-}" ] && command -v psql >/dev/null 2>&1; then
      DB_URL="$url"; DB_MODE="psql"; PSQL_ARGS=("$DB_URL" -At -q); return
    fi
  done
  # 3) DATABASE_URL จากตัวแปรสภาพแวดล้อม
  if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
    DB_URL="$DATABASE_URL"; DB_MODE="psql"; PSQL_ARGS=("$DB_URL" -At -q); return
  fi
}

# รัน SQL แบบอ่านอย่างเดียว คืนผลทาง stdout — คืนสถานะ 1 ถ้าต่อไม่ได้
runsql() {
  case "$DB_MODE" in
    psql)     psql "${PSQL_ARGS[@]}" -c "$1" 2>/dev/null ;;
    supabase) (cd "$WEB" && printf '%s\n' "$1" | npx --no-install supabase db query --stdin 2>/dev/null) ;;
    *)        return 1 ;;
  esac
}

detect_db

printf '%s╔══════════════════════════════════════════════════════════════╗%s\n' "$BLD" "$RST"
printf '%s║  SmartAttend — ตรวจความพร้อมก่อนสอบ (อ่านอย่างเดียว)         ║%s\n' "$BLD" "$RST"
printf '%s╚══════════════════════════════════════════════════════════════╝%s\n' "$BLD" "$RST"
printf 'เวลา  %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
case "$DB_MODE" in
  psql)     printf 'ฐานข้อมูล  ต่อผ่าน psql (DATABASE_URL)\n' ;;
  supabase) printf 'ฐานข้อมูล  ต่อผ่าน supabase CLI\n' ;;
  none)     printf '%sฐานข้อมูล  ต่อไม่ได้ — จะพิมพ์ SQL ให้คัดลอกไปรันเองใน SQL Editor%s\n' "$YEL" "$RST" ;;
esac

# ═══ ข้อ 1 ═══════════════════════════════════════════════════════════════
SQL1="SELECT p.proname, pg_get_function_result(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='recalc_attendance_scores';"

head2 "ข้อ 1  recalc_attendance_scores คืนค่าเป็น jsonb หรือไม่"
if R="$(runsql "$SQL1")" && [ -n "$R" ]; then
  printf '  ค่าที่วัดได้: %s\n' "$R"
  if printf '%s' "$R" | grep -q 'jsonb'; then
    ok "คืนค่าเป็น jsonb"
  else
    bad "คืนค่าเป็น ${R##*|} ไม่ใช่ jsonb" \
        "ธงแดง ปุ่มคำนวณคะแนนการเข้าเรียนจะพัง — src/lib/attendance-score-data.ts:73 อ่าน .updated และ .skipped จากผลลัพธ์ ต้องรัน DROP FUNCTION แล้วสร้างใหม่ตามนิยามใน supabase/migrations/20260927230000_attendance_score_and_cancelled_sessions.sql"
  fi
else
  manual "คัดลอก SQL ข้างล่างไปรันเอง  ต้องได้ jsonb ถ้าได้ void = ธงแดง"
  printf '%s\n' "$SQL1"
fi

# ═══ ข้อ 2 ═══════════════════════════════════════════════════════════════
SQL2="SELECT p.proname, COALESCE(array_to_string(p.proacl, E'\n'),
       '(ไม่ได้กำหนด = PUBLIC เรียกได้)')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='get_scan_roster';"

head2 "ข้อ 2  get_scan_roster ยังเปิดให้ PUBLIC เรียกหรือไม่"
if R="$(runsql "$SQL2")" && [ -n "$R" ]; then
  printf '  ค่าที่วัดได้: %s\n' "$R"
  if printf '%s' "$R" | grep -qE '(^|[|[:space:]])=X/'; then
    bad "ยังมีบรรทัดขึ้นต้นด้วย =X/ แปลว่า PUBLIC (รวมผู้ไม่ล็อกอิน) ยังเรียกได้" \
        "ธงแดง DEF-001 ยังไม่ถูกปิด ต้อง apply migration 20261013100000_secure_get_scan_roster.sql"
  elif printf '%s' "$R" | grep -q 'ไม่ได้กำหนด'; then
    bad "proacl ว่าง แปลว่า PUBLIC เรียกได้" \
        "ธงแดง DEF-001 ยังไม่ถูกปิด ต้อง apply migration 20261013100000_secure_get_scan_roster.sql"
  else
    ok "ปิดสิทธิ์ PUBLIC แล้ว"
  fi
else
  manual "คัดลอก SQL ข้างล่างไปรันเอง  ถ้ามีบรรทัดขึ้นต้นด้วย =X/ = ธงแดง"
  printf '%s\n' "$SQL2"
fi

# ═══ ข้อ 3 ═══════════════════════════════════════════════════════════════
SQL3A="SELECT count(*) FROM public.attendance_records
WHERE edited_at IS NOT NULL AND COALESCE(btrim(edit_reason),'')='';"
SQL3B="SELECT count(*) FROM public.grade_audit_logs
WHERE previous_score IS NOT NULL
  AND previous_score IS DISTINCT FROM new_score
  AND COALESCE(btrim(reason),'')='';"

head2 "ข้อ 3  นับแถวเก่าที่จะทำให้ VALIDATE constraint ล้มเหลว"
if A="$(runsql "$SQL3A")" && B="$(runsql "$SQL3B")" && [ -n "$A" ]; then
  printf '  attendance_records ที่แก้แล้วไม่มีเหตุผล: %s แถว\n' "$A"
  printf '  grade_audit_logs ที่แก้คะแนนไม่มีเหตุผล:  %s แถว\n' "$B"
  if [ "$A" = "0" ] && [ "$B" = "0" ]; then
    ok "ไม่มีแถวค้าง สั่ง VALIDATE CONSTRAINT ได้เลย"
  else
    bad "มีแถวเก่าค้างอยู่ (attendance $A / grade $B)" \
        "ยังไม่ต้องสั่ง VALIDATE ปล่อย NOT VALID ไว้ กฎยังบังคับกับแถวใหม่อยู่แล้ว — ห้ามลบหรือแก้แถวเก่า ให้เจ้าของโปรเจกต์ตัดสินใจ"
  fi
else
  manual "คัดลอกสอง SQL ข้างล่างไปรันเอง  รายงานตัวเลขเฉย ๆ ห้ามลบแถวใด"
  printf '%s\n\n%s\n' "$SQL3A" "$SQL3B"
fi

# ═══ ข้อ 4 ═══════════════════════════════════════════════════════════════
#  ตารางเกณฑ์ตัดเกรดคือ public.grade_scales (course_id, grade, min_score,
#  grade_point, position) — แถวที่ course_id เป็น NULL คือเกณฑ์กลาง
SQL4="SELECT COALESCE(c.code,'(เกณฑ์กลางของระบบ)') AS course,
       gs.grade, gs.min_score, gs.grade_point,
       CASE
         WHEN gs.grade_point IS NULL THEN 'แต้ม GPA ว่าง'
         WHEN gs.grade_point < 0 THEN 'แต้ม GPA ติดลบ'
         WHEN gs.grade_point > 4 THEN 'แต้ม GPA เกิน 4'
         WHEN gs.grade_point <> gs.grade_point THEN 'แต้ม GPA ไม่ใช่ตัวเลข (NaN)'
         WHEN gs.grade NOT IN ('A','B+','B','C+','C','D+','D','F','W','I','S','U')
           THEN 'ชื่อเกรดไม่อยู่ในชุดมาตรฐาน'
         WHEN gs.min_score < 0 THEN 'คะแนนขั้นต่ำติดลบ'
         WHEN gs.min_score > 100 THEN 'คะแนนขั้นต่ำเกิน 100'
       END AS ปัญหา
FROM public.grade_scales gs
LEFT JOIN public.courses c ON c.id = gs.course_id
WHERE gs.grade_point IS NULL
   OR gs.grade_point < 0 OR gs.grade_point > 4
   OR gs.grade_point <> gs.grade_point
   OR gs.grade NOT IN ('A','B+','B','C+','C','D+','D','F','W','I','S','U')
   OR gs.min_score < 0 OR gs.min_score > 100
ORDER BY course, gs.min_score DESC;"

head2 "ข้อ 4  ค่าผิดปกติในเกณฑ์ตัดเกรด (สิ่งที่จะโผล่บนจอตอนสาธิต)"
if R="$(runsql "$SQL4")"; then
  if [ -z "$R" ]; then
    ok "ไม่พบค่าผิดปกติในเกณฑ์ตัดเกรด"
  else
    printf '%s\n' "$R" | sed 's/^/  /'
    N="$(printf '%s\n' "$R" | grep -c .)"
    bad "พบ $N แถวที่มีค่าผิดปกติ" \
        "เปิดหน้าตั้งเกณฑ์ตัดเกรดของรายวิชาที่ระบุ แล้วกดปุ่มใช้ค่าเริ่มต้น — สคริปต์นี้ไม่แก้ให้"
  fi
else
  manual "คัดลอก SQL ข้างล่างไปรันเอง  ถ้ามีแถวออกมา ให้ไปกดปุ่มใช้ค่าเริ่มต้นเอง"
  printf '%s\n' "$SQL4"
fi

# ═══ ข้อ 5 ═══════════════════════════════════════════════════════════════
SQL5A="SELECT regexp_replace(student_code, '[0-9]', 'N', 'g') AS รูปแบบ,
       count(*) AS จำนวน
FROM public.profiles
WHERE student_code IS NOT NULL AND btrim(student_code) <> ''
GROUP BY 1 ORDER BY 2 DESC;"
SQL5B="SELECT count(*) FROM public.profiles
WHERE name ~ '(.)\\\\1{3,}' OR btrim(COALESCE(name,'')) = '' OR length(btrim(name)) < 3;"
SQL5C="SELECT left(name, 2) || repeat('*', greatest(length(name)-2, 1)) AS ชื่อ_ปิดบัง,
       left(COALESCE(student_code,'-'), 4) || '…' AS รหัส_ปิดบัง
FROM public.profiles
WHERE name ~ '(.)\\\\1{3,}' OR btrim(COALESCE(name,'')) = '' OR length(btrim(name)) < 3
LIMIT 5;"

head2 "ข้อ 5  บัญชีที่ชื่อดูไม่เรียบร้อย หรือรหัสนักศึกษาผิดรูปแบบ"
if R="$(runsql "$SQL5A")"; then
  printf '  รูปแบบรหัสนักศึกษาที่พบ (N แทนตัวเลข):\n'
  printf '%s\n' "$R" | sed 's/^/    /'
  C="$(runsql "$SQL5B")"
  printf '  บัญชีที่ชื่อดูไม่เรียบร้อย: %s รายการ\n' "${C:-?}"
  if [ "${C:-0}" != "0" ]; then
    printf '  ตัวอย่าง (ปิดบังบางส่วน):\n'
    runsql "$SQL5C" | sed 's/^/    /'
    bad "มีบัญชีที่ชื่อดูไม่เรียบร้อย ${C} รายการ" \
        "ตรวจดูเองว่าเป็นบัญชีทดสอบหรือไม่ — ห้ามลบจากสคริปต์นี้ ถ้าจะลบให้ลบเองหลังตรวจ"
  else
    ok "ไม่พบบัญชีที่ชื่อดูไม่เรียบร้อย"
  fi
else
  manual "คัดลอก SQL ข้างล่างไปรันเอง  ดูว่ารูปแบบไหนเป็นส่วนน้อยผิดปกติ"
  printf '%s\n\n%s\n' "$SQL5A" "$SQL5B"
fi

# ═══ ข้อ 6 ═══════════════════════════════════════════════════════════════
SQL6="SELECT c.code, c.name,
       to_char(cs.started_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
       round(extract(epoch FROM (now() - cs.started_at))/3600, 1) || ' ชั่วโมงที่แล้ว'
FROM public.class_sessions cs
JOIN public.courses c ON c.id = cs.course_id
WHERE cs.status = 'open'
ORDER BY cs.started_at;"

head2 "ข้อ 6  คาบเรียนที่ยังเปิดค้างอยู่"
if R="$(runsql "$SQL6")"; then
  if [ -z "$R" ]; then
    ok "ไม่มีคาบเรียนเปิดค้าง อุปกรณ์จะไม่สแกนผิดวิชา"
  else
    printf '%s\n' "$R" | sed 's/^/  /'
    N="$(printf '%s\n' "$R" | grep -c .)"
    bad "มีคาบเปิดค้างอยู่ $N คาบ" \
        "ปิดคาบเหล่านี้จากหน้าอาจารย์ก่อนสาธิต ไม่งั้นอุปกรณ์จะเข้าโหมดสแกนของวิชาที่ค้างแทนวิชาที่จะสาธิต"
  fi
else
  manual "คัดลอก SQL ข้างล่างไปรันเอง  ถ้ามีคาบค้างให้ปิดก่อนสาธิต"
  printf '%s\n' "$SQL6"
fi

# ═══ ข้อ 7 ═══════════════════════════════════════════════════════════════
SQL7="SELECT device_code, COALESCE(room,'(ไม่ระบุห้อง)'),
       to_char(seen_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS'),
       round(extract(epoch FROM (now() - seen_at))/60, 1) || ' นาทีที่แล้ว'
FROM public.device_heartbeats ORDER BY seen_at DESC;"

head2 "ข้อ 7  อุปกรณ์ส่ง heartbeat ล่าสุดเมื่อไร"
if R="$(runsql "$SQL7")"; then
  if [ -z "$R" ]; then
    bad "ไม่มีอุปกรณ์เคยส่ง heartbeat เลย" \
        "เปิดเครื่อง Pi แล้วตรวจว่าบริการ smartattend ทำงานอยู่ (systemctl status smartattend)"
  else
    printf '%s\n' "$R" | sed 's/^/  /'
    MINS="$(printf '%s\n' "$R" | head -1 | grep -oE '[0-9]+\.[0-9]+ นาที' | grep -oE '^[0-9]+' || echo 999)"
    if [ "${MINS:-999}" -le 2 ]; then
      ok "อุปกรณ์ออนไลน์อยู่ (ล่าสุด ${MINS} นาทีที่แล้ว)"
    else
      bad "heartbeat ล่าสุดห่าง ${MINS} นาที — อุปกรณ์อาจออฟไลน์" \
          "ตรวจว่าเครื่อง Pi เปิดอยู่และต่อเน็ตได้ (pi_agent.py ส่ง heartbeat ทุกรอบ polling 4 วินาที)"
    fi
  fi
else
  manual "คัดลอก SQL ข้างล่างไปรันเอง  ควรห่างไม่เกิน 1-2 นาทีถ้าเครื่องเปิดอยู่"
  printf '%s\n' "$SQL7"
fi

# ═══ ข้อ 8 ═══════════════════════════════════════════════════════════════
head2 "ข้อ 8  สายการสร้าง (tsc / lint / test / build)"
if [ ! -d "$WEB/node_modules" ]; then
  bad "ยังไม่ได้ติดตั้ง dependency" "รัน cd smartattend_web && npm install ก่อน"
else
  BUILD_OK=1
  run_step() {
    printf '  %-34s' "$1"
    if (cd "$WEB" && eval "$2" >/tmp/preflight_step.log 2>&1); then
      printf '%sผ่าน%s\n' "$GRN" "$RST"
    else
      printf '%sไม่ผ่าน%s\n' "$RED" "$RST"
      tail -5 /tmp/preflight_step.log | sed 's/^/      /'
      BUILD_OK=0
    fi
  }
  run_step "npx tsc -p tsconfig.app.json" "npx tsc -p tsconfig.app.json --noEmit"
  run_step "npm run lint"                 "npm run lint"
  run_step "npm run test"                 "npm run test"
  run_step "npm run build"                "npm run build"
  if [ "$BUILD_OK" = "1" ]; then
    ok "สายการสร้างผ่านครบทั้งสี่ขั้น"
  else
    bad "สายการสร้างมีขั้นที่ไม่ผ่าน" "ดูรายละเอียดด้านบน แก้ให้ผ่านก่อนสอบ"
  fi
fi

# ═══ สรุป ═══════════════════════════════════════════════════════════════
printf '\n%s══════════════════════════════════════════════════════════════%s\n' "$BLD" "$RST"
printf 'ผ่าน %s · ไม่ผ่าน %s · ต้องรันเอง %s\n' "$PASS" "$FAIL" "$MANUAL"
if [ "$FAIL" -eq 0 ] && [ "$MANUAL" -eq 0 ]; then
  printf '%s%sพร้อมสอบ%s\n' "$BLD" "$GRN" "$RST"; exit 0
elif [ "$FAIL" -eq 0 ]; then
  printf '%s%sยังไม่พร้อม — ต่อฐานข้อมูลไม่ได้ ต้องรัน SQL ข้างบนเองก่อน%s\n' "$BLD" "$YEL" "$RST"; exit 2
else
  printf '%s%sยังไม่พร้อม%s — ต้องทำสิ่งต่อไปนี้\n' "$BLD" "$RED" "$RST"
  i=1; for t in "${TODO[@]}"; do printf '  %d. %s\n' "$i" "$t"; i=$((i+1)); done
  [ "$MANUAL" -gt 0 ] && printf '  และรัน SQL ที่พิมพ์ไว้ข้างบนอีก %s ข้อ\n' "$MANUAL"
  exit 1
fi
