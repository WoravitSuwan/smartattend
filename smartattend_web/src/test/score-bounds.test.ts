import { describe, expect, it } from 'vitest';
import { validateScore } from '@/lib/grade-data';

const item = (max: number) => ({ max_score: max });

describe('validateScore — เพดานคะแนน', () => {
  it('ค่าว่าง (ยังไม่กรอก) ใช้ได้', () => {
    expect(validateScore(item(100), null)).toBeNull();
    expect(validateScore(item(100), undefined)).toBeNull();
  });

  it('ค่าติดลบถูกปฏิเสธ', () => {
    expect(validateScore(item(100), -1)).toBe('ติดลบไม่ได้');
    expect(validateScore(item(100), -0.5)).toBe('ติดลบไม่ได้');
  });

  it('ค่าเกินเพดานถูกปฏิเสธพร้อมบอกเพดาน', () => {
    expect(validateScore(item(50), 50.01)).toBe('เกินคะแนนเต็ม (50)');
    expect(validateScore(item(50), 9999)).toBe('เกินคะแนนเต็ม (50)');
  });

  it('ค่าเท่าเพดานพอดีใช้ได้', () => {
    expect(validateScore(item(50), 50)).toBeNull();
    expect(validateScore(item(2.5), 2.5)).toBeNull();
  });

  it('ศูนย์ใช้ได้ (ตรวจแล้วได้ศูนย์)', () => {
    expect(validateScore(item(100), 0)).toBeNull();
  });

  it('ค่าที่ไม่ใช่ตัวเลขถูกปฏิเสธ', () => {
    expect(validateScore(item(100), Number.NaN)).toBe('ไม่ใช่ตัวเลข');
    expect(validateScore(item(100), Number.POSITIVE_INFINITY)).toBe('ไม่ใช่ตัวเลข');
  });

  it('หัวข้อที่คะแนนเต็มใช้ไม่ได้ ต้องไม่ยอมรับคะแนนใด ๆ', () => {
    // ของเดิมถอยไปใช้ 100 เงียบ ๆ ทำให้กรอก 80 ลงหัวข้อที่เต็ม 0 ได้
    expect(validateScore(item(0), 80)).toBe('หัวข้อนี้ยังตั้งคะแนนเต็มไม่ถูกต้อง');
    expect(validateScore(item(-10), 5)).toBe('หัวข้อนี้ยังตั้งคะแนนเต็มไม่ถูกต้อง');
    // แต่ถ้ายังไม่กรอกก็ไม่ต้องเตือนเรื่องคะแนน
    expect(validateScore(item(0), null)).toBeNull();
  });
});
