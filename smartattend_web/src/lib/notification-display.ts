/**
 * ตัวช่วยจัดรูปแบบการแจ้งเตือนก่อนแสดงผล
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้ทดสอบได้โดยไม่ต้อง render อะไรเลย
 * และเพื่อให้ทั้งแผงบนมือถือกับแผงบนจอใหญ่ใช้กฎชุดเดียวกัน ไม่เพี้ยนออกจากกัน
 */

/** ตัวคั่นที่ระบบใช้ประกอบข้อความแจ้งเตือน ไม่รวมขีดสั้นเพราะอยู่ในรหัสนักศึกษา */
const SEPARATORS = '—–·•';

/**
 * เก็บกวาดตัวคั่นที่ไม่มีเนื้อหาตามหลัง
 *
 * ข้อความแจ้งเตือนบางชนิดถูกประกอบขึ้นในฐานข้อมูลด้วยการต่อสตริงตรง ๆ เช่น
 *     '... ถูกยกเลิก — ' || btrim(_reason) || ' · คาบนี้ไม่ถูกนับ...'
 * ถ้าไม่ได้กรอกเหตุผล จะได้ข้อความที่มีขีดยาวลอยอยู่กลางประโยค
 *     'คาบวันที่ 14/10/2026 14:11 ถูกยกเลิก —  · คาบนี้ไม่ถูกนับ...'
 *
 * แก้ที่ตอนแสดงผลแทนการแก้สูตรในฐานข้อมูล เพราะแถวที่บันทึกไปแล้วฝังข้อความ
 * พังไว้ในตัวมันเอง ต่อให้แก้สูตรวันนี้ ของเก่าก็ยังพังอยู่ดี
 *
 * ระวังไม่แตะขีดสั้น (-) เพราะรหัสนักศึกษาใช้ เช่น 67543210064-1
 */
export function tidyMessage(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.replace(/\s+/g, ' ').trim();
  let previous = '';
  // วนจนไม่มีอะไรเปลี่ยน เพราะการตัดตัวคั่นหนึ่งตัวอาจทำให้อีกตัวลอยตามมา
  while (s !== previous) {
    previous = s;
    s = s
      // ขีดยาวที่ตามด้วยตัวคั่นอื่นทันที แปลว่าไม่มีเนื้อหาคั่นกลาง
      .replace(new RegExp(`[—–]\\s*(?=[${SEPARATORS}])`, 'g'), '')
      // ตัวคั่นที่ซ้อนกันเอง เหลือไว้ตัวเดียว
      .replace(new RegExp(`[·•]\\s*(?=[${SEPARATORS}])`, 'g'), '')
      // ตัวคั่นที่ค้างอยู่หัวหรือท้ายข้อความ
      .replace(new RegExp(`^[\\s${SEPARATORS}]+`), '')
      .replace(new RegExp(`[\\s${SEPARATORS}]+$`), '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return s;
}

export interface GroupableNotification {
  id: string;
  type: string;
  title: string;
  message?: string;
  relatedId?: string | null;
  createdAt: Date;
}

export interface CollapsedNotification<T> {
  /** รายการที่ใหม่ที่สุดในกลุ่มที่ยุบรวมกัน ใช้เป็นตัวแทนในการแสดงผล */
  item: T;
  /** จำนวนรายการที่ยุบรวมกัน 1 = ไม่ได้ยุบอะไรเลย */
  count: number;
  /** id ทุกตัวในกลุ่ม เพื่อให้ลบหรือทำเครื่องหมายอ่านแล้วได้ครบ */
  ids: string[];
}

export interface NotificationGroup<T> {
  label: string;
  items: CollapsedNotification<T>[];
}

/** ช่วงเวลาที่ถือว่าการแจ้งเตือนซ้ำกันเกิด "รอบเดียวกัน" */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** ป้ายกลุ่มตามวันที่ เทียบกับ "วันนี้" ที่ส่งเข้ามา ไม่อ่านนาฬิกาเอง จะได้ทดสอบได้ */
export function dayLabel(created: Date, now: Date): string {
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(created).getTime()) / 86400000);
  if (days <= 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  if (days < 7) return 'สัปดาห์นี้';
  return 'ก่อนหน้านี้';
}

/**
 * ยุบรายการที่ซ้ำกันสนิท แล้วจัดกลุ่มตามวัน
 *
 * กุญแจที่ใช้ยุบคือ ชนิด + สิ่งที่อ้างถึง + หัวข้อ + เนื้อความ ครบทั้งสี่อย่าง
 * ตั้งใจให้เข้มกว่าการดูแค่ชนิดกับ relatedId เพราะการแจ้งเตือนชนิดเดียวกันของ
 * สิ่งเดียวกันอาจมีเนื้อความต่างกันจริง ๆ เช่นยกเลิกคาบสองครั้งด้วยคนละเหตุผล
 * ถ้ายุบรวมโดยดูแค่สองอย่างแรก เหตุผลหนึ่งจะหายไปจากสายตาผู้ใช้
 *
 * รายการที่เข้ามาต้องเรียงจากใหม่ไปเก่าแล้ว ซึ่งเป็นลำดับที่ตัวโหลดคืนมาอยู่แล้ว
 */
export function groupNotifications<T extends GroupableNotification>(
  list: T[], now: Date,
): NotificationGroup<T>[] {
  const collapsed: CollapsedNotification<T>[] = [];
  const seen = new Map<string, CollapsedNotification<T>>();

  for (const n of list) {
    const key = [n.type, n.relatedId ?? '', n.title, n.message ?? ''].join('\u0000');
    const prior = seen.get(key);
    const withinWindow = prior
      && prior.item.createdAt.getTime() - n.createdAt.getTime() <= DEDUPE_WINDOW_MS;
    if (prior && withinWindow) {
      prior.count += 1;
      prior.ids.push(n.id);
      continue;
    }
    const entry: CollapsedNotification<T> = { item: n, count: 1, ids: [n.id] };
    seen.set(key, entry);
    collapsed.push(entry);
  }

  const groups: NotificationGroup<T>[] = [];
  for (const entry of collapsed) {
    const label = dayLabel(entry.item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}
