import { describe, expect, it } from 'vitest';
import {
  componentScore, courseScore, itemWeightsComplete, weightsComplete,
  type GradeComponent, type StructureItem,
} from '@/lib/grade-structure';

/** ตัวเลขในไฟล์นี้เป็นชุดเดียวกับที่ทดสอบบน Postgres จริง เพื่อจับกรณีที่สูตร
 *  ฝั่งหน้าจอกับฝั่งฐานข้อมูลเริ่มไม่ตรงกัน */

const comp = (over: Partial<GradeComponent> = {}): GradeComponent => ({
  id: 'c1', course_id: 'course', name: 'LABs', kind: 'lab',
  weight_percent: 30, calc_mode: 'proportional', drop_lowest: 0,
  is_final_exam: false, score_mode: 'manual',
  credit_on_time: 1, credit_late: 0.5, credit_excused: 1, credit_absent: 0,
  position: 1, ...over,
});

const item = (id: string, max: number, w = 0, position = 0): StructureItem => ({
  id, component_id: 'c1', name: id, max_score: max,
  weight_in_component: w, position, source: 'manual',
});

const scores = (m: Record<string, number | null>) => (id: string) =>
  Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null;

describe('1. proportional — งานคะแนนไม่เท่ากัน ตรวจครบทุกชิ้น', () => {
  const items = [item('Lab1', 10, 0, 1), item('Lab2', 30, 0, 2), item('Lab3', 60, 0, 3)];

  it('(10+15+30) ÷ (10+30+60) × 30 = 16.5', () => {
    const r = componentScore(comp(), items, scores({ Lab1: 10, Lab2: 15, Lab3: 30 }));
    expect(r.earned).toBeCloseTo(16.5, 10);
    expect(r.maxPoints).toBeCloseTo(30, 10);
    expect(r.gradedItems).toBe(3);
    expect(r.totalItems).toBe(3);
    expect(r.dropped).toBe(0);
  });

  it('ได้เต็มทุกชิ้น = ได้เต็มน้ำหนักหมวด', () => {
    const r = componentScore(comp(), items, scores({ Lab1: 10, Lab2: 30, Lab3: 60 }));
    expect(r.earned).toBeCloseTo(30, 10);
    expect(r.maxPoints).toBeCloseTo(30, 10);
  });
});

describe('2. proportional — ตรวจบางชิ้น ที่เหลือต้องไม่ถูกนับเป็นศูนย์', () => {
  const items = [item('Lab1', 10, 0, 1), item('Lab2', 30, 0, 2), item('Lab3', 60, 0, 3)];

  it('ตรวจแค่ Lab1 ได้เต็ม -> earned เท่ากับ maxPoints (100% ของที่ตรวจ)', () => {
    const r = componentScore(comp(), items, scores({ Lab1: 10 }));
    expect(r.earned).toBeCloseTo(3, 10);       // 10/100 × 30
    expect(r.maxPoints).toBeCloseTo(3, 10);    // 10/100 × 30
    expect(r.earned / r.maxPoints).toBeCloseTo(1, 10);
    expect(r.gradedItems).toBe(1);
    expect(r.totalItems).toBe(3);
  });

  it('ถ้านับที่ยังไม่ตรวจเป็นศูนย์ maxPoints จะเป็น 30 ซึ่งผิด', () => {
    const r = componentScore(comp(), items, scores({ Lab1: 10 }));
    expect(r.maxPoints).not.toBeCloseTo(30, 5);
  });

  it('คะแนน 0 ต่างจากยังไม่ตรวจ — ตัวหารต่างกัน', () => {
    const zero = componentScore(comp(), items, scores({ Lab1: 0, Lab2: 15, Lab3: 30 }));
    const absent = componentScore(comp(), items, scores({ Lab2: 15, Lab3: 30 }));
    expect(zero.earned).toBeCloseTo(absent.earned, 10);   // ตัวตั้งเท่ากัน
    expect(zero.maxPoints).toBeCloseTo(30, 10);           // ตรวจครบ
    expect(absent.maxPoints).toBeCloseTo(27, 10);         // 90/100 × 30
    expect(zero.earned / zero.maxPoints).toBeLessThan(absent.earned / absent.maxPoints);
  });
});

describe('3. weighted_items — น้ำหนักย่อยรวม 100', () => {
  const items = [item('V1', 10, 20, 1), item('V2core', 30, 30, 2), item('V2add', 60, 50, 3)];
  const c = comp({ calc_mode: 'weighted_items' });

  it('(1.0×20 + 0.5×30 + 0.5×50) ÷ 100 × 30 = 18', () => {
    const r = componentScore(c, items, scores({ V1: 10, V2core: 15, V2add: 30 }));
    expect(r.earned).toBeCloseTo(18, 10);
    expect(r.maxPoints).toBeCloseTo(30, 10);
  });

  it('ตรวจแค่รายการเดียว ตัวหารเป็นน้ำหนักย่อยของรายการนั้น', () => {
    const r = componentScore(c, items, scores({ V1: 10 }));
    expect(r.earned).toBeCloseTo(6, 10);       // 20/100 × 30
    expect(r.maxPoints).toBeCloseTo(6, 10);
    expect(r.earned / r.maxPoints).toBeCloseTo(1, 10);
  });

  it('น้ำหนักย่อยต่างกันให้ผลต่างจาก proportional บนข้อมูลชุดเดียวกัน', () => {
    const data = scores({ V1: 10, V2core: 15, V2add: 30 });
    const wi = componentScore(c, items, data);
    const pr = componentScore(comp(), items, data);
    expect(wi.earned).toBeCloseTo(18, 10);
    expect(pr.earned).toBeCloseTo(16.5, 10);
  });

  it('itemWeightsComplete ตรวจว่าน้ำหนักย่อยรวม 100', () => {
    expect(itemWeightsComplete(items)).toBe(true);
    expect(itemWeightsComplete([item('a', 10, 60), item('b', 10, 30)])).toBe(false);
    expect(itemWeightsComplete([])).toBe(true);
  });
});

describe('4. drop_lowest', () => {
  const items = [item('Lab1', 10, 0, 1), item('Lab2', 30, 0, 2), item('Lab3', 60, 0, 3)];

  it('ตัดรายการที่สัดส่วนต่ำสุดหนึ่งรายการ', () => {
    // ratio: Lab1=1.0, Lab2=0.5, Lab3=0.25 -> ตัด Lab3
    const r = componentScore(comp({ drop_lowest: 1 }), items,
      scores({ Lab1: 10, Lab2: 15, Lab3: 15 }));
    expect(r.dropped).toBe(1);
    expect(r.droppedNames).toEqual(['Lab3']);
    expect(r.earned).toBeCloseTo((10 + 15) / 40 * 30, 10);
    expect(r.gradedItems).toBe(2);
  });

  it('เสมอกันให้ตัดตามลำดับที่อาจารย์จัดไว้ ไม่ใช่ตาม id', () => {
    // Lab2 กับ Lab3 ได้ 0.5 เท่ากัน -> ตัดตัวที่ position น้อยกว่า (Lab2)
    const r = componentScore(comp({ drop_lowest: 1 }), items,
      scores({ Lab1: 10, Lab2: 15, Lab3: 30 }));
    expect(r.droppedNames).toEqual(['Lab2']);
  });

  it('ไม่ตัดจนไม่เหลือรายการ', () => {
    const r = componentScore(comp({ drop_lowest: 5 }), [item('only', 10, 0, 1)],
      scores({ only: 5 }));
    expect(r.dropped).toBe(0);
    expect(r.gradedItems).toBe(1);
    expect(r.earned).toBeCloseTo(15, 10);
  });

  it('ตัดเฉพาะรายการที่ตรวจแล้ว ไม่ตัดรายการที่ยังไม่ตรวจ', () => {
    const r = componentScore(comp({ drop_lowest: 1 }), items, scores({ Lab1: 10, Lab2: 3 }));
    expect(r.droppedNames).toEqual(['Lab2']);
    expect(r.gradedItems).toBe(1);
  });
});

describe('กรณีขอบ', () => {
  it('ยังไม่มีคะแนนเลย', () => {
    const r = componentScore(comp(), [item('a', 10)], scores({}));
    expect(r.hasAnyScore).toBe(false);
    expect(r.earned).toBe(0);
    expect(r.maxPoints).toBe(0);
  });

  it('หมวดที่ไม่มีรายการเลย', () => {
    const r = componentScore(comp(), [], scores({}));
    expect(r.totalItems).toBe(0);
    expect(r.hasAnyScore).toBe(false);
  });

  it('รายการที่คะแนนเต็มใช้คำนวณไม่ได้ ถูกข้ามและรายงานชื่อ', () => {
    const r = componentScore(comp(), [item('ปกติ', 10, 0, 1), item('พลาด', 0, 0, 2)],
      scores({ 'ปกติ': 10, 'พลาด': 5 }));
    expect(r.invalidNames).toEqual(['พลาด']);
    expect(r.totalItems).toBe(1);
    expect(r.earned).toBeCloseTo(30, 10);
  });

  it('ไม่ปัดเศษระหว่างคำนวณ', () => {
    const items = [item('a', 3, 0, 1), item('b', 3, 0, 2), item('c', 3, 0, 3)];
    const r = componentScore(comp({ weight_percent: 10 }), items,
      scores({ a: 1, b: 1, c: 1 }));
    expect(r.earned).toBeCloseTo(10 / 3, 10);
  });
});

describe('courseScore — รวมทุกหมวด', () => {
  const components: GradeComponent[] = [
    comp({ id: 'att', name: 'เข้าเรียน', weight_percent: 10, position: 1 }),
    comp({ id: 'lab', name: 'LABs', weight_percent: 30, position: 2 }),
    comp({ id: 'mid', name: 'กลางภาค', weight_percent: 25, position: 3 }),
    comp({ id: 'fin', name: 'ปลายภาค', weight_percent: 35, is_final_exam: true, position: 4 }),
  ];
  const itemsOf: Record<string, StructureItem[]> = {
    att: [{ ...item('att1', 100), component_id: 'att' }],
    lab: [{ ...item('lab1', 50), component_id: 'lab' }],
    mid: [{ ...item('mid1', 100), component_id: 'mid' }],
    fin: [{ ...item('fin1', 100), component_id: 'fin' }],
  };
  const get = (cid: string) => itemsOf[cid] ?? [];

  it('น้ำหนักรวม 100 และยังตรวจไม่ครบ', () => {
    const r = courseScore(components, get, scores({ att1: 90, lab1: 40 }));
    // เข้าเรียน 90/100×10 = 9 · LAB 40/50×30 = 24
    expect(r.earned).toBeCloseTo(33, 10);
    expect(r.usedWeight).toBeCloseTo(40, 10);
    expect(r.declaredWeight).toBeCloseTo(100, 10);
    expect(r.normalized).toBeCloseTo(82.5, 10);
  });

  it('ยังไม่มีคะแนนเลย normalized เป็น null', () => {
    const r = courseScore(components, get, scores({}));
    expect(r.usedWeight).toBe(0);
    expect(r.normalized).toBeNull();
  });

  it('weightsComplete', () => {
    expect(weightsComplete(components)).toBe(true);
    expect(weightsComplete(components.slice(0, 2))).toBe(false);
  });
});
