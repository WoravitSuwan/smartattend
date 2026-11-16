/**
 * จับเวลาว่ารอนานเกินกำหนดหรือยัง
 *
 * อยู่แยกไฟล์จากคอมโพเนนต์ที่ใช้มัน เพื่อไม่ให้ไฟล์คอมโพเนนต์ส่งออกทั้ง
 * คอมโพเนนต์และสิ่งอื่นผสมกัน ซึ่งทำให้ hot reload ตอน dev ทำงานไม่ครบ
 */
import { useEffect, useState } from 'react';

/** รอเกินเท่านี้ถือว่าไม่ปกติ แล้วเปลี่ยนไปแสดงสาเหตุแทนการรอต่อไปเงียบ ๆ */
export const BOOT_TIMEOUT_MS = 10_000;

/** ตัวจับเวลาถูกยกเลิกทุกครั้งที่ `waiting` เปลี่ยน จึงไม่ค้างไว้หลังข้อมูลมาแล้ว */
export function useBootTimeout(waiting: boolean, ms: number = BOOT_TIMEOUT_MS): boolean {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!waiting) { setTimedOut(false); return; }
    const timer = setTimeout(() => setTimedOut(true), ms);
    return () => clearTimeout(timer);
  }, [waiting, ms]);
  return timedOut;
}
