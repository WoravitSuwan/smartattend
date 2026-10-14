/**
 * กฎการล็อกช่องกรอกคะแนนในหน้ากรอกคะแนนของอาจารย์
 *
 * ที่ต้องมีเทสต์ชุดนี้เพราะกฎเดิมเหมาว่า "source ไม่ใช่ manual คือแก้ไม่ได้"
 * ซึ่งกินงานที่มาจาก assignment เข้าไปด้วย อาจารย์ที่สอบแบบกระดาษ (ไม่ได้โพสต์งาน
 * ในระบบ แต่มีรายการคะแนนที่สร้างจาก assignment อยู่) จึงกรอกคะแนนไม่ได้เลย
 * ทั้งที่ฐานข้อมูลอนุญาตให้เขียนได้ ไม่มี constraint หรือ trigger ใดห้ามไว้
 */
import { describe, it, expect } from 'vitest';
import { isCellLocked } from '@/components/GradeSheet';

describe('isCellLocked', () => {
  it('งานที่มาจาก assignment ต้องแก้ไขได้', () => {
    expect(isCellLocked({ itemSource: 'assignment' })).toBe(false);
  });

  it('งานที่กรอกเอง (manual) ต้องแก้ไขได้', () => {
    expect(isCellLocked({ itemSource: 'manual' })).toBe(false);
  });

  it('คะแนนจากการเข้าเรียนต้องล็อกไว้ก่อน', () => {
    expect(isCellLocked({ itemSource: 'attendance' })).toBe(true);
  });

  it('หมวดที่ตั้งเป็น auto_attendance ต้องล็อกไว้ก่อน แม้ source จะเป็น manual', () => {
    expect(isCellLocked({
      itemSource: 'manual', componentScoreMode: 'auto_attendance',
    })).toBe(true);
  });

  it('เปิดสวิตช์แก้ด้วยมือแล้ว คะแนนเข้าเรียนต้องพิมพ์ได้', () => {
    expect(isCellLocked({ itemSource: 'attendance', manualOverride: true })).toBe(false);
    expect(isCellLocked({
      itemSource: 'manual', componentScoreMode: 'auto_attendance', manualOverride: true,
    })).toBe(false);
  });

  it('ประกาศผลแล้วต้องล็อกเสมอ แม้เปิดสวิตช์แก้ด้วยมือ', () => {
    expect(isCellLocked({ readOnly: true, itemSource: 'attendance', manualOverride: true }))
      .toBe(true);
    expect(isCellLocked({ readOnly: true, itemSource: 'assignment' })).toBe(true);
    expect(isCellLocked({ readOnly: true, itemSource: 'manual' })).toBe(true);
  });

  it('สวิตช์แก้ด้วยมือไม่มีผลกับงานที่พิมพ์ได้อยู่แล้ว', () => {
    expect(isCellLocked({ itemSource: 'assignment', manualOverride: true })).toBe(false);
  });
});
