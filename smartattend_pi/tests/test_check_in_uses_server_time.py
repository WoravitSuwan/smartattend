"""พิสูจน์ว่าการเช็คชื่อไม่พึ่งนาฬิกาของอุปกรณ์เลย

รันได้โดยไม่ต้องติดตั้ง httpx / python-dotenv และไม่ต้องต่อเน็ต:
    python3 tests/test_check_in_uses_server_time.py

เกณฑ์ตรวจรับข้อ 1.3 คือ "ตั้งนาฬิกาอุปกรณ์ให้ผิดแล้วผลที่บันทึกยังถูกต้อง"
วิธีพิสูจน์ที่แน่นอนที่สุดไม่ใช่การแกล้งเปลี่ยนนาฬิกา แต่คือการยืนยันว่า
payload ที่ส่งออกไป "ไม่มีข้อมูลเวลาหรือสถานะติดไปเลย" — เมื่ออุปกรณ์ไม่ได้
ส่งอะไรที่ขึ้นกับนาฬิกาของตัวเอง นาฬิกาจะเพี้ยนแค่ไหนก็ไม่มีผลต่อสิ่งที่บันทึก
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


# ── แทนโมดูลภายนอกด้วยตัวปลอม เพื่อให้เทสต์รันได้ทุกเครื่อง ────────────────
class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = "x"

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise _fake_httpx.HTTPStatusError("boom", request=None, response=self)


class _HTTPError(Exception):
    pass


class _HTTPStatusError(_HTTPError):
    def __init__(self, msg, request=None, response=None):
        super().__init__(msg)
        self.response = response


_fake_httpx = types.ModuleType("httpx")
_fake_httpx.HTTPError = _HTTPError
_fake_httpx.HTTPStatusError = _HTTPStatusError
_fake_httpx.get = lambda *a, **k: _FakeResponse(200, [])
_fake_httpx.post = lambda *a, **k: _FakeResponse(200, {})
sys.modules["httpx"] = _fake_httpx

_fake_dotenv = types.ModuleType("dotenv")
_fake_dotenv.load_dotenv = lambda *a, **k: None
sys.modules["dotenv"] = _fake_dotenv

import os
os.environ.setdefault("SUPABASE_URL", "https://example.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")

import supabase_client as sb  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ผ่าน  {name}")
    else:
        print(f"  ไม่ผ่าน {name} {detail}")
        FAILURES.append(name)


def test_payload_carries_no_device_clock() -> None:
    """อุปกรณ์ต้องไม่ส่งเวลาหรือสถานะที่คำนวณเองไปกับ payload"""
    captured: dict = {}

    def fake_rpc(fn, payload=None):
        captured["fn"] = fn
        captured["payload"] = payload or {}
        return {"status": "late", "checked_in_at": "2026-09-27T03:00:00+00:00",
                "already": False, "server_time": "2026-09-27T03:00:00+00:00"}

    original = sb._rpc
    sb._rpc = fake_rpc
    try:
        result = sb.submit_check_in("sess-1", "stu-1", b"\xff\xd8jpegbytes", 0.9312)
    finally:
        sb._rpc = original

    check("เรียก RPC record_attendance", captured["fn"] == "record_attendance",
          f"(เรียก {captured.get('fn')!r})")

    keys = set(captured["payload"].keys())
    check("payload มีแค่ 4 คีย์ที่ตกลงกันไว้",
          keys == {"_session_id", "_student_id", "_confidence", "_photo"},
          f"(ได้ {sorted(keys)})")

    banned = [k for k in keys if any(w in k.lower() for w in
              ("time", "status", "late", "started", "now", "date", "clock"))]
    check("ไม่มีคีย์ที่เกี่ยวกับเวลาหรือสถานะติดไปด้วย", banned == [], f"(เจอ {banned})")

    check("สถานะที่คืนมาคือค่าที่เซิร์ฟเวอร์ตอบ ไม่ใช่ค่าที่อุปกรณ์คิด",
          result["status"] == "late", f"(ได้ {result.get('status')!r})")
    check("ส่งภาพเป็น data URL", str(captured["payload"]["_photo"]).startswith(
        "data:image/jpeg;base64,"))
    check("ปัดความมั่นใจเหลือ 4 ตำแหน่ง", captured["payload"]["_confidence"] == 0.9312)


def test_server_rejection_is_permanent() -> None:
    """เหตุผลที่ส่งซ้ำไม่ช่วย ต้องถูกยกเป็น CheckInRejected ไม่ใช่ error ทั่วไป"""
    def rejecting_rpc(fn, payload=None):
        raise _fake_httpx.HTTPStatusError(
            "bad request", response=_FakeResponse(400, {"message": "attendance_blocked"}))

    original = sb._rpc
    sb._rpc = rejecting_rpc
    try:
        try:
            sb.submit_check_in("sess-1", "stu-1", b"x", 0.5)
            check("ยก CheckInRejected เมื่อถูกระงับสิทธิ์", False, "(ไม่ยก exception)")
        except sb.CheckInRejected as e:
            check("ยก CheckInRejected เมื่อถูกระงับสิทธิ์", e.reason == "attendance_blocked")
            check("มีข้อความภาษาไทยให้แสดงบนจอ",
                  sb.REJECT_MESSAGES.get(e.reason) == "ถูกระงับสิทธิ์จากการขาดเรียน")
        except Exception as e:  # noqa: BLE001
            check("ยก CheckInRejected เมื่อถูกระงับสิทธิ์", False, f"(ยก {type(e).__name__})")
    finally:
        sb._rpc = original


def test_network_error_is_not_swallowed() -> None:
    """ปัญหาเครือข่ายต้องไม่ถูกแปลงเป็น CheckInRejected เพราะส่งซ้ำได้"""
    def broken_rpc(fn, payload=None):
        raise _fake_httpx.HTTPStatusError(
            "server error", response=_FakeResponse(500, {"message": "upstream down"}))

    original = sb._rpc
    sb._rpc = broken_rpc
    try:
        try:
            sb.submit_check_in("sess-1", "stu-1", b"x", 0.5)
            check("ข้อผิดพลาดเครือข่ายถูกส่งต่อ ไม่กลืน", False, "(ไม่ยก exception)")
        except sb.CheckInRejected:
            check("ข้อผิดพลาดเครือข่ายถูกส่งต่อ ไม่กลืน", False,
                  "(กลายเป็น CheckInRejected ซึ่งจะไม่ถูกส่งซ้ำ)")
        except _fake_httpx.HTTPStatusError:
            check("ข้อผิดพลาดเครือข่ายถูกส่งต่อ ไม่กลืน", True)
    finally:
        sb._rpc = original


def test_malformed_response_is_rejected() -> None:
    """เซิร์ฟเวอร์ตอบไม่ตรงรูปแบบ ต้องไม่ถือว่าเช็คชื่อสำเร็จ"""
    original = sb._rpc
    sb._rpc = lambda fn, payload=None: {"unexpected": True}
    try:
        try:
            sb.submit_check_in("sess-1", "stu-1", b"x", 0.5)
            check("ตอบกลับผิดรูปแบบต้องไม่ถือว่าสำเร็จ", False, "(ไม่ยก exception)")
        except RuntimeError:
            check("ตอบกลับผิดรูปแบบต้องไม่ถือว่าสำเร็จ", True)
    finally:
        sb._rpc = original


def test_module_has_no_clock_arithmetic() -> None:
    """ไม่มี datetime.now() เหลืออยู่ในเส้นทางการเช็คชื่ออีก"""
    source = (ROOT / "supabase_client.py").read_text(encoding="utf-8")
    code_lines = [ln for ln in source.splitlines()
                  if "datetime.now" in ln and not ln.strip().startswith("#")]
    # ที่เหลือได้เฉพาะในคอมเมนต์/docstring ที่อธิบายว่าของเดิมทำผิดอย่างไร
    real = [ln for ln in code_lines if "datetime.now()" in ln and "=" in ln]
    check("ไม่มีการเรียก datetime.now() ในโค้ดจริง", real == [], f"(เจอ {real})")


if __name__ == "__main__":
    print("ทดสอบว่าการเช็คชื่อใช้เวลาของเซิร์ฟเวอร์เท่านั้น\n")
    for fn in (test_payload_carries_no_device_clock,
               test_server_rejection_is_permanent,
               test_network_error_is_not_swallowed,
               test_malformed_response_is_rejected,
               test_module_has_no_clock_arithmetic):
        print(fn.__doc__.strip().splitlines()[0])
        fn()
        print()
    if FAILURES:
        print(f"ไม่ผ่าน {len(FAILURES)} ข้อ: {', '.join(FAILURES)}")
        sys.exit(1)
    print("ผ่านทั้งหมด")
