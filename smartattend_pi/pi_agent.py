"""โปรแกรมหลักที่รันบน Raspberry Pi ประจำห้องเรียน

การทำงาน:
    1. ถามเซิร์ฟเวอร์ทุก ๆ ไม่กี่วินาทีว่ามีคาบเรียนเปิดอยู่หรือไม่
    2. เมื่อเจอคาบเรียนใหม่ ดาวน์โหลดภาพใบหน้าของนักศึกษาในวิชานั้นมาสร้างคลังเวกเตอร์
    3. เปิดกล้อง จดจำใบหน้า และบันทึกการเข้าเรียนเมื่อยืนยันตัวตนได้
    4. เมื่อคาบเรียนปิด กลับไปรอรอบใหม่

Pi เป็นฝ่ายถามเซิร์ฟเวอร์เอง (polling) เพราะอุปกรณ์อยู่หลัง NAT ของมหาวิทยาลัย
เซิร์ฟเวอร์จึงยิงคำสั่งเข้ามาหา Pi โดยตรงไม่ได้
"""
from __future__ import annotations

import argparse
import base64
import logging
import re
import sys
import time

import cv2
import numpy as np

import supabase_client as sb
from camera import Camera
from face_recognizer import FaceDatabase, FaceRecognizer, draw_overlay

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pi-agent")

POLL_SECONDS = 4          # ความถี่ในการถามเซิร์ฟเวอร์เมื่อยังไม่มีคาบเรียน
COOLDOWN_SECONDS = 6      # เว้นระยะหลังบันทึกสำเร็จ กันบันทึกซ้ำคนเดิม
BANNER_SECONDS = 4        # ระยะเวลาแสดงผลลัพธ์บนจอ


def decode_data_url(data_url: str) -> np.ndarray | None:
    """แปลง data URL ที่เก็บในฐานข้อมูลให้เป็นภาพ OpenCV"""
    try:
        b64 = re.sub(r"^data:image/\w+;base64,", "", data_url)
        buf = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    except Exception as e:  # noqa: BLE001
        log.warning("ถอดรหัสภาพไม่สำเร็จ: %s", e)
        return None


def build_database(course_id: str) -> FaceDatabase:
    """สร้างคลังเวกเตอร์ใบหน้าจากภาพของนักศึกษาในรายวิชานี้"""
    db = FaceDatabase()

    enrolled = sb.get_enrolled_students(course_id)
    if not enrolled:
        log.warning("ไม่มีนักศึกษาที่ยืนยันเข้าร่วมรายวิชานี้")
        return db

    ids = [e["student_id"] for e in enrolled]
    profiles = sb.get_profiles(ids)
    images = sb.get_face_images(ids)
    log.info("ดาวน์โหลดภาพใบหน้า %d ภาพ จากนักศึกษา %d คน", len(images), len(ids))

    used = 0
    for row in images:
        # ภาพที่ผ่านการเสริมข้อมูลไม่ช่วยอะไรกับวิธี embedding จึงข้ามไป
        if (row.get("kind") or "").lower() in {"augmented", "aug"}:
            continue
        img = decode_data_url(row.get("image_data") or "")
        if img is None:
            continue
        sid = row["student_id"]
        prof = profiles.get(sid, {})
        if db.add_from_image(img, sid,
                             prof.get("student_code") or row.get("student_code") or "",
                             prof.get("name") or ""):
            used += 1

    log.info("สร้างคลังใบหน้าสำเร็จ: %d เวกเตอร์ จาก %d คน", len(db), db.num_people)
    if db.num_people < 2:
        log.warning("มีข้อมูลใบหน้าเพียง %d คน — ระบบอาจแยกแยะได้ไม่แม่นยำ",
                    db.num_people)
    if used == 0:
        log.error("ไม่พบใบหน้าในภาพที่ดาวน์โหลดมาเลย")
    return db




def main() -> None:
    ap = argparse.ArgumentParser(description="SmartAttend — Raspberry Pi agent")
    ap.add_argument("--camera", type=int, default=0, help="หมายเลขกล้อง USB (ค่าเริ่มต้น 0)")
    ap.add_argument("--source", choices=["auto", "csi", "usb"], default="auto",
                    help="ชนิดกล้อง: auto = ลอง CSI ก่อนแล้วค่อย USB")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--tolerance", type=float, default=0.45,
                    help="ระยะห่างสูงสุดที่ถือว่าเป็นคนเดียวกัน (ต่ำ = เข้มงวด)")
    ap.add_argument("--downscale", type=float, default=0.25,
                    help="ย่อภาพก่อนตรวจจับ (0.25 = เร็วสุด, 0.5 = แม่นขึ้นแต่ช้าลง)")
    ap.add_argument("--no-display", action="store_true",
                    help="ไม่เปิดหน้าต่างแสดงผล เหมาะกับการรันเป็นบริการเบื้องหลัง")
    args = ap.parse_args()

    try:
        cap = Camera(width=args.width, height=args.height,
                     source=args.source, index=args.camera)
    except RuntimeError as e:
        log.error("%s", e)
        sys.exit(1)
    log.info("เริ่มรอคาบเรียน")

    session: dict | None = None
    recognizer: FaceRecognizer | None = None
    checked_in: set[str] = set()
    last_poll = 0.0
    cooldown_until = 0.0
    banner_until = 0.0
    banner_text = ""
    banner_color = (80, 200, 90)

    try:
        while True:
            now = time.time()

            # ---------- ถามเซิร์ฟเวอร์เป็นระยะ ----------
            if now - last_poll > POLL_SECONDS:
                last_poll = now
                try:
                    current = sb.get_open_session()
                except Exception as e:  # noqa: BLE001
                    log.warning("ติดต่อเซิร์ฟเวอร์ไม่ได้: %s", e)
                    current = session

                if current and (session is None or current["id"] != session["id"]):
                    session = current
                    course = (session.get("courses") or {})
                    log.info("พบคาบเรียนใหม่: %s %s",
                             course.get("code", ""), course.get("name", ""))
                    db = build_database(session["course_id"])
                    recognizer = FaceRecognizer(db, tolerance=args.tolerance,
                                                downscale=args.downscale) \
                        if len(db) else None
                    checked_in.clear()
                elif current is None and session is not None:
                    log.info("คาบเรียนปิดแล้ว — กลับไปรอรอบใหม่")
                    session, recognizer = None, None
                    checked_in.clear()

                sb.heartbeat()

            ok, frame = cap.read()
            if not ok:
                time.sleep(0.1)
                continue

            display = frame

            # ---------- จดจำใบหน้าเมื่อมีคาบเรียนเปิดอยู่ ----------
            if session and recognizer and now > cooldown_until:
                course_code = (session.get("courses") or {}).get("code", "")
                preview = recognizer.recognise(frame)
                display = draw_overlay(frame, preview, course_code)

                confirmed = recognizer.recognise_stable(frame)
                if confirmed and confirmed.student_id not in checked_in:
                    sid = confirmed.student_id
                    try:
                        if sb.already_checked_in(session["id"], sid):
                            checked_in.add(sid)
                            log.info("%s เช็คชื่อไปแล้วก่อนหน้านี้", confirmed.name)
                        else:
                            ok_enc, jpg = cv2.imencode(
                                ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                            status = sb.submit_check_in(
                                session["id"], sid, jpg.tobytes(),
                                confirmed.confidence,
                                session["started_at"],
                                session.get("late_after_minutes", 15),
                            )
                            checked_in.add(sid)
                            label = "ตรงเวลา" if status == "on_time" else "มาสาย"
                            banner_text = f"{confirmed.name}  {confirmed.confidence*100:.1f}%  [{label}]"
                            banner_color = (80, 200, 90) if status == "on_time" else (60, 180, 240)
                            banner_until = now + BANNER_SECONDS
                            cooldown_until = now + COOLDOWN_SECONDS
                            log.info("เช็คชื่อสำเร็จ: %s (%s)", confirmed.name, label)
                    except Exception as e:  # noqa: BLE001
                        log.error("บันทึกการเข้าเรียนไม่สำเร็จ: %s", e)
                        banner_text = "บันทึกไม่สำเร็จ กรุณาลองใหม่"
                        banner_color = (60, 60, 220)
                        banner_until = now + BANNER_SECONDS
                    recognizer.reset()

            elif session is None:
                cv2.putText(display, "Waiting for class...", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (180, 180, 180), 2)

            # ---------- แถบผลลัพธ์ ----------
            if now < banner_until and banner_text:
                h, w = display.shape[:2]
                cv2.rectangle(display, (0, h - 60), (w, h), banner_color, cv2.FILLED)
                cv2.putText(display, banner_text, (16, h - 22),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

            if not args.no_display:
                cv2.imshow("SmartAttend", display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            else:
                time.sleep(0.03)

    except KeyboardInterrupt:
        log.info("หยุดการทำงานตามคำสั่งผู้ใช้")
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
