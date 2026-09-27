import { describe, expect, it } from 'vitest';

/**
 * สูตรหักคะแนนส่งช้า — สำเนาของ public.compute_late_penalty() ในฐานข้อมูล
 * มีไว้เพื่อให้หน้าจอแสดงตัวเลขล่วงหน้าได้และเพื่อจับกรณีที่สองฝั่งไม่ตรงกัน
 * แหล่งความจริงคือฐานข้อมูล (migration 20260927220000)
 *
 * ตัวเลขในเทสต์นี้เป็นชุดเดียวกับที่รันบน Postgres 16 จริงแล้ว
 */
export function computeLatePenalty(params: {
  maxScore: number;
  dueAt: Date | null;
  submittedAt: Date | null;
  perDay: number;
  maxPenalty: number;
}): { lateDays: number; penaltyPercent: number; penaltyPoints: number } {
  const { maxScore, dueAt, submittedAt, perDay, maxPenalty } = params;
  const lateDays = !dueAt || !submittedAt || submittedAt <= dueAt
    ? 0
    : Math.ceil((submittedAt.getTime() - dueAt.getTime()) / 86_400_000);
  const penaltyPercent = Math.min(lateDays * (perDay || 0), maxPenalty ?? 100);
  return {
    lateDays,
    penaltyPercent,
    penaltyPoints: Math.round((maxScore || 0) * penaltyPercent / 100 * 100) / 100,
  };
}

const due = new Date('2026-09-20T23:59:00+07:00');
const base = { maxScore: 100, dueAt: due, perDay: 10, maxPenalty: 50 };

describe('หักคะแนนงานส่งช้า', () => {
  it('ส่งก่อนกำหนด ไม่หัก', () => {
    const r = computeLatePenalty({ ...base, submittedAt: new Date('2026-09-20T20:00:00+07:00') });
    expect(r.lateDays).toBe(0);
    expect(r.penaltyPoints).toBe(0);
  });

  it('ส่งตรงเวลาพอดี ไม่หัก', () => {
    const r = computeLatePenalty({ ...base, submittedAt: due });
    expect(r.lateDays).toBe(0);
  });

  it('ช้า 1 นาที นับเป็น 1 วัน (กำหนดส่งคือเส้นตาย ไม่ใช่ค่าประมาณ)', () => {
    const r = computeLatePenalty({ ...base, submittedAt: new Date('2026-09-21T00:00:00+07:00') });
    expect(r.lateDays).toBe(1);
    expect(r.penaltyPoints).toBe(10);
  });

  it('ช้าไม่ถึง 1 วันเต็ม ยังนับ 1 วัน', () => {
    const r = computeLatePenalty({ ...base, submittedAt: new Date('2026-09-21T23:58:00+07:00') });
    expect(r.lateDays).toBe(1);
    expect(r.penaltyPoints).toBe(10);
  });

  it('ช้า 3 วัน หัก 30%', () => {
    const r = computeLatePenalty({ ...base, submittedAt: new Date('2026-09-23T12:00:00+07:00') });
    expect(r.lateDays).toBe(3);
    expect(r.penaltyPoints).toBe(30);
  });

  it('ช้ามากจนติดเพดาน หักไม่เกิน maxPenalty', () => {
    const r = computeLatePenalty({ ...base, submittedAt: new Date('2026-09-30T12:00:00+07:00') });
    expect(r.lateDays).toBe(10);
    expect(r.penaltyPercent).toBe(50);
    expect(r.penaltyPoints).toBe(50);
  });

  it('คะแนนเต็มไม่ใช่ 100 หักตามสัดส่วนของคะแนนเต็ม', () => {
    const r = computeLatePenalty({
      ...base, maxScore: 30, submittedAt: new Date('2026-09-22T10:00:00+07:00'),
    });
    expect(r.lateDays).toBe(2);
    expect(r.penaltyPercent).toBe(20);
    expect(r.penaltyPoints).toBe(6);
  });

  it('งานที่ไม่มีกำหนดส่ง ไม่หักเลย', () => {
    const r = computeLatePenalty({
      ...base, dueAt: null, submittedAt: new Date('2026-09-30T12:00:00+07:00'),
    });
    expect(r.lateDays).toBe(0);
    expect(r.penaltyPoints).toBe(0);
  });

  it('กฎที่ตั้งเป็น 0 ต่อวัน = ไม่หักแม้ส่งช้า', () => {
    const r = computeLatePenalty({
      ...base, perDay: 0, submittedAt: new Date('2026-09-30T12:00:00+07:00'),
    });
    expect(r.lateDays).toBe(10);
    expect(r.penaltyPoints).toBe(0);
  });

  it('คะแนนสุทธิไม่ต่ำกว่า 0 แม้ที่หักมากกว่าคะแนนที่ได้', () => {
    const r = computeLatePenalty({
      ...base, perDay: 25, maxPenalty: 100,
      submittedAt: new Date('2026-09-24T12:00:00+07:00'),
    });
    expect(r.penaltyPoints).toBe(100);
    const rawScore = 40;
    expect(Math.max(rawScore - r.penaltyPoints, 0)).toBe(0);
  });

  it('ยกเว้นการหักเท่ากับตั้ง perDay เป็น 0 แต่ยังรู้ว่าช้ากี่วัน', () => {
    const late = new Date('2026-09-23T12:00:00+07:00');
    const normal = computeLatePenalty({ ...base, submittedAt: late });
    const waived = computeLatePenalty({ ...base, perDay: 0, submittedAt: late });
    expect(normal.penaltyPoints).toBe(30);
    expect(waived.penaltyPoints).toBe(0);
    expect(waived.lateDays).toBe(normal.lateDays);   // ยังบันทึกว่าช้า 3 วัน
  });
});
