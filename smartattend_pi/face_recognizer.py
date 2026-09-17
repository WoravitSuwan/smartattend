"""อัลกอริทึมจดจำใบหน้าสำหรับ Raspberry Pi

ใช้แนวทาง Embedding-based ซึ่งต่างจากเวอร์ชันเว็บที่เป็น Closed-set Classification:

    เว็บ (TensorFlow.js)         : ทำนายว่า "ภาพนี้คือนักศึกษาคนที่เท่าไหร่"
                                   -> เพิ่มคนใหม่ต้องเทรนโมเดลใหม่ทั้งหมด
    Pi (โมดูลนี้)                : แปลงใบหน้าเป็นเวกเตอร์ 128 มิติ แล้ววัดระยะห่าง
                                   -> เพิ่มคนใหม่แค่เพิ่มเวกเตอร์ ไม่ต้องเทรนใหม่

ข้อดีเพิ่มเติมคือปฏิเสธคนแปลกหน้าได้ ถ้าระยะห่างเกินเกณฑ์ที่กำหนด
ซึ่งเป็นสิ่งที่โมเดล softmax ทำไม่ได้ (มันบังคับให้ผลรวมเป็น 1 เสมอ)
"""
from __future__ import annotations

import logging
import pickle
from dataclasses import dataclass
from pathlib import Path

import cv2
import face_recognition
import numpy as np

log = logging.getLogger(__name__)

# ระยะห่างสูงสุดที่ยังถือว่าเป็นคนเดียวกัน
# ค่ามาตรฐานของ dlib คือ 0.6 — ยิ่งต่ำยิ่งเข้มงวด
# 0.45 เลือกไว้เพื่อลด False Acceptance ในงานเช็คชื่อที่ต้องการความแม่นยำสูง
DEFAULT_TOLERANCE = 0.45

# จำนวนครั้งที่ต้องเจอคนเดิมติดกันก่อนจะยืนยัน กันการทายผิดชั่ววูบ
CONSECUTIVE_HITS = 3


@dataclass
class MatchResult:
    """ผลการจดจำใบหน้าหนึ่งครั้ง"""
    student_id: str | None
    student_code: str | None
    name: str | None
    confidence: float          # 0.0–1.0 แปลงจากระยะห่าง
    distance: float            # ระยะห่างดิบแบบยุคลิด
    box: tuple[int, int, int, int] | None   # (top, right, bottom, left)

    @property
    def matched(self) -> bool:
        return self.student_id is not None


class FaceDatabase:
    """คลังเวกเตอร์ใบหน้าของนักศึกษาทุกคน"""

    def __init__(self) -> None:
        self.encodings: list[np.ndarray] = []
        self.student_ids: list[str] = []
        self.student_codes: list[str] = []
        self.names: list[str] = []

    def __len__(self) -> int:
        return len(self.encodings)

    @property
    def num_people(self) -> int:
        return len(set(self.student_ids))

    def add(self, encoding: np.ndarray, student_id: str,
            student_code: str = "", name: str = "") -> None:
        self.encodings.append(encoding)
        self.student_ids.append(student_id)
        self.student_codes.append(student_code)
        self.names.append(name)

    def add_from_image(self, image: np.ndarray, student_id: str,
                       student_code: str = "", name: str = "") -> bool:
        """สกัดเวกเตอร์จากภาพหนึ่งใบ คืน True ถ้าพบใบหน้า"""
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) if image.shape[2] == 3 else image
        boxes = face_recognition.face_locations(rgb, model="hog")
        if not boxes:
            return False
        # ถ้าเจอหลายหน้าในภาพลงทะเบียน ให้ใช้หน้าที่ใหญ่ที่สุด (น่าจะเป็นเจ้าของภาพ)
        boxes.sort(key=lambda b: (b[2] - b[0]) * (b[1] - b[3]), reverse=True)
        enc = face_recognition.face_encodings(rgb, [boxes[0]])[0]
        self.add(enc, student_id, student_code, name)
        return True

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump({
                "encodings": self.encodings,
                "student_ids": self.student_ids,
                "student_codes": self.student_codes,
                "names": self.names,
            }, f)
        log.info("บันทึกคลังใบหน้า %d เวกเตอร์ (%d คน) ที่ %s",
                 len(self), self.num_people, path)

    @classmethod
    def load(cls, path: str | Path) -> "FaceDatabase":
        db = cls()
        with open(path, "rb") as f:
            d = pickle.load(f)
        db.encodings = d["encodings"]
        db.student_ids = d["student_ids"]
        db.student_codes = d["student_codes"]
        db.names = d["names"]
        log.info("โหลดคลังใบหน้า %d เวกเตอร์ (%d คน)", len(db), db.num_people)
        return db


class FaceRecognizer:
    """ตรวจจับและจดจำใบหน้าจากเฟรมวิดีโอ"""

    def __init__(self, db: FaceDatabase, tolerance: float = DEFAULT_TOLERANCE,
                 downscale: float = 0.25) -> None:
        self.db = db
        self.tolerance = tolerance
        # ย่อภาพก่อนตรวจจับเพื่อความเร็ว — สำคัญมากบน Pi 4 ที่ CPU จำกัด
        self.downscale = downscale
        self._streak_id: str | None = None
        self._streak_count = 0

    # ------------------------------------------------------------------ core
    def _distance_to_confidence(self, distance: float) -> float:
        """แปลงระยะห่างเป็นค่าความเชื่อมั่น 0–1 เพื่อให้อ่านง่ายและเก็บลงฐานข้อมูล

        ใช้ฟังก์ชันเชิงเส้นแบบมีจุดหักที่ tolerance เพื่อให้ค่าที่ได้
        ไล่ระดับสมเหตุสมผล ไม่ใช่กระโดดจาก 0 เป็น 1 ทันที
        """
        if distance > self.tolerance:
            # เกินเกณฑ์ -> ไล่ลงจาก 0.5 ไปหา 0
            span = max(1e-6, 1.0 - self.tolerance)
            return float(max(0.0, 0.5 * (1.0 - (distance - self.tolerance) / span)))
        # ภายในเกณฑ์ -> ไล่จาก 0.5 ขึ้นไปหา 1.0
        return float(0.5 + 0.5 * (1.0 - distance / max(1e-6, self.tolerance)))

    def recognise(self, frame: np.ndarray) -> MatchResult:
        """จดจำใบหน้าที่เด่นที่สุดในเฟรมเดียว"""
        if len(self.db) == 0:
            return MatchResult(None, None, None, 0.0, 1.0, None)

        small = cv2.resize(frame, (0, 0), fx=self.downscale, fy=self.downscale)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

        boxes = face_recognition.face_locations(rgb, model="hog")
        if not boxes:
            return MatchResult(None, None, None, 0.0, 1.0, None)

        # เลือกใบหน้าที่ใหญ่ที่สุด = คนที่ยืนใกล้กล้องที่สุด
        boxes.sort(key=lambda b: (b[2] - b[0]) * (b[1] - b[3]), reverse=True)
        box = boxes[0]
        enc = face_recognition.face_encodings(rgb, [box])[0]

        distances = face_recognition.face_distance(self.db.encodings, enc)
        best = int(np.argmin(distances))
        dist = float(distances[best])
        conf = self._distance_to_confidence(dist)

        # คืนกรอบในพิกัดของเฟรมจริง ไม่ใช่เฟรมที่ย่อแล้ว
        scale = 1.0 / self.downscale
        full_box = tuple(int(v * scale) for v in box)  # type: ignore[assignment]

        if dist > self.tolerance:
            return MatchResult(None, None, None, conf, dist, full_box)

        return MatchResult(
            student_id=self.db.student_ids[best],
            student_code=self.db.student_codes[best],
            name=self.db.names[best],
            confidence=conf, distance=dist, box=full_box,
        )

    def recognise_stable(self, frame: np.ndarray) -> MatchResult | None:
        """ยืนยันตัวตนก็ต่อเมื่อเจอคนเดิมติดกันหลายเฟรม

        ลดโอกาสบันทึกผิดจากเฟรมเดียวที่บังเอิญเบลอหรือมุมแปลก
        คืน None ระหว่างที่ยังนับไม่ครบ
        """
        result = self.recognise(frame)

        if not result.matched:
            self._streak_id, self._streak_count = None, 0
            return None

        if result.student_id == self._streak_id:
            self._streak_count += 1
        else:
            self._streak_id, self._streak_count = result.student_id, 1

        if self._streak_count >= CONSECUTIVE_HITS:
            self._streak_count = 0
            return result
        return None

    def reset(self) -> None:
        self._streak_id, self._streak_count = None, 0


def draw_overlay(frame: np.ndarray, result: MatchResult,
                 course_code: str = "") -> np.ndarray:
    """วาดกรอบและข้อความลงบนเฟรม สำหรับแสดงบนจอหน้าห้องเรียน

    สีกรอบ: แดง = ไม่พบ, เหลือง = ค่าต่ำ, เขียว = ผ่านเกณฑ์
    """
    out = frame.copy()
    if result.box is None:
        cv2.putText(out, "No face detected", (24, 44),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (60, 60, 220), 2)
        return out

    top, right, bottom, left = result.box
    if not result.matched:
        color, label = (60, 60, 220), "Unknown"
    elif result.confidence < 0.75:
        color = (60, 180, 240)
        label = f"{result.name or result.student_code} {result.confidence*100:.1f}%"
    else:
        color = (80, 200, 90)
        label = f"{result.name or result.student_code} {result.confidence*100:.1f}%"

    cv2.rectangle(out, (left, top), (right, bottom), color, 3)
    cv2.rectangle(out, (left, bottom), (right, bottom + 42), color, cv2.FILLED)
    cv2.putText(out, label, (left + 8, bottom + 29),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    if course_code:
        cv2.putText(out, course_code, (left + 8, top - 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
    return out
