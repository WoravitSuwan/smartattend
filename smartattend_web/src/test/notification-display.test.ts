import { describe, expect, it } from 'vitest';
import {
  dayLabel, groupNotifications, tidyMessage,
} from '@/lib/notification-display';

describe('tidyMessage', () => {
  it('ตัดขีดยาวที่ไม่มีเหตุผลตามหลัง ซึ่งเกิดเมื่อไม่ได้กรอกเหตุผลยกเลิกคาบ', () => {
    const raw = 'ENGSE506 คาบวันที่ 14/10/2026 14:11 ถูกยกเลิก —  · คาบนี้ไม่ถูกนับในคะแนนการเข้าเรียน';
    expect(tidyMessage(raw))
      .toBe('ENGSE506 คาบวันที่ 14/10/2026 14:11 ถูกยกเลิก · คาบนี้ไม่ถูกนับในคะแนนการเข้าเรียน');
  });

  it('ไม่แตะข้อความที่มีเหตุผลครบ', () => {
    const raw = 'ENGSE506 คาบวันที่ 14/10/2026 14:11 ถูกยกเลิก — อาจารย์ติดประชุม · คาบนี้ไม่ถูกนับ';
    expect(tidyMessage(raw)).toBe(raw);
  });

  it('ตัดตัวคั่นที่ค้างท้ายข้อความ', () => {
    expect(tidyMessage('ประกาศคะแนนใหม่ ·')).toBe('ประกาศคะแนนใหม่');
    expect(tidyMessage('ประกาศคะแนนใหม่ — ')).toBe('ประกาศคะแนนใหม่');
  });

  it('ยุบตัวคั่นที่ซ้อนกันให้เหลือตัวเดียว', () => {
    expect(tidyMessage('ก · · ข')).toBe('ก · ข');
  });

  it('ไม่แตะขีดสั้นในรหัสนักศึกษา', () => {
    expect(tidyMessage('นักศึกษา 67543210064-1 เช็คชื่อแล้ว'))
      .toBe('นักศึกษา 67543210064-1 เช็คชื่อแล้ว');
  });

  it('รับค่าว่างได้โดยไม่ระเบิด', () => {
    expect(tidyMessage(null)).toBe('');
    expect(tidyMessage(undefined)).toBe('');
    expect(tidyMessage('   ')).toBe('');
  });
});

describe('dayLabel', () => {
  const now = new Date('2026-10-14T16:00:00+07:00');
  it('วันเดียวกันคือวันนี้', () => {
    expect(dayLabel(new Date('2026-10-14T01:00:00+07:00'), now)).toBe('วันนี้');
  });
  it('ย้อนหลังหนึ่งวันคือเมื่อวาน', () => {
    expect(dayLabel(new Date('2026-10-13T23:00:00+07:00'), now)).toBe('เมื่อวาน');
  });
  it('ย้อนหลังสามวันคือสัปดาห์นี้', () => {
    expect(dayLabel(new Date('2026-10-11T10:00:00+07:00'), now)).toBe('สัปดาห์นี้');
  });
  it('ย้อนหลังเกินสัปดาห์คือก่อนหน้านี้', () => {
    expect(dayLabel(new Date('2026-09-20T10:00:00+07:00'), now)).toBe('ก่อนหน้านี้');
  });
});

const make = (id: string, minutesAgo: number, over: Partial<{
  type: string; title: string; message: string; relatedId: string | null;
}> = {}) => ({
  id,
  type: over.type ?? 'class_cancelled',
  title: over.title ?? 'คาบเรียนถูกยกเลิก',
  message: over.message ?? 'ENGSE506 คาบวันที่ 14/10/2026 14:11 ถูกยกเลิก',
  relatedId: over.relatedId === undefined ? 'course-1' : over.relatedId,
  createdAt: new Date(Date.parse('2026-10-14T16:00:00+07:00') - minutesAgo * 60000),
});

describe('groupNotifications', () => {
  const now = new Date('2026-10-14T16:00:00+07:00');

  it('ยุบรายการที่ซ้ำกันสนิทและเกิดใกล้กัน', () => {
    const groups = groupNotifications([make('a', 1), make('b', 3)], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].count).toBe(2);
    expect(groups[0].items[0].ids).toEqual(['a', 'b']);
    // ตัวแทนต้องเป็นรายการที่ใหม่ที่สุด
    expect(groups[0].items[0].item.id).toBe('a');
  });

  it('ไม่ยุบเมื่อเนื้อความต่างกัน แม้จะเป็นคาบเดียวกัน — เหตุผลยกเลิกจะได้ไม่หาย', () => {
    const groups = groupNotifications([
      make('a', 1, { message: 'ถูกยกเลิก — อาจารย์ติดประชุม' }),
      make('b', 2, { message: 'ถูกยกเลิก — ห้องเรียนไม่ว่าง' }),
    ], now);
    expect(groups[0].items).toHaveLength(2);
  });

  it('ไม่ยุบเมื่อห่างกันเกินช่วงที่กำหนด', () => {
    const groups = groupNotifications([make('a', 1), make('b', 60)], now);
    expect(groups[0].items).toHaveLength(2);
  });

  it('ไม่ยุบข้ามสิ่งที่อ้างถึงคนละตัว', () => {
    const groups = groupNotifications([
      make('a', 1, { relatedId: 'course-1' }),
      make('b', 2, { relatedId: 'course-2' }),
    ], now);
    expect(groups[0].items).toHaveLength(2);
  });

  it('แบ่งกลุ่มตามวันและคงลำดับใหม่ไปเก่า', () => {
    const groups = groupNotifications([
      make('a', 10),                 // วันนี้
      make('b', 60 * 20),            // เมื่อวาน
      make('c', 60 * 24 * 10),       // ก่อนหน้านี้
    ], now);
    expect(groups.map(g => g.label)).toEqual(['วันนี้', 'เมื่อวาน', 'ก่อนหน้านี้']);
  });

  it('รายการว่างคืนกลุ่มว่าง ไม่ใช่ระเบิด', () => {
    expect(groupNotifications([], now)).toEqual([]);
  });
});
