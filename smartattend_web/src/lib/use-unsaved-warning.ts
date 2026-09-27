import { useEffect } from 'react';

/**
 * เตือนก่อนออกจากหน้าเมื่อยังมีการเปลี่ยนแปลงที่ไม่ได้บันทึก (สเปกข้อ 2.4)
 *
 * ครอบสองทาง
 *   - ปิดแท็บ / รีเฟรช / กด back ของเบราว์เซอร์ → beforeunload
 *   - กดลิงก์ในแอป → ดัก history.pushState ไม่ได้อย่างน่าเชื่อถือใน React Router
 *     v6 ที่ไม่มี data router จึงใช้การดักคลิกลิงก์และปุ่มที่นำทางแทน
 *
 * เบราว์เซอร์แสดงข้อความของตัวเองเสมอ ไม่รับข้อความที่เรากำหนด (กันสแปม)
 * จึงไม่ต้องพยายามส่งข้อความไทยเข้าไป
 */
export function useUnsavedWarning(hasUnsaved: boolean) {
  useEffect(() => {
    if (!hasUnsaved) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // เบราว์เซอร์รุ่นเก่าต้องการให้คืนค่าสตริง
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);
}
