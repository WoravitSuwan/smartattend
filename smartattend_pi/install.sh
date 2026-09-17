#!/usr/bin/env bash
# ติดตั้ง SmartAttend บน Raspberry Pi OS (64-bit, Bookworm)
set -e

echo "════════════════════════════════════════════"
echo " ติดตั้ง SmartAttend สำหรับ Raspberry Pi"
echo "════════════════════════════════════════════"
echo ""
echo "รุ่นบอร์ดที่ตรวจพบ:"
cat /proc/device-tree/model 2>/dev/null || echo "  (อ่านไม่ได้)"
echo ""

echo "==> [1/5] อัปเดตรายการแพ็กเกจ"
sudo apt update

echo "==> [2/5] ติดตั้งไลบรารีระบบ"
# python3-picamera2 ติดตั้งผ่าน apt เท่านั้น ลงผ่าน pip ไม่ได้
# python3-dlib จาก apt ใช้เวลาไม่กี่นาที เทียบกับคอมไพล์เองที่ใช้ 30-40 นาที
sudo apt install -y \
    python3-dev python3-pip python3-venv \
    python3-picamera2 python3-opencv \
    build-essential cmake \
    libopenblas-dev liblapack-dev libjpeg-dev libatlas-base-dev

echo "==> [3/5] ลองติดตั้ง dlib จาก apt (เร็วกว่าคอมไพล์เองมาก)"
sudo apt install -y python3-dlib || echo "   ไม่มีใน apt จะคอมไพล์เองในขั้นถัดไป"

echo "==> [4/5] สร้าง virtual environment"
# --system-site-packages จำเป็น เพื่อให้ venv มองเห็น picamera2 และ dlib ที่ลงผ่าน apt
python3 -m venv --system-site-packages .venv
source .venv/bin/activate

echo "==> [5/5] ติดตั้งไลบรารี Python"
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "════════════════════════════════════════════"
echo " ติดตั้งเสร็จเรียบร้อย"
echo "════════════════════════════════════════════"
echo ""
echo "ขั้นตอนถัดไป:"
echo "  1. cp .env.example .env  แล้วแก้ค่าให้ถูกต้อง"
echo "  2. source .venv/bin/activate"
echo "  3. python camera.py        # ตรวจว่าระบบเห็นกล้องหรือยัง"
echo "  4. python pi_agent.py      # เริ่มใช้งานจริง"
