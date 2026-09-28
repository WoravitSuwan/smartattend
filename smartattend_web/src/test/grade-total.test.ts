import { describe, expect, it } from 'vitest';
import {
  canShowLetterGrade, FALLBACK_GRADE_SCALE, gradePointFrom, isFullyGraded,
  letterGradeFrom, maxScoreOf,
} from '@/lib/grade-data';
import { courseScore, type GradeComponent, type StructureItem } from '@/lib/grade-structure';

/**
 * เทสต์ชุดนี้เคยยิงไปที่ weightedTotal() ซึ่งคิดคะแนนจาก grade_items.weight
 * ตอนนี้น้ำหนักอยู่ที่หมวด (grade_components.weight_percent) แล้ว ฟังก์ชันนั้น
 * ถูกถอดออก กฎทุกข้อจึงย้ายมาตรวจกับ courseScore() ซึ่งเป็นสูตรเดียวกับที่
 * ฐานข้อมูลใช้ กฎที่ต้องคงไว้เหมือนเดิมคือ
 *   - ยังไม่ตรวจ (null) ไม่ถูกนับเป็นศูนย์ และไม่ถูกนับในตัวหาร
 *   - 0 คือตรวจแล้วได้ศูนย์ ต่างจาก null เด็ดขาด
 *   - ห้ามเอา earned ไปเทียบเกณฑ์เกรดตรง ๆ ต้องใช้ normalized
 *   - ตัวอักษรเกรดต้องรอทั้งตรวจครบ 100 และประกาศผลแล้ว
 */

const comp = (
  id: string, weight: number,
  extra: Partial<GradeComponent> = {},
): GradeComponent => ({
  id, course_id: 'c1', name: id, kind: 'other', weight_percent: weight,
  calc_mode: 'proportional', drop_lowest: 0, is_final_exam: false, score_mode: 'manual',
  credit_on_time: 1, credit_late: 0.5, credit_excused: 1, credit_absent: 0,
  position: 0, ...extra,
});

const item = (id: string, componentId: string, max = 100): StructureItem => ({
  id, component_id: componentId, name: id, max_score: max,
  weight_in_component: 0, position: 0, source: 'manual',
});

/** ตัวช่วยอ่านง่าย: สร้าง scoreOf จาก object (ไม่มีคีย์ = ยังไม่ตรวจ) */
const scores = (m: Record<string, number | null>) => (id: string) =>
  Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null;

/** จับคู่รายการเข้าหมวดจากรายการแบน */
const by = (items: StructureItem[]) => (cid: string) =>
  items.filter(i => i.component_id === cid);

const lg = (total: number) => letterGradeFrom(FALLBACK_GRADE_SCALE, total);

describe('courseScore — ตรวจบางส่วน', () => {
  it('หมวดที่ยังไม่ตรวจไม่ถูกนับเป็นศูนย์ และไม่ถูกนับในตัวหาร', () => {
    const cs = [comp('mid', 25), comp('final', 75, { is_final_exam: true })];
    const items = [item('mid1', 'mid'), item('final1', 'final')];
    const r = courseScore(cs, by(items), scores({ mid1: 100 }));
    expect(r.earned).toBeCloseTo(25, 10);
    expect(r.usedWeight).toBeCloseTo(25, 10);      // ไม่ใช่ 100
    expect(r.declaredWeight).toBe(100);
    expect(r.normalized).toBeCloseTo(100, 10);     // ได้เต็มในส่วนที่ตรวจแล้ว
    expect(isFullyGraded(r)).toBe(false);
  });

  it('ได้ 59.5 จากน้ำหนักที่ตรวจแล้ว 70 คิดเป็น 85% ไม่ใช่ 59.5%', () => {
    const cs = [comp('a', 70), comp('b', 30)];
    const items = [item('a1', 'a'), item('b1', 'b')];
    const r = courseScore(cs, by(items), scores({ a1: 85 }));
    expect(r.earned).toBeCloseTo(59.5, 10);
    expect(r.usedWeight).toBeCloseTo(70, 10);
    expect(r.normalized).toBeCloseTo(85, 10);
    expect(lg(r.normalized!)).toBe('A');
    // ถ้าเผลอเอา earned ไปเทียบเกรดตรง ๆ จะได้ D+ ซึ่งเป็นบั๊กเดิม
    expect(lg(r.earned)).toBe('D+');
  });

  it('คะแนน 0 ต่างจากยังไม่ตรวจ — 0 ถูกนับในตัวหาร', () => {
    const cs = [comp('a', 50), comp('b', 50)];
    const items = [item('a1', 'a'), item('b1', 'b')];

    const zero = courseScore(cs, by(items), scores({ a1: 0 }));
    expect(zero.usedWeight).toBeCloseTo(50, 10);
    expect(zero.earned).toBe(0);
    expect(zero.normalized).toBe(0);

    const untouched = courseScore(cs, by(items), scores({}));
    expect(untouched.usedWeight).toBe(0);
    expect(untouched.normalized).toBeNull();
  });
});

describe('courseScore — ตรวจครบ', () => {
  it('ตรวจครบน้ำหนัก 100 แล้ว normalized เท่ากับ earned', () => {
    const cs = [comp('a', 60), comp('b', 40)];
    const items = [item('a1', 'a'), item('b1', 'b')];
    const r = courseScore(cs, by(items), () => 70);
    expect(r.earned).toBeCloseTo(70, 10);
    expect(r.normalized).toBeCloseTo(70, 10);
    expect(r.usedWeight).toBeCloseTo(100, 10);
    expect(isFullyGraded(r)).toBe(true);
    expect(lg(r.normalized!)).toBe('B');
  });

  it('คะแนนเต็มไม่ใช่ 100 คิดตามสัดส่วนของรายการนั้น', () => {
    const cs = [comp('quiz', 20)];
    const items = [item('q1', 'quiz', 25)];
    const r = courseScore(cs, by(items), scores({ q1: 20 }));
    expect(r.earned).toBeCloseTo(16, 10);   // 20/25 × 20
    expect(r.normalized).toBeCloseTo(80, 10);
  });

  it('ไม่ปัดเศษระหว่างสะสมผลรวม', () => {
    // 1/3 ของสามหมวดน้ำหนัก 10 ต้องรวมได้ 10 พอดี ถ้าปัดกลางทางจะเพี้ยน
    const cs = [comp('a', 10), comp('b', 10), comp('c', 10)];
    const items = [item('a1', 'a', 3), item('b1', 'b', 3), item('c1', 'c', 3)];
    const r = courseScore(cs, by(items), () => 1);
    expect(r.earned).toBeCloseTo(10, 10);
    expect(r.normalized).toBeCloseTo(33.3333333333, 8);
  });
});

describe('courseScore — หมวดที่ถูกปิดบัง', () => {
  it('คะแนนปลายภาคที่ RLS ปิดบังมาเป็น null จึงไม่ถูกนับใน usedWeight', () => {
    // ฝั่งนักศึกษา แถว student_grades ของหมวดปลายภาคถูกนโยบาย RLS กรองออก
    // ทำให้ scoreOf คืน null — ต้องไม่ทำให้ usedWeight เพิ่ม และต้องไม่เป็น 0 คะแนน
    const cs = [comp('work', 70), comp('final', 30, { is_final_exam: true })];
    const items = [item('w1', 'work'), item('f1', 'final')];
    const r = courseScore(cs, by(items), scores({ w1: 80 }));
    expect(r.usedWeight).toBeCloseTo(70, 10);
    expect(r.earned).toBeCloseTo(56, 10);
    expect(r.normalized).toBeCloseTo(80, 10);
    expect(isFullyGraded(r)).toBe(false);
    // ตรวจไม่ครบ → ห้ามแสดงตัวอักษรเกรด แม้จะประกาศผลแล้วก็ยังไม่ครบ
    expect(canShowLetterGrade(r, true)).toBe(false);
  });
});

describe('courseScore — ไม่มีหมวดหรือรายการเลย', () => {
  it('รายวิชาที่ยังไม่ตั้งโครงสร้างคะแนน', () => {
    const r = courseScore([], () => [], scores({}));
    expect(r.earned).toBe(0);
    expect(r.usedWeight).toBe(0);
    expect(r.declaredWeight).toBe(0);
    expect(r.normalized).toBeNull();
    expect(isFullyGraded(r)).toBe(false);
    expect(canShowLetterGrade(r, true)).toBe(false);
  });

  it('หมวดน้ำหนัก 0 ไม่เพิ่มทั้งตัวตั้งและตัวหาร', () => {
    const cs = [comp('extra', 0)];
    const items = [item('e1', 'extra')];
    const r = courseScore(cs, by(items), scores({ e1: 50 }));
    expect(r.declaredWeight).toBe(0);
    expect(r.usedWeight).toBe(0);
    expect(r.normalized).toBeNull();
  });

  it('หมวดที่ยังไม่มีรายการ นับน้ำหนักที่ตั้งไว้ แต่ยังไม่มีตัวหาร', () => {
    const cs = [comp('a', 40), comp('ว่าง', 60)];
    const items = [item('a1', 'a')];
    const r = courseScore(cs, by(items), scores({ a1: 100 }));
    expect(r.declaredWeight).toBe(100);
    expect(r.usedWeight).toBeCloseTo(40, 10);   // หมวดที่ว่างยังไม่ถูกนับ
    expect(isFullyGraded(r)).toBe(false);
  });
});

describe('courseScore — น้ำหนักรวมไม่ถึง 100', () => {
  it('ตรวจครบตามที่ตั้งไว้แต่น้ำหนักรวมแค่ 80 ยังไม่ถือว่าครบ', () => {
    const cs = [comp('a', 50), comp('b', 30)];
    const items = [item('a1', 'a'), item('b1', 'b')];
    const r = courseScore(cs, by(items), () => 100);
    expect(r.declaredWeight).toBe(80);
    expect(r.usedWeight).toBeCloseTo(80, 10);
    expect(r.normalized).toBeCloseTo(100, 10);
    // ตามข้อกำหนด: ตัวอักษรเกรดต้องรอให้ usedWeight ครบ 100 เท่านั้น
    expect(isFullyGraded(r)).toBe(false);
    expect(canShowLetterGrade(r, true)).toBe(false);
  });

  it('น้ำหนักรวมเกิน 100 คิดตามที่ตั้งไว้ และถือว่าครบ', () => {
    const cs = [comp('a', 60), comp('b', 60)];
    const items = [item('a1', 'a'), item('b1', 'b')];
    const r = courseScore(cs, by(items), () => 50);
    expect(r.declaredWeight).toBe(120);
    expect(r.usedWeight).toBeCloseTo(120, 10);
    expect(isFullyGraded(r)).toBe(true);
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

  it('รายการที่คะแนนเต็มใช้ไม่ได้ ถูกข้ามและรายงานชื่อกลับมา', () => {
    const cs = [comp('a', 50)];
    const items = [item('ปกติ', 'a', 100), item('พลาด', 'a', 0)];
    const r = courseScore(cs, by(items), () => 25);
    expect(r.perComponent[0].score.invalidNames).toEqual(['พลาด']);
    expect(r.earned).toBeCloseTo(12.5, 10);   // 25/100 × 50
    expect(r.normalized).toBeCloseTo(25, 10);
  });
});

describe('letterGradeFrom / gradePointFrom — ค่าขอบเขตของทุกช่วง', () => {
  const cases: [number, string, number][] = [
    [100, 'A', 4.0], [80, 'A', 4.0], [79.99, 'B+', 3.5],
    [75, 'B+', 3.5], [74.99, 'B', 3.0],
    [70, 'B', 3.0], [69.99, 'C+', 2.5],
    [65, 'C+', 2.5], [64.99, 'C', 2.0],
    [60, 'C', 2.0], [59.99, 'D+', 1.5],
    [55, 'D+', 1.5], [54.99, 'D', 1.0],
    [50, 'D', 1.0], [49.99, 'F', 0], [0, 'F', 0],
  ];
  for (const [score, grade, point] of cases) {
    it(`${score} → ${grade} (${point})`, () => {
      expect(lg(score)).toBe(grade);
      expect(gradePointFrom(FALLBACK_GRADE_SCALE, grade)).toBe(point);
    });
  }

  it('คะแนนต่ำกว่าทุกระดับในเกณฑ์ คืน null ไม่ใช่ F', () => {
    // เกณฑ์ที่อาจารย์ตั้งเองอาจไม่มีระดับ min_score = 0
    expect(letterGradeFrom([{ grade: 'A', min_score: 80, grade_point: 4 }], 50)).toBeNull();
  });
});
