#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  รันชุดทดสอบ RPC บน PostgreSQL จริง ด้วยคำสั่งเดียว
#
#    ./supabase/tests/run.sh
#
#  ค่าเริ่มต้นจะสร้างคลัสเตอร์ PostgreSQL ชั่วคราวขึ้นมาเอง รันเทสต์ แล้วลบทิ้ง
#  ไม่แตะฐานข้อมูลของโปรเจกต์และไม่ต้องต่ออินเทอร์เน็ต
#
#  ถ้าอยากรันกับฐานข้อมูลที่มีอยู่แล้ว (เช่น supabase start) ส่ง DATABASE_URL มา
#    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#      ./supabase/tests/run.sh
#  ⚠️ สคริปต์จะสร้างสคีมา t และตารางทดสอบทับของเดิม อย่าชี้ไปฐานข้อมูลจริง
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
SQL="$HERE/sql"
WORK="$(mktemp -d)"
OWN_CLUSTER=0

cleanup() {
  if [ "$OWN_CLUSTER" = "1" ] && [ -d "$WORK/data" ]; then
    "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── หา psql และเครื่องมือของ PostgreSQL ────────────────────────────────────
PGBIN="${PGBIN:-}"
if [ -z "$PGBIN" ]; then
  for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@*/bin; do
    [ -x "$d/initdb" ] && PGBIN="$d" && break
  done
fi
command -v psql >/dev/null 2>&1 || { echo "ไม่พบคำสั่ง psql — ติดตั้ง postgresql-client ก่อน"; exit 1; }

# ── เตรียมฐานข้อมูล ────────────────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  echo "ใช้ฐานข้อมูลที่ระบุมาทาง DATABASE_URL"
  PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
else
  [ -n "$PGBIN" ] || { echo "ไม่พบ initdb — ติดตั้ง postgresql (server) หรือส่ง DATABASE_URL มา"; exit 1; }
  echo "สร้างคลัสเตอร์ PostgreSQL ชั่วคราวที่ $WORK"
  # initdb รันด้วย root ไม่ได้ ถ้าเป็น root ให้ยืมผู้ใช้อื่น
  if [ "$(id -u)" = "0" ]; then
    id pgtest >/dev/null 2>&1 || useradd -m pgtest
    chown -R pgtest "$WORK"; chmod 700 "$WORK"
    RUNAS=(setpriv --reuid=pgtest --regid="$(id -g pgtest)" --clear-groups)
  else
    RUNAS=()
  fi
  PORT="${PGPORT_TEST:-55499}"
  "${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >"$WORK/initdb.log" 2>&1
  OWN_CLUSTER=1
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" \
      -o "-k $WORK -p $PORT -c listen_addresses=" -l "$WORK/pg.log" -w start >/dev/null
  PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
  "${PSQL[@]}" -c "CREATE DATABASE smartattend_test"
  PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d smartattend_test -v ON_ERROR_STOP=1 -q)
fi

# ── ดึงตัวฟังก์ชันที่จะทดสอบออกจากไฟล์ migration จริง ───────────────────────
#    ไม่คัดลอกโค้ดมาไว้ในเทสต์ เพื่อให้เทสต์พังทันทีถ้ามีคนแก้ migration
extract() {           # extract <ไฟล์ migration> <ชื่อฟังก์ชัน>
  awk -v fn="$2" '
    $0 ~ "CREATE OR REPLACE FUNCTION public\\." fn "\\(" { inside = 1 }
    inside { print }
    inside && /^\$\$;$/ { exit }
  ' "$1"
}

REC_ATT="$MIGRATIONS/20260927130000_record_attendance_server_time.sql"
[ -f "$REC_ATT" ] || { echo "ไม่พบไฟล์ migration ของ record_attendance"; exit 1; }
extract "$REC_ATT" record_attendance > "$WORK/fn_record_attendance.sql"
grep -q 'record_attendance' "$WORK/fn_record_attendance.sql" \
  || { echo "ดึงฟังก์ชัน record_attendance จาก migration ไม่สำเร็จ"; exit 1; }

echo "── เตรียมสคีมา"
"${PSQL[@]}" -f "$SQL/00_harness.sql"
"${PSQL[@]}" -f "$SQL/01_stub_schema.sql"

echo "── โหลดฟังก์ชันที่ทดสอบจาก migration จริง"
# save_component_items โหลดทั้งไฟล์ได้ เพราะไฟล์นั้นมีแต่ฟังก์ชันกับ COMMENT
"${PSQL[@]}" -f "$MIGRATIONS/20260928100000_component_items_rpc.sql"
"${PSQL[@]}" -f "$WORK/fn_record_attendance.sql"

echo "── รันเทสต์"
for f in "$SQL"/[1-8][0-9]_*.sql; do
  echo "   $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "── สรุปผล"
# คืน exit code ไม่เป็นศูนย์ถ้ามีข้อที่ไม่ผ่าน (ON_ERROR_STOP + RAISE ใน 99_report)
"${PSQL[@]}" -f "$SQL/99_report.sql"
echo ""
echo "เทสต์ผ่านครบ"
