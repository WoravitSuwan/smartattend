"""ตัวจับภาพจากกล้อง รองรับทั้งกล้อง CSI และ USB webcam

เหตุผลที่ต้องมีไฟล์นี้:
    Raspberry Pi OS รุ่น Bookworm เปลี่ยนมาใช้ระบบ libcamera
    ทำให้กล้อง CSI (ที่ต่อผ่านสายริบบิ้น) ใช้ cv2.VideoCapture(0) ไม่ได้อีกต่อไป
    ต้องเรียกผ่านไลบรารี Picamera2 แทน

    โมดูลนี้จึงห่อทั้งสองแบบไว้ให้ใช้งานเหมือนกัน โค้ดส่วนอื่นไม่ต้องรู้ว่า
    กำลังใช้กล้องชนิดไหนอยู่
"""
from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger(__name__)


class Camera:
    """อินเทอร์เฟซกล้องแบบเดียว ใช้ได้ทั้ง CSI และ USB

    ตัวอย่างการใช้งาน:
        with Camera(width=640, height=480) as cam:
            ok, frame = cam.read()
    """

    def __init__(self, width: int = 640, height: int = 480,
                 source: str = "auto", index: int = 0) -> None:
        """source: 'auto' | 'csi' | 'usb'"""
        self.width = width
        self.height = height
        self.index = index
        self.kind: str | None = None
        self._picam = None
        self._cap = None

        if source in ("auto", "csi") and self._try_csi():
            self.kind = "csi"
        elif source in ("auto", "usb") and self._try_usb():
            self.kind = "usb"
        else:
            raise RuntimeError(
                "เปิดกล้องไม่ได้\n"
                "  - กล้อง CSI: ตรวจว่าเสียบสายริบบิ้นถูกด้าน และรัน rpicam-hello ได้\n"
                "  - กล้อง USB: ตรวจว่าเสียบแน่น และลอง --camera 1"
            )
        log.info("เปิดกล้องสำเร็จ (ชนิด: %s)", self.kind)

    # ------------------------------------------------------------------ setup
    def _try_csi(self) -> bool:
        try:
            from picamera2 import Picamera2
        except ImportError:
            log.debug("ไม่พบไลบรารี picamera2 — ข้ามการใช้กล้อง CSI")
            return False
        try:
            cam = Picamera2()
            # format RGB888 ของ picamera2 คืนอาร์เรย์เรียงแบบ BGR
            # ซึ่งตรงกับที่ OpenCV ใช้พอดี จึงส่งต่อได้เลยไม่ต้องแปลง
            cfg = cam.create_preview_configuration(
                main={"size": (self.width, self.height), "format": "RGB888"})
            cam.configure(cfg)
            cam.start()
            self._picam = cam
            return True
        except Exception as e:  # noqa: BLE001
            log.debug("เปิดกล้อง CSI ไม่สำเร็จ: %s", e)
            return False

    def _try_usb(self) -> bool:
        import cv2
        cap = cv2.VideoCapture(self.index)
        if not cap.isOpened():
            cap.release()
            return False
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        # ลดหน่วงของภาพ ไม่ให้ประมวลผลเฟรมเก่าค้างในบัฟเฟอร์
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap = cap
        return True

    # ------------------------------------------------------------------- read
    def read(self) -> tuple[bool, np.ndarray | None]:
        """คืน (สำเร็จหรือไม่, ภาพแบบ BGR)"""
        if self._picam is not None:
            try:
                return True, self._picam.capture_array()
            except Exception as e:  # noqa: BLE001
                log.warning("อ่านภาพจากกล้อง CSI ไม่สำเร็จ: %s", e)
                return False, None
        if self._cap is not None:
            return self._cap.read()
        return False, None

    # ---------------------------------------------------------------- cleanup
    def release(self) -> None:
        if self._picam is not None:
            try:
                self._picam.stop()
                self._picam.close()
            except Exception:  # noqa: BLE001
                pass
            self._picam = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def __enter__(self) -> "Camera":
        return self

    def __exit__(self, *exc) -> None:
        self.release()


def list_cameras() -> None:
    """แสดงกล้องที่ระบบมองเห็น ใช้ตอนแก้ปัญหา"""
    print("=== กล้อง CSI (ผ่าน Picamera2) ===")
    try:
        from picamera2 import Picamera2
        cams = Picamera2.global_camera_info()
        if cams:
            for i, c in enumerate(cams):
                print(f"  [{i}] {c.get('Model', 'ไม่ทราบรุ่น')}")
        else:
            print("  ไม่พบกล้อง CSI")
    except ImportError:
        print("  ยังไม่ได้ติดตั้ง picamera2  ->  sudo apt install -y python3-picamera2")
    except Exception as e:  # noqa: BLE001
        print(f"  เกิดข้อผิดพลาด: {e}")

    print("\n=== กล้อง USB (ผ่าน OpenCV) ===")
    import cv2
    found = False
    for i in range(4):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            print(f"  [{i}] ความละเอียด {w}x{h}")
            found = True
        cap.release()
    if not found:
        print("  ไม่พบกล้อง USB")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    list_cameras()
