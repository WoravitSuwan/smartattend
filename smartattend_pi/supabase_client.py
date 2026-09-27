"""ตัวเชื่อมต่อระหว่าง Raspberry Pi กับฐานข้อมูล Supabase

ใช้ HTTP ตรง ๆ ไม่พึ่ง SDK เพื่อให้ติดตั้งบน Pi ได้เบาและเร็ว
"""
from __future__ import annotations

import base64
import logging
import os
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DEVICE_CODE = os.getenv("DEVICE_CODE", "PI-ROOM-01")
ROOM = os.getenv("ROOM", "")

if not SUPABASE_URL or not SERVICE_KEY:
    raise RuntimeError(
        "ไม่พบ SUPABASE_URL หรือ SUPABASE_SERVICE_KEY\n"
        "กรุณาสร้างไฟล์ .env (ดูตัวอย่างใน .env.example)"
    )

_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}


def _get(table: str, params: dict[str, Any]) -> list[dict]:
    r = httpx.get(f"{SUPABASE_URL}/rest/v1/{table}",
                  headers=_HEADERS, params=params, timeout=25)
    r.raise_for_status()
    return r.json()


def _post(table: str, payload: Any) -> list[dict]:
    h = dict(_HEADERS)
    h["Prefer"] = "return=representation"
    r = httpx.post(f"{SUPABASE_URL}/rest/v1/{table}",
                   headers=h, json=payload, timeout=30)
    r.raise_for_status()
    return r.json() if r.text else []


def _rpc(fn: str, payload: dict[str, Any] | None = None) -> Any:
    r = httpx.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
                   headers=_HEADERS, json=payload or {}, timeout=25)
    r.raise_for_status()
    return r.json() if r.text else None


# ------------------------------------------------------------------ sessions
def get_open_session() -> dict | None:
    """หาคาบเรียนที่เปิดอยู่ ถ้าตั้งค่า ROOM ไว้จะกรองเฉพาะห้องนั้น

    เรียก sync_scheduled_sessions ก่อนทุกครั้ง เพื่อเปิดคาบที่อาจารย์ตั้งเวลาไว้
    เมื่อถึงกำหนด และปิดคาบที่หมดเวลาแล้ว — Pi เป็นฝ่ายถามเซิร์ฟเวอร์เอง
    จึงต้องเป็นตัวกระตุ้นให้สถานะตรงกับเวลาจริง
    """
    try:
        _rpc("sync_scheduled_sessions")
    except Exception as e:  # noqa: BLE001 — sync ล้มต้องไม่ทำให้หาคาบเรียนไม่ได้
        log.debug("sync_scheduled_sessions ไม่สำเร็จ (ข้ามได้): %s", e)

    params = {
        "select": "id,course_id,started_at,late_after_minutes,status,scanning_paused,"
                  "courses(code,name,room)",
        "status": "eq.open",
        "order": "started_at.desc",
        "limit": 1,
    }
    rows = _get("class_sessions", params)
    if not rows:
        return None
    s = rows[0]
    if ROOM:
        course_room = (s.get("courses") or {}).get("room")
        if course_room and course_room != ROOM:
            return None
    return s


def get_enrolled_students(course_id: str) -> list[dict]:
    """รายชื่อนักศึกษาที่ยืนยันเข้าร่วมรายวิชานี้แล้ว

    ไม่รวมนักศึกษาที่ถูกระงับสิทธิ์จากการขาดเรียนครบ 4 ครั้ง (attendance_blocked)
    — คนกลุ่มนี้จะไม่ถูกใส่ในคลังใบหน้าเลย จึงสแกนเช็คชื่อไม่ได้อีกต่อไป
    """
    rows = _rpc("get_scan_roster", {"_course_id": course_id}) or []
    return [
        {
            "student_id": r["student_id"],
            "student_code_raw": r.get("student_code") or "",
            "student_name_raw": r.get("student_name") or "",
        }
        for r in rows if r.get("student_id")
    ]


# --------------------------------------------------------------- face images
def get_face_images(student_ids: list[str]) -> list[dict]:
    """ดึงภาพใบหน้าต้นฉบับของนักศึกษาที่ระบุ (ไม่เอาภาพที่เสริมข้อมูลมา)"""
    if not student_ids:
        return []
    ids = ",".join(student_ids)
    return _get("face_images", {
        "select": "student_id,student_code,image_data,kind",
        "student_id": f"in.({ids})",
        "limit": "2000",
    })


def get_profiles(student_ids: list[str]) -> dict[str, dict]:
    if not student_ids:
        return {}
    rows = _get("profiles", {
        "select": "user_id,name,student_code",
        "user_id": f"in.({','.join(student_ids)})",
    })
    return {r["user_id"]: r for r in rows}


# ------------------------------------------------------------------ check-in
def already_checked_in(session_id: str, student_id: str) -> bool:
    rows = _get("attendance_records", {
        "select": "id",
        "session_id": f"eq.{session_id}",
        "student_id": f"eq.{student_id}",
        "limit": 1,
    })
    return bool(rows)


class CheckInRejected(Exception):
    """เซิร์ฟเวอร์ปฏิเสธการเช็คชื่อด้วยเหตุผลที่ระบุไว้ชัดเจน

    ต่างจากความผิดพลาดของเครือข่าย: กรณีนี้ส่งซ้ำไปก็ถูกปฏิเสธเหมือนเดิม
    (เช่น ถูกระงับสิทธิ์ ไม่ได้ลงทะเบียนวิชานี้ คาบปิดแล้ว)
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


#: ข้อความบนจอสำหรับเหตุผลที่เซิร์ฟเวอร์ปฏิเสธ
REJECT_MESSAGES = {
    "session_not_open": "คาบเรียนปิดแล้ว",
    "session_not_found": "ไม่พบคาบเรียนนี้",
    "scanning_paused": "อาจารย์สั่งหยุดสแกนชั่วคราว",
    "not_enrolled": "ไม่มีรายชื่อในวิชานี้",
    "attendance_blocked": "ถูกระงับสิทธิ์จากการขาดเรียน",
    "forbidden": "อุปกรณ์ไม่มีสิทธิ์บันทึก",
    "unauthorized": "อุปกรณ์ไม่มีสิทธิ์บันทึก",
}


def submit_check_in(session_id: str, student_id: str, photo_jpeg: bytes,
                    confidence: float) -> dict:
    """บันทึกการเข้าเรียนพร้อมภาพหลักฐาน คืนผลที่เซิร์ฟเวอร์บันทึกจริง

    **อุปกรณ์ไม่คำนวณเวลาหรือสถานะเองเลย** — ส่งแค่ว่าใครคือใคร ความมั่นใจ
    เท่าไร และภาพหลักฐาน แล้วให้ RPC record_attendance ตัดสิน on_time/late
    ด้วย now() ของฐานข้อมูล

    เหตุผล: Raspberry Pi ไม่มีนาฬิกาสำรอง (RTC) ถ้าบูตตอนไม่มีเน็ตเวลาจะเพี้ยน
    ได้เป็นวัน (เครื่องในโครงงานนี้เคยเดินช้าไป 15 วัน) ของเดิมใช้
    datetime.now() ของ Pi ตัดสินสถานะและใส่ checked_in_at เอง ทุกแถวจึงผิด
    ทั้งเวลาและสถานะโดยไม่มีใครรู้

    คืน dict: {"status": "on_time"|"late", "checked_in_at": str,
               "already": bool, "server_time": str}
    ยก CheckInRejected เมื่อเซิร์ฟเวอร์ปฏิเสธด้วยเหตุผลถาวร (ส่งซ้ำไม่ช่วย)
    """
    data_url = "data:image/jpeg;base64," + base64.b64encode(photo_jpeg).decode()

    try:
        result = _rpc("record_attendance", {
            "_session_id": session_id,
            "_student_id": student_id,
            "_confidence": round(float(confidence), 4),
            "_photo": data_url,
        })
    except httpx.HTTPStatusError as e:
        # PostgREST คืน 400 พร้อม message ของ RAISE EXCEPTION ใน body
        reason = ""
        try:
            reason = (e.response.json() or {}).get("message", "")
        except Exception:  # noqa: BLE001 — body ไม่ใช่ JSON ก็ถือว่าไม่รู้เหตุผล
            reason = ""
        if reason in REJECT_MESSAGES:
            log.warning("เซิร์ฟเวอร์ปฏิเสธการเช็คชื่อ student=%s เหตุผล=%s",
                        student_id, reason)
            raise CheckInRejected(reason) from e
        raise

    if not isinstance(result, dict) or not result.get("status"):
        raise RuntimeError(f"record_attendance ตอบกลับไม่ถูกรูปแบบ: {result!r}")

    log.info("บันทึกการเข้าเรียน student=%s status=%s (เวลาเซิร์ฟเวอร์ %s) "
             "conf=%.3f ซ้ำ=%s",
             student_id, result["status"], result.get("checked_in_at"),
             confidence, result.get("already"))
    return result


def heartbeat() -> None:
    """แจ้งว่าอุปกรณ์ยังทำงานอยู่ — อัปเดตแถวเดิมของอุปกรณ์นี้ (ไม่สร้างแถวใหม่ทุก 4 วิ)

    เวลา seen_at ถูกเขียนด้วย now() ของเซิร์ฟเวอร์ใน RPC ไม่ใช่เวลาของ Pi
    ด้วยเหตุผลเดียวกับการเช็คชื่อ: นาฬิกา Pi ที่เพี้ยนทำให้แผงสถานะบนหน้าเว็บ
    บอกว่าอุปกรณ์ออฟไลน์ตลอดเวลา ทั้งที่เครื่องทำงานปกติ
    """
    try:
        _rpc("device_heartbeat", {
            "_device_code": DEVICE_CODE,
            "_room": ROOM or None,
        })
    except Exception as e:  # noqa: BLE001 — heartbeat ต้องไม่ล้มระบบหลัก
        log.debug("ส่ง heartbeat ไม่สำเร็จ (ข้ามได้): %s", e)


def push_log(level: str, message: str) -> None:
    """ส่งบรรทัด log ที่มีความหมาย (ไม่ใช่ทุกเฟรม) ขึ้นฐานข้อมูล
    ให้อาจารย์/แอดมินดูการทำงานของ Pi ได้จากหน้าเว็บโดยไม่ต้อง SSH เข้าเครื่อง
    """
    try:
        _post("device_logs", {
            "device_code": DEVICE_CODE,
            "level": level,
            "message": message[:2000],
        })
    except Exception as e:  # noqa: BLE001 — ส่ง log ไม่สำเร็จต้องไม่ล้มระบบหลัก
        log.debug("ส่ง log ขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (ข้ามได้): %s", e)
