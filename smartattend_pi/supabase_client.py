"""ตัวเชื่อมต่อระหว่าง Raspberry Pi กับฐานข้อมูล Supabase

ใช้ HTTP ตรง ๆ ไม่พึ่ง SDK เพื่อให้ติดตั้งบน Pi ได้เบาและเร็ว
"""
from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timezone
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


def _upsert(table: str, payload: Any) -> list[dict]:
    """POST ที่อัปเดตแถวเดิมแทนที่จะเพิ่มแถวใหม่ทุกครั้ง (ใช้ primary key ของตาราง)"""
    h = dict(_HEADERS)
    h["Prefer"] = "resolution=merge-duplicates,return=representation"
    r = httpx.post(f"{SUPABASE_URL}/rest/v1/{table}",
                   headers=h, json=payload, timeout=30)
    r.raise_for_status()
    return r.json() if r.text else []


# ------------------------------------------------------------------ sessions
def get_open_session() -> dict | None:
    """หาคาบเรียนที่เปิดอยู่ ถ้าตั้งค่า ROOM ไว้จะกรองเฉพาะห้องนั้น"""
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
    """รายชื่อนักศึกษาที่ยืนยันเข้าร่วมรายวิชานี้แล้ว"""
    rows = _get("course_enrollments", {
        "select": "student_id,student_code_raw,student_name_raw",
        "course_id": f"eq.{course_id}",
        "status": "eq.confirmed",
    })
    return [r for r in rows if r.get("student_id")]


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


def submit_check_in(session_id: str, student_id: str, photo_jpeg: bytes,
                    confidence: float, started_at: str,
                    late_after_minutes: int) -> str:
    """บันทึกการเข้าเรียนพร้อมภาพหลักฐาน คืนสถานะที่บันทึกจริง

    สถานะคำนวณจากเวลาของเซิร์ฟเวอร์เป็นหลัก ไม่ใช้นาฬิกาของ Pi
    เพราะนาฬิกา Pi อาจคลาดเคลื่อนถ้าไม่ได้ซิงก์เวลา
    """
    data_url = "data:image/jpeg;base64," + base64.b64encode(photo_jpeg).decode()

    now = datetime.now(timezone.utc)
    started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    elapsed_min = (now - started).total_seconds() / 60
    status = "late" if elapsed_min > late_after_minutes else "on_time"

    _post("attendance_records", {
        "session_id": session_id,
        "student_id": student_id,
        "photo_data_url": data_url,
        "confidence": round(float(confidence), 4),
        "status": status,
        "checked_in_at": now.isoformat(),
    })
    log.info("บันทึกการเข้าเรียน student=%s status=%s conf=%.3f",
             student_id, status, confidence)
    return status


def heartbeat() -> None:
    """แจ้งว่าอุปกรณ์ยังทำงานอยู่ — อัปเดตแถวเดิมของอุปกรณ์นี้ (ไม่สร้างแถวใหม่ทุก 4 วิ)"""
    try:
        _upsert("device_heartbeats", {
            "device_code": DEVICE_CODE,
            "room": ROOM or None,
            "seen_at": datetime.now(timezone.utc).isoformat(),
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
