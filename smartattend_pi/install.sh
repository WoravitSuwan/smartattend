#!/usr/bin/env bash
# ติดตั้ง SmartAttend บน Raspberry Pi OS (64-bit, Bookworm)
set -e

# ชื่อไฟล์ systemd unit ประกาศไว้ที่เดียว เพื่อไม่ให้พิมพ์ไม่ตรงกันระหว่างสคริปต์
# กับเอกสาร ซึ่งเคยเป็นปัญหามาแล้ว เอกสารและภาคผนวก ก ของเล่มเคยเขียนว่า
# smartattend-display.service ทั้งที่ไฟล์จริงในโค้ดชื่อ smartattend.service
# ชื่อที่ถูกต้องคือชื่อไฟล์จริง
SERVICE_NAME="smartattend.service"

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
echo ""
echo "──────────────────────────────────────────────"
echo " ตั้งเวลาให้ถูกต้องก่อน (Pi ไม่มีนาฬิกาสำรอง)"
echo "──────────────────────────────────────────────"
echo "  sudo timedatectl set-timezone Asia/Bangkok"
echo "  sudo timedatectl set-ntp true"
echo "  sudo systemctl enable systemd-time-wait-sync"
echo "  timedatectl                # ต้องได้ System clock synchronized: yes"
echo ""
echo "──────────────────────────────────────────────"
echo " ตั้งให้รันอัตโนมัติเมื่อเปิดเครื่อง"
echo "──────────────────────────────────────────────"
echo " สคริปต์นี้ไม่ติดตั้ง systemd unit ให้ เพราะต้องใช้ sudo"
echo ""
echo "   sudo cp ${SERVICE_NAME} /etc/systemd/system/"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable --now ${SERVICE_NAME}"
echo "   systemctl status ${SERVICE_NAME}"
echo "   journalctl -u ${SERVICE_NAME} -f"
