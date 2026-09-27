import { describe, expect, it } from 'vitest';
import {
  FALLBACK_GRADE_SCALE, gradePointFrom, letterGradeFrom, type GradeScaleRow,
} from '@/lib/grade-data';

describe('letterGradeFrom — ค่าขอบเขตของทุกช่วง (เกณฑ์เริ่มต้น)', () => {
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
    it(`${score} → ${expected}`, () =>
      expect(letterGradeFrom(FALLBACK_GRADE_SCALE, score)).toBe(expected));
  }
});

describe('letterGradeFrom — เกณฑ์ที่อาจารย์กำหนดเอง', () => {
  const custom: GradeScaleRow[] = [
    { grade: 'A', min_score: 70, grade_point: 4 },
    { grade: 'B', min_score: 60, grade_point: 3 },
    { grade: 'F', min_score: 0, grade_point: 0 },
  ];

  it('ใช้เกณฑ์ของรายวิชา ไม่ใช่ค่าเริ่มต้น', () => {
    expect(letterGradeFrom(custom, 70)).toBe('A');           // ค่าเริ่มต้นจะได้ B
    expect(letterGradeFrom(FALLBACK_GRADE_SCALE, 70)).toBe('B');
    expect(letterGradeFrom(custom, 65)).toBe('B');
    expect(letterGradeFrom(custom, 59.99)).toBe('F');
  });

  it('เรียงลำดับให้เองไม่ว่าส่งมาเรียงหรือไม่', () => {
    const shuffled = [custom[2], custom[0], custom[1]];
    expect(letterGradeFrom(shuffled, 65)).toBe('B');
    expect(letterGradeFrom(shuffled, 95)).toBe('A');
  });

  it('คืน null เมื่อคะแนนต่ำกว่าทุกระดับในเกณฑ์', () => {
    const noBottom: GradeScaleRow[] = [{ grade: 'A', min_score: 80, grade_point: 4 }];
    expect(letterGradeFrom(noBottom, 50)).toBeNull();
  });

  it('เกณฑ์ว่างคืน null ไม่ใช่ F', () => {
    expect(letterGradeFrom([], 90)).toBeNull();
  });
});

describe('gradePointFrom', () => {
  it('อ่านแต้มจากเกณฑ์ที่ส่งเข้ามา', () => {
    expect(gradePointFrom(FALLBACK_GRADE_SCALE, 'A')).toBe(4);
    expect(gradePointFrom(FALLBACK_GRADE_SCALE, 'C+')).toBe(2.5);
    expect(gradePointFrom(FALLBACK_GRADE_SCALE, 'F')).toBe(0);
  });

  it('เกรดที่ไม่มีในเกณฑ์ได้ 0 (เช่น W ที่ไม่คิดแต้ม)', () => {
    expect(gradePointFrom(FALLBACK_GRADE_SCALE, 'W')).toBe(0);
  });

  it('รายวิชาที่ตั้งแต้มเอง', () => {
    const custom: GradeScaleRow[] = [
      { grade: 'ผ่าน', min_score: 60, grade_point: 4 },
      { grade: 'ไม่ผ่าน', min_score: 0, grade_point: 0 },
    ];
    expect(gradePointFrom(custom, 'ผ่าน')).toBe(4);
    expect(letterGradeFrom(custom, 75)).toBe('ผ่าน');
  });
});

describe('เกณฑ์สำรองต้องตรงกับค่าเริ่มต้นที่ seed ไว้ใน migration', () => {
  it('8 ระดับ เรียงจากมากไปน้อย และมีระดับที่เริ่มจาก 0', () => {
    expect(FALLBACK_GRADE_SCALE).toHaveLength(8);
    const mins = FALLBACK_GRADE_SCALE.map(r => r.min_score);
    expect(mins).toEqual([...mins].sort((a, b) => b - a));
    expect(mins).toContain(0);
    expect(FALLBACK_GRADE_SCALE.map(r => r.grade))
      .toEqual(['A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F']);
  });
});
