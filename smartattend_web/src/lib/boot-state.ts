/**
 * สถานะของหน้าจอช่วงเปิดแอป ก่อนที่ข้อมูลจำเป็นจะมาครบ
 *
 * แยกออกมาเป็นฟังก์ชันล้วนเพื่อให้เทสต์ได้ เพราะเดิมเงื่อนไขพวกนี้กระจายอยู่
 * ในรูปแบบ `if (loading) return null` ตามจุดต่าง ๆ ใน App.tsx ซึ่งนอกจาก
 * เทสต์ไม่ได้ ยังวาดออกมาเป็นจอขาวเปล่าที่ไม่บอกอะไรใครเลย
 */
export type BootView = 'ready' | 'waiting' | 'failed';

/**
 * ตัดสินว่าจะแสดงอะไรระหว่างรอ
 *
 * `failed` คือรู้แน่ว่าพลาด (คำขอ reject) ส่วน `timedOut` คือรอนานเกินกำหนด
 * จนถือว่าไม่ปกติ ทั้งสองกรณีให้ผลเดียวกันคือแสดงสาเหตุให้ผู้ใช้เห็น
 * ไม่ใช่รอต่อไปเงียบ ๆ เพราะการรอที่ไม่มีวันจบคือจอขาวค้างถาวร
 *
 * `ready` มาก่อนทุกอย่าง — ถ้าข้อมูลมาแล้วก็ไม่ต้องสนใจว่าช้าไปหรือเปล่า
 */
export function bootView(args: {
  ready: boolean;
  failed?: boolean;
  timedOut?: boolean;
}): BootView {
  if (args.ready) return 'ready';
  if (args.failed || args.timedOut) return 'failed';
  return 'waiting';
}

/** คีย์ที่ supabase-js ใช้เก็บ session ไว้ใน localStorage */
export const SUPABASE_STORAGE_PREFIX = 'sb-';

/**
 * ล้างเฉพาะ session ของ supabase ไม่ล้าง localStorage ทั้งก้อน
 *
 * ตั้งใจไม่ล้างทั้งหมดเพราะคีย์อื่นเป็นค่าที่ผู้ใช้ตั้งเอง เช่นธีมสว่าง/มืด
 * ไม่มีเหตุให้หายไปด้วยเพียงเพราะ session เสีย
 *
 * คืนจำนวนคีย์ที่ลบ เพื่อให้ผู้เรียกบอกผู้ใช้ได้ว่าได้ทำอะไรลงไปจริง
 */
export function clearSupabaseSession(store: Pick<Storage, 'length' | 'key' | 'removeItem'>): number {
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(SUPABASE_STORAGE_PREFIX)) doomed.push(k);
  }
  doomed.forEach(k => store.removeItem(k));
  return doomed.length;
}
