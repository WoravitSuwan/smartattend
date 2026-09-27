import { describe, expect, it } from 'vitest';
import {
  canShowLetterGrade, isFullyGraded, letterGrade, maxScoreOf, weightedTotal,
  type GradeItem,
} from '@/lib/grade-data';

const item = (
  id: string, weight: number, max = 100, category: GradeItem['category'] = 'other',
): GradeItem => ({
  id, course_id: 'c1', name: id, category, max_score: max, weight,
  created_at: '2026-01-01T00:00:00Z',
});

/** ตัวช่วยอ่านง่าย: สร้าง scoreOf จาก object (ไม่มีคีย์ = ยังไม่ตรวจ) */
const scores = (m: Record<string, number | null>) => (id: string) =>
  Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null;

describe('weightedTotal — ตรวจบางส่วน', () => {
  it('หัวข้อที่ยังไม่ตรวจไม่ถูกนับเป็นศูนย์ และไม่ถูกนับในตัวหาร', () => {
    const items = [item('mid', 25), item('final', 75, 100, 'final')];
    const w = weightedTotal(items, scores({ mid: 100 }));
    expect(w.earned).toBe(25);
    expect(w.usedWeight).toBe(25);          // ไม่ใช่ 100
    expect(w.declaredWeight).toBe(100);
    expect(w.normalized).toBe(100);         // ได้เต็มในส่วนที่ตรวจแล้ว
    expect(isFullyGraded(w)).toBe(false);
  });

  it('ได้ 59.5 จากน้ำหนักที่ตรวจแล้ว 70 คิดเป็น 85% ไม่ใช่ 59.5%', () => {
    const items = [item('a', 70), item('b', 30)];
    const w = weightedTotal(items, scores({ a: 85 }));
    expect(w.earned).toBeCloseTo(59.5, 10);
    expect(w.usedWeight).toBe(70);
    expect(w.normalized).toBeCloseTo(85, 10);
    expect(letterGrade(w.normalized!)).toBe('A');
    // ถ้าเผลอเอา earned ไปเทียบเกรดตรง ๆ จะได้ D+ ซึ่งเป็นบั๊กเดิม
    expect(letterGrade(w.earned)).toBe('D+');
  });

  it('คะแนน 0 ต่างจากยังไม่ตรวจ — 0 ถูกนับในตัวหาร', () => {
    const items = [item('a', 50), item('b', 50)];
    const zero = weightedTotal(items, scores({ a: 0 }));
    expect(zero.usedWeight).toBe(50);
    expect(zero.earned).toBe(0);
    expect(zero.normalized).toBe(0);

    const untouched = weightedTotal(items, scores({}));
    expect(untouched.usedWeight).toBe(0);
    expect(untouched.normalized).toBeNull();
  });
});

describe('weightedTotal — ตรวจครบ', () => {
  it('ตรวจครบน้ำหนัก 100 แล้ว normalized เท่ากับ earned', () => {
    const items = [item('a', 60), item('b', 40)];
    const w = weightedTotal(items, () => 70);
    expect(w.earned).toBeCloseTo(70, 10);
    expect(w.normalized).toBeCloseTo(70, 10);
    expect(w.usedWeight).toBe(100);
    expect(isFullyGraded(w)).toBe(true);
    expect(letterGrade(w.normalized!)).toBe('B');
  });

  it('คะแนนเต็มไม่ใช่ 100 คิดตามสัดส่วนของหัวข้อนั้น', () => {
    const w = weightedTotal([item('quiz', 20, 25)], scores({ quiz: 20 }));
    expect(w.earned).toBeCloseTo(16, 10);   // 20/25 × 20
    expect(w.normalized).toBeCloseTo(80, 10);
  });

  it('ไม่ปัดเศษระหว่างสะสมผลรวม', () => {
    // 1/3 ของ 10 สามหัวข้อ ต้องรวมได้ 10 พอดี ถ้าปัดกลางทางจะเพี้ยน
    const items = [item('a', 10, 3), item('b', 10, 3), item('c', 10, 3)];
    const w = weightedTotal(items, () => 1);
    expect(w.earned).toBeCloseTo(10, 10);
    expect(w.normalized).toBeCloseTo(33.3333333333, 8);
  });
});

describe('weightedTotal — หัวข้อที่ถูกปิดบัง', () => {
  it('คะแนนปลายภาคที่ RLS ปิดบังมาเป็น null จึงไม่ถูกนับใน usedWeight', () => {
    // ฝั่งนักศึกษา แถว student_grades ของหมวด final ถูกนโยบาย RLS กรองออก
    // ทำให้ scoreOf คืน null — ต้องไม่ทำให้ usedWeight เพิ่มและต้องไม่เป็น 0 คะแนน
    const items = [item('work', 70), item('final', 30, 100, 'final')];
    const w = weightedTotal(items, scores({ work: 80 }));
    expect(w.usedWeight).toBe(70);
    expect(w.earned).toBeCloseTo(56, 10);
    expect(w.normalized).toBeCloseTo(80, 10);
    expect(isFullyGraded(w)).toBe(false);
    // ตรวจไม่ครบ → ห้ามแสดงตัวอักษรเกรด แม้จะประกาศผลแล้วก็ยังไม่ครบ
    expect(canShowLetterGrade(w, true)).toBe(false);
  });
});

describe('weightedTotal — ไม่มีหัวข้อเลย', () => {
  it('รายวิชาที่ยังไม่ตั้งหัวข้อคะแนน', () => {
    const w = weightedTotal([], scores({}));
    expect(w.earned).toBe(0);
    expect(w.usedWeight).toBe(0);
    expect(w.declaredWeight).toBe(0);
    expect(w.normalized).toBeNull();
    expect(isFullyGraded(w)).toBe(false);
    expect(canShowLetterGrade(w, true)).toBe(false);
  });

  it('หัวข้อน้ำหนัก 0 ไม่ถูกนับทั้งตัวตั้งและตัวหาร', () => {
    const w = weightedTotal([item('extra', 0)], scores({ extra: 50 }));
    expect(w.declaredWeight).toBe(0);
    expect(w.usedWeight).toBe(0);
    expect(w.normalized).toBeNull();
  });
});

describe('weightedTotal — น้ำหนักรวมไม่ถึง 100', () => {
  it('ตรวจครบตามที่ตั้งไว้แต่น้ำหนักรวมแค่ 80 ยังไม่ถือว่าครบ', () => {
    const items = [item('a', 50), item('b', 30)];
    const w = weightedTotal(items, () => 100);
    expect(w.declaredWeight).toBe(80);
    expect(w.usedWeight).toBe(80);
    expect(w.normalized).toBe(100);
    // ตามข้อกำหนด: ตัวอักษรเกรดต้องรอให้ usedWeight ครบ 100 เท่านั้น
    expect(isFullyGraded(w)).toBe(false);
    expect(canShowLetterGrade(w, true)).toBe(false);
  });

  it('น้ำหนักรวมเกิน 100 คิดตามที่ตั้งไว้ และถือว่าครบ', () => {
    const items = [item('a', 60), item('b', 60)];
    const w = weightedTotal(items, () => 50);
    expect(w.declaredWeight).toBe(120);
    expect(w.usedWeight).toBe(120);
    expect(isFullyGraded(w)).toBe(true);
  });
});

describe('canShowLetterGrade', () => {
  const full = { usedWeight: 100 };
  const partial = { usedWeight: 99 };

  it('ต้องครบทั้งสองเงื่อนไข: ตรวจครบ 100 และประกาศผลแล้ว', () => {
    expect(canShowLetterGrade(full, true)).toBe(true);
    expect(canShowLetterGrade(full, false)).toBe(false);   // ยังไม่ประกาศ
    expect(canShowLetterGrade(partial, true)).toBe(false); // ตรวจไม่ครบ
    expect(canShowLetterGrade(partial, false)).toBe(false);
  });

  it('ยอมรับความคลาดเคลื่อนของทศนิยม', () => {
    expect(canShowLetterGrade({ usedWeight: 99.995 }, true)).toBe(true);
    expect(canShowLetterGrade({ usedWeight: 99.98 }, true)).toBe(false);
  });
});

describe('maxScoreOf', () => {
  it('คะแนนเต็ม 0 ต้องไม่กลายเป็น 100', () => {
    expect(maxScoreOf({ max_score: 0 })).toBeNull();
    expect(maxScoreOf({ max_score: -5 })).toBeNull();
    expect(maxScoreOf({ max_score: Number.NaN })).toBeNull();
  });

  it('ค่าปกติใช้ตามที่ตั้งไว้', () => {
    expect(maxScoreOf({ max_score: 25 })).toBe(25);
    expect(maxScoreOf({ max_score: 0.5 })).toBe(0.5);
  });

  it('หัวข้อที่คะแนนเต็มใช้ไม่ได้ ถูกข้ามและรายงานชื่อกลับมา', () => {
    const items = [item('ปกติ', 50), item('พลาด', 50, 0)];
    const w = weightedTotal(items, () => 25);
    expect(w.invalidItems).toEqual(['พลาด']);
    expect(w.declaredWeight).toBe(50);      // นับแค่หัวข้อที่ใช้ได้
    expect(w.usedWeight).toBe(50);
    expect(w.earned).toBeCloseTo(12.5, 10); // 25/100 × 50
    expect(w.normalized).toBeCloseTo(25, 10);
  });
});

describe('letterGrade — ค่าขอบเขตของทุกช่วง', () => {
  const cases: [number, string][] = [
    [100, 'A'], [80, 'A'], [79.99, 'B+'],
    [75, 'B+'], [74.99, 'B'],
    [70, 'B'], [69.99, 'C+'],
    [65, 'C+'], [64.99, 'C'],
    [60, 'C'], [59.99, 'D+'],
    [55, 'D+'], [54.99, 'D'],
    [50, 'D'], [49.99, 'F'], [0, 'F'],
  ];
  for (const [score, expected] of cases) {
    it(`${score} → ${expected}`, () => expect(letterGrade(score)).toBe(expected));
  }
});
