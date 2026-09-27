import { FlaskConical } from 'lucide-react';

/**
 * ป้ายกำกับว่าฟีเจอร์นี้เป็น "การทดลอง" ที่ยังไม่ถูกนำไปใช้งานจริง
 *
 * ใช้กับหน้าเทรนโมเดล CNN ทั้งชุด เพราะระบบเทรนโมเดลจริง เก็บประวัติจริง
 * และวาดกราฟจากตัวเลขจริง แต่ **ไม่มีส่วนใดของระบบเรียกโมเดลนี้มาจดจำใบหน้า**
 * การเช็คชื่อจริงทำบน Raspberry Pi ด้วย dlib/face_recognition ซึ่งเป็นการเทียบ
 * เวกเตอร์ 128 มิติ (embedding) ไม่ใช่การจำแนกด้วย softmax คนละวิธีกันโดยสิ้นเชิง
 *
 * ติดป้ายไว้เพื่อไม่ให้ผู้ใช้ กรรมการสอบ หรือคนที่มาอ่านโค้ดต่อ เข้าใจผิดว่า
 * ความแม่นยำบนหน้านี้คือความแม่นยำของการเช็คชื่อจริง
 */
const ExperimentalFeatureNotice = ({ detail }: { detail?: string }) => (
  <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5">
    <FlaskConical className="w-4 h-4 text-warning shrink-0 mt-0.5" />
    <div className="text-[11px] leading-relaxed text-foreground">
      <span className="font-semibold text-warning">ส่วนทดลอง — ยังไม่ถูกนำไปใช้เช็คชื่อจริง</span>
      <br />
      {detail ?? (
        <>
          โมเดล CNN นี้เทรนและวัดผลจริงในเบราว์เซอร์ด้วย TensorFlow.js แต่การเช็คชื่อหน้าห้องเรียน
          ใช้การเทียบเวกเตอร์ใบหน้า 128 มิติ (dlib) บน Raspberry Pi ซึ่งเป็นอีกวิธีหนึ่ง
          ตัวเลขความแม่นยำบนหน้านี้จึงไม่ใช่ความแม่นยำของการเช็คชื่อจริง
        </>
      )}
    </div>
  </div>
);

export default ExperimentalFeatureNotice;
