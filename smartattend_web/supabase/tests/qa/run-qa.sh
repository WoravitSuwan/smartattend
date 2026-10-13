#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  ชุดทดสอบ QA แบบครบวงจรของ SmartAttend
#
#    ./supabase/tests/qa/run-qa.sh
#
#  ค่าเริ่มต้น: สร้างคลัสเตอร์ PostgreSQL ชั่วคราว แล้ว apply migration ทุกไฟล์
#  ตามลำดับจริง ได้สคีมาเต็มเหมือนที่ deploy แล้วลบคลัสเตอร์ทิ้งเมื่อจบ
#
#  ถ้าต้องการรันกับฐานข้อมูลอื่น (เช่น supabase start หรือฐานข้อมูลจริง)
#    DATABASE_URL=postgresql://... ./supabase/tests/qa/run-qa.sh
#  ⚠️ โหมดนี้จะ "ไม่" apply migration และ "ไม่" ลงสคีมา q ซ้ำถ้ามีอยู่แล้ว
#     แต่จะสร้าง/ลบข้อมูลที่ขึ้นต้นด้วย TEST_ จริง ให้แน่ใจก่อนว่ายอมรับได้
#
#  ตัวเลือก
#    --keep     ไม่ลบข้อมูลทดสอบเมื่อจบ (ไว้เข้าไปดูต่อ)
#    --seed-only สร้างข้อมูลทดสอบอย่างเดียว ไม่รันกรณีทดสอบ
#    --teardown-only  ลบข้อมูลทดสอบอย่างเดียว
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../../migrations"
SQLDIR="$HERE/sql"
KEEP=0; SEED_ONLY=0; TEARDOWN_ONLY=0
for a in "$@"; do case "$a" in
  --keep) KEEP=1 ;; --seed-only) SEED_ONLY=1 ;; --teardown-only) TEARDOWN_ONLY=1 ;;
  *) echo "ไม่รู้จักตัวเลือก $a"; exit 2 ;;
esac; done

WORK=""; OWN_CLUSTER=0
cleanup() {
  if [ "$OWN_CLUSTER" = "1" ] && [ -d "$WORK/data" ]; then
    "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  [ -n "$WORK" ] && rm -rf "$WORK"
}
trap cleanup EXIT

command -v psql >/dev/null 2>&1 || { echo "ไม่พบคำสั่ง psql — ติดตั้ง postgresql-client ก่อน"; exit 1; }
PGBIN="${PGBIN:-}"
if [ -z "$PGBIN" ]; then
  for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@*/bin; do
    [ -x "$d/initdb" ] && PGBIN="$d" && break
  done
fi

if [ -n "${DATABASE_URL:-}" ]; then
  echo "ใช้ฐานข้อมูลที่ระบุมาทาง DATABASE_URL (ไม่ apply migration)"
  PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
  FRESH=0
else
  [ -n "$PGBIN" ] || { echo "ไม่พบ initdb — ติดตั้ง postgresql (server) หรือส่ง DATABASE_URL มา"; exit 1; }
  WORK="$(mktemp -d)"
  echo "สร้างคลัสเตอร์ PostgreSQL ชั่วคราวที่ $WORK"
  if [ "$(id -u)" = "0" ]; then          # initdb รันด้วย root ไม่ได้
    id pgtest >/dev/null 2>&1 || useradd -m pgtest
    chown -R pgtest "$WORK"; chmod 755 "$WORK"
    RUNAS=(setpriv --reuid=pgtest --regid="$(id -g pgtest)" --clear-groups)
  else
    RUNAS=()
  fi
  PORT="${PGPORT_TEST:-55501}"
  "${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >"$WORK/initdb.log" 2>&1
  OWN_CLUSTER=1
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" \
      -o "-k $WORK -p $PORT -c listen_addresses=" -l "$WORK/pg.log" -w start >/dev/null
  # ต้องเป็น UTF8 ให้ตรงกับ Supabase จริง — ถ้าเป็น SQL_ASCII ฟังก์ชันอย่าง
  # left() และ length() จะนับเป็นไบต์ไม่ใช่ตัวอักษร ทำให้ตัดคำภาษาไทยกลางตัว
  psql -h "$WORK" -p "$PORT" -U postgres -d postgres -q -c \
    "CREATE DATABASE smartattend_qa ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'"
  PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d smartattend_qa -v ON_ERROR_STOP=1 -q)
  FRESH=1
fi

if [ "$FRESH" = "1" ]; then
  echo "── จำลองส่วนของ Supabase"
  "${PSQL[@]}" -f "$SQLDIR/00_shim.sql" 2>&1 | grep -viE 'notice|warning|hint:' || true

  echo "── apply migration ทั้งหมดตามลำดับ ($(ls "$MIGRATIONS"/*.sql | wc -l) ไฟล์)"
  # ── ข้อบกพร่องที่ทำให้ replay จากฐานว่างไม่ผ่าน ──
  #   DEF-001 v_attendance_summary เปลี่ยนชนิดคอลัมน์ bigint→int→bigint
  #           ด้วย CREATE OR REPLACE VIEW ซึ่ง PostgreSQL ไม่อนุญาต
  #   DEF-002 recalc_attendance_scores เปลี่ยน RETURNS void→jsonb
  #           ด้วย CREATE OR REPLACE FUNCTION ซึ่ง PostgreSQL ไม่อนุญาต
  #   ที่นี่ DROP ให้ก่อนเพื่อให้สร้างสคีมาต่อได้ และบันทึกเป็นข้อบกพร่องไว้
  #   รายละเอียดอยู่ใน docs/ข้อบกพร่องที่พบ.md
  for f in "$MIGRATIONS"/*.sql; do
    case "$(basename "$f")" in
      20260927100000_*|20260929021502_*)
        "${PSQL[@]}" -c 'DROP VIEW IF EXISTS public.v_attendance_summary CASCADE;' ;;
      20260927230000_*)
        "${PSQL[@]}" -c 'DROP FUNCTION IF EXISTS public.recalc_attendance_scores(uuid) CASCADE;' ;;
    esac
    "${PSQL[@]}" -f "$f" >/dev/null 2>&1 || {
      echo "   ✗ apply ไม่ผ่าน: $(basename "$f")"
      "${PSQL[@]}" -f "$f" 2>&1 | grep ERROR | head -3
      exit 1
    }
  done
  echo "   apply ครบทุกไฟล์"
fi

if [ "$TEARDOWN_ONLY" = "1" ]; then
  "${PSQL[@]}" -f "$SQLDIR/19_teardown.sql" && echo "ลบข้อมูลทดสอบแล้ว"; exit 0
fi

echo "── ติดตั้งตัวช่วยเขียนเทสต์"
"${PSQL[@]}" -f "$SQLDIR/01_harness.sql"

echo "── สร้างข้อมูลทดสอบ"
"${PSQL[@]}" -f "$SQLDIR/10_seed.sql"

if [ "$SEED_ONLY" = "1" ]; then echo "สร้างข้อมูลทดสอบแล้ว (ไม่รันกรณีทดสอบ)"; exit 0; fi

echo "── รันกรณีทดสอบ"
# สร้างข้อมูลทดสอบใหม่ก่อนทุกกลุ่ม เพื่อให้แต่ละกลุ่มเป็นอิสระต่อกัน
# ไม่งั้นกลุ่มที่รันก่อนจะแก้ข้อมูลจนกลุ่มถัดไปไม่ผ่านโดยที่ตัวมันเองไม่ได้ผิด
# (10_seed.sql เรียก 19_teardown.sql ที่หัวไฟล์อยู่แล้ว จึงล้างของเดิมให้ครบ)
for f in "$SQLDIR"/[2-9][0-9]_group_*.sql; do
  echo "   $(basename "$f")"
  "${PSQL[@]}" -f "$SQLDIR/10_seed.sql" >/dev/null
  "${PSQL[@]}" -f "$f" > "${WORK:-/tmp}/group.log" 2>&1 || {
    echo "      ✗ ไฟล์นี้หยุดกลางคัน:"; grep -E '^psql.*ERROR' "${WORK:-/tmp}/group.log" | head -3; }
  grep -E 'NOTICE:  (ผ่าน|ไม่ผ่าน)' "${WORK:-/tmp}/group.log" | sed 's/.*NOTICE:  /      /' || true
done

echo "── สรุปผล"
set +e
"${PSQL[@]}" -f "$SQLDIR/99_report.sql"
RC=$?
set -e

if [ "$KEEP" = "0" ]; then
  "${PSQL[@]}" -f "$SQLDIR/19_teardown.sql" >/dev/null && echo "ลบข้อมูลทดสอบแล้ว"
else
  echo "เก็บข้อมูลทดสอบไว้ตามที่สั่ง (--keep)"
fi
exit $RC
