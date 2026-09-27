import { describe, expect, it } from 'vitest';
import { letterGrade, maxScoreOf, weightedTotal, type GradeItem } from '@/lib/grade-data';

const item = (id: string, weight: number, max = 100): GradeItem => ({
  id, course_id: 'c1', name: id, category: 'other', max_score: max, weight,
  created_at: '2026-01-01T00:00:00Z',
});

describe('weightedTotal', () => {
  it('ตรวจไม่ครบ: เกรดต้องคิดจากส่วนที่ตรวจแล้ว ไม่ใช่ F ทั้งห้อง', () => {
    // ตรวจแค่กลางภาค น้ำหนัก 25% นักศึกษาได้เต็ม
    const items = [item('mid', 25), item('final', 75)];
    const w = weightedTotal(items, id => (id === 'mid' ? 100 : null));
    expect(w.total).toBe(25);
    expect(w.usedWeight).toBe(25);
    expect(w.declaredWeight).toBe(100);
    expect(w.percentOfGraded).toBe(100);
    expect(w.complete).toBe(false);
    expect(letterGrade(w.percentOfGraded!)).toBe('A'); // ของเดิมคิดจาก total = F
  });

  it('59.5 จากน้ำหนักที่ตรวจแล้ว 70% = 85% ต้องได้ A ไม่ใช่ D+', () => {
    const items = [item('a', 70), item('b', 30)];
    const w = weightedTotal(items, id => (id === 'a' ? 85 : null));
    expect(w.total).toBe(59.5);
    expect(w.percentOfGraded).toBe(85);
    expect(letterGrade(w.percentOfGraded!)).toBe('A');
  });

  it('ตรวจครบทุกหัวข้อ → complete และเปอร์เซ็นต์เท่ากับ total', () => {
    const items = [item('a', 60), item('b', 40)];
    const w = weightedTotal(items, () => 70);
    expect(w.total).toBe(70);
    expect(w.percentOfGraded).toBe(70);
    expect(w.complete).toBe(true);
    expect(letterGrade(w.percentOfGraded!)).toBe('B');
  });

  it('น้ำหนักรวมไม่ถึง 100 ก็ยังบอกเกรดได้เมื่อตรวจครบตามที่ตั้งไว้', () => {
    const items = [item('a', 50), item('b', 30)];
    const w = weightedTotal(items, () => 100);
    expect(w.declaredWeight).toBe(80);
    expect(w.percentOfGraded).toBe(100);
    expect(w.complete).toBe(true);
  });

  it('ยังไม่มีคะแนนเลย → ไม่บอกเกรด', () => {
    const w = weightedTotal([item('a', 100)], () => null);
    expect(w.percentOfGraded).toBeNull();
    expect(w.complete).toBe(false);
  });

  it('หัวข้อน้ำหนัก 0 ไม่ถูกนับทั้งตัวตั้งและตัวหาร', () => {
    const items = [item('a', 100), item('extra', 0)];
    const w = weightedTotal(items, id => (id === 'extra' ? 0 : 80));
    expect(w.total).toBe(80);
    expect(w.declaredWeight).toBe(100);
    expect(w.complete).toBe(true);
  });

  it('คะแนนเต็มไม่ใช่ 100 คิดตามสัดส่วนของหัวข้อนั้น', () => {
    const w = weightedTotal([item('quiz', 20, 25)], () => 20);
    expect(w.total).toBe(16); // 20/25 * 20
    expect(w.percentOfGraded).toBe(80);
  });
});

describe('maxScoreOf', () => {
  it('ค่าที่ใช้ไม่ได้ (0 / ติดลบ / ไม่ใช่ตัวเลข) ถอยไปใช้ 100', () => {
    expect(maxScoreOf({ max_score: 0 })).toBe(100);
    expect(maxScoreOf({ max_score: -5 })).toBe(100);
    expect(maxScoreOf({ max_score: Number.NaN })).toBe(100);
  });
  it('ค่าปกติใช้ตามที่ตั้งไว้', () => {
    expect(maxScoreOf({ max_score: 25 })).toBe(25);
    expect(maxScoreOf({ max_score: 0.5 })).toBe(0.5);
  });
});
