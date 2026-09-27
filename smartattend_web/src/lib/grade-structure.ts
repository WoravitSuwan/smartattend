/**
 * โครงสร้างคะแนนสามระดับ: รายวิชา → หมวดคะแนน → รายการคะแนน → คะแนนรายคน
 *
 * ไฟล์นี้เป็น "สำเนา" ของสูตรที่อยู่ในฟังก์ชัน component_score() ของฐานข้อมูล
 * มีไว้เพื่อให้หน้าจอคำนวณสดขณะพิมพ์ได้โดยไม่ต้องยิงเซิร์ฟเวอร์ทุกตัวอักษร
 *
 * ⚠️ แหล่งความจริงคือฐานข้อมูล ถ้าแก้สูตรที่นี่ต้องแก้ใน migration ด้วย
 *    (supabase/migrations/20260927190000_grade_structure_three_levels.sql)
 *    เทสต์ใน src/test/grade-structure.test.ts ใช้ตัวเลขชุดเดียวกับเทสต์ที่รัน
 *    บน Postgres จริง เพื่อจับกรณีที่สองฝั่งเริ่มไม่ตรงกัน
 */

/** โหมดคำนวณคะแนนของหมวด */
export type CalcMode =
  /** คะแนนหมวด = (Σ คะแนนที่ได้ ÷ Σ คะแนนเต็ม) × weight_percent
   *  ใช้กับหมวดที่งานคะแนนไม่เท่ากันและจำนวนงานไม่แน่นอน เช่น LABs */
  | 'proportional'
  /** คะแนนหมวด = Σ (คะแนนที่ได้ ÷ คะแนนเต็มของรายการ × weight_in_component)
   *              ÷ 100 × weight_percent
   *  ใช้กับหมวดที่มีเกณฑ์ย่อย เช่นโครงงานปลายภาค */
  | 'weighted_items';

export type ScoreMode = 'manual' | 'auto_assignment' | 'auto_attendance';

export interface GradeComponent {
  id: string;
  course_id: string;
  name: string;
  kind: string;
  weight_percent: number;
  calc_mode: CalcMode;
  drop_lowest: number;
  is_final_exam: boolean;
  score_mode: ScoreMode;
  credit_on_time: number;
  credit_late: number;
  credit_excused: number;
  credit_absent: number;
  position: number;
}

export interface StructureItem {
  id: string;
  component_id: string | null;
  name: string;
  /** คะแนนดิบเต็มของรายการ ไม่ใช่เปอร์เซ็นต์ */
  max_score: number;
  /** ใช้เฉพาะโหมด weighted_items */
  weight_in_component: number;
  position: number;
  source: 'manual' | 'assignment' | 'attendance';
}

export interface ComponentScore {
  /** คะแนนที่ได้ หน่วยเป็น "คะแนนของวิชา" (0..weight_percent) */
  earned: number;
  /** น้ำหนักของส่วนที่ตรวจแล้ว — ตัวหารที่ถูกต้องของ earned */
  maxPoints: number;
  gradedItems: number;
  totalItems: number;
  dropped: number;
  hasAnyScore: boolean;
  /** ชื่อรายการที่ถูกตัดออกด้วย drop_lowest — ให้หน้าจออธิบายได้ */
  droppedNames: string[];
  /** ชื่อรายการที่คะแนนเต็มใช้คำนวณไม่ได้ จึงถูกข้าม */
  invalidNames: string[];
}

const EMPTY: ComponentScore = {
  earned: 0, maxPoints: 0, gradedItems: 0, totalItems: 0, dropped: 0,
  hasAnyScore: false, droppedNames: [], invalidNames: [],
};

/**
 * คะแนนของหมวดหนึ่งสำหรับนักศึกษาหนึ่งคน
 *
 * กฎที่ต้องไม่พลาด
 *   - รายการที่ยังไม่ตรวจ (null) ไม่ถูกนับเป็นศูนย์ และไม่ถูกนับในตัวหาร
 *   - null (ยังไม่ตรวจ) กับ 0 (ตรวจแล้วได้ศูนย์) แยกกันเด็ดขาด
 *   - drop_lowest ตัดรายการที่ได้สัดส่วนต่ำสุด นับเฉพาะรายการที่ตรวจแล้ว
 *     และต้องเหลืออย่างน้อยหนึ่งรายการ
 *   - รายการที่ max_score <= 0 ใช้คำนวณไม่ได้ ข้ามทั้งตัวตั้งและตัวหาร
 *   - ไม่ปัดเศษระหว่างคำนวณ ปัดเฉพาะตอนแสดงผล
 */
export function componentScore(
  component: Pick<GradeComponent, 'weight_percent' | 'calc_mode' | 'drop_lowest'>,
  items: StructureItem[],
  scoreOf: (itemId: string) => number | null,
): ComponentScore {
  const invalidNames: string[] = [];
  const rows = items
    .filter(it => {
      const ok = Number.isFinite(Number(it.max_score)) && Number(it.max_score) > 0;
      if (!ok) invalidNames.push(it.name);
      return ok;
    })
    .map(it => {
      const raw = scoreOf(it.id);
      const score = raw == null || !Number.isFinite(raw) ? null : raw;
      const max = Number(it.max_score);
      return {
        item: it,
        max,
        w: component.calc_mode === 'weighted_items' ? Number(it.weight_in_component) || 0 : 0,
        score,
        ratio: score == null ? null : score / max,
      };
    });

  const graded = rows.filter(r => r.ratio != null);
  if (graded.length === 0) {
    return { ...EMPTY, totalItems: rows.length, invalidNames };
  }

  // ตัดรายการที่ต่ำสุด แต่ต้องเหลืออย่างน้อยหนึ่งรายการ
  const dropCount = Math.min(Math.max(component.drop_lowest ?? 0, 0), Math.max(graded.length - 1, 0));
  const droppedIds = new Set(
    [...graded]
      .sort((a, b) =>
        (a.ratio! - b.ratio!) || (a.item.position - b.item.position) ||
        a.item.id.localeCompare(b.item.id))
      .slice(0, dropCount)
      .map(r => r.item.id),
  );
  const droppedNames = rows.filter(r => droppedIds.has(r.item.id)).map(r => r.item.name);

  const kept = rows.filter(r => !droppedIds.has(r.item.id));
  const keptGraded = kept.filter(r => r.ratio != null);
  const w = component.weight_percent;

  let earned = 0;
  let maxPoints = 0;

  if (component.calc_mode === 'weighted_items') {
    const wAll = kept.reduce((a, r) => a + r.w, 0);
    const wGraded = keptGraded.reduce((a, r) => a + r.w, 0);
    earned = (keptGraded.reduce((a, r) => a + r.ratio! * r.w, 0) / 100) * w;
    maxPoints = wAll > 0 ? (wGraded / 100) * w : 0;
  } else {
    const maxAll = kept.reduce((a, r) => a + r.max, 0);
    const maxGraded = keptGraded.reduce((a, r) => a + r.max, 0);
    const earnedRaw = keptGraded.reduce((a, r) => a + r.score!, 0);
    // ตัวหารของ earned คือคะแนนเต็มทั้งหมวด (หักรายการที่ถูก drop) ไม่ใช่
    // คะแนนเต็มของส่วนที่ตรวจแล้ว เพื่อให้ earned กับ maxPoints อยู่สเกลเดียวกัน
    earned = maxAll > 0 ? (earnedRaw / maxAll) * w : 0;
    maxPoints = maxAll > 0 ? (maxGraded / maxAll) * w : 0;
  }

  return {
    earned, maxPoints,
    gradedItems: keptGraded.length,
    totalItems: rows.length,
    dropped: dropCount,
    hasAnyScore: true,
    droppedNames, invalidNames,
  };
}

export interface CourseScore {
  /** คะแนนรวมที่ได้ เทียบกับ usedWeight */
  earned: number;
  /** น้ำหนักรวมของส่วนที่ตรวจแล้ว */
  usedWeight: number;
  /** น้ำหนักรวมที่อาจารย์ตั้งไว้ทุกหมวด */
  declaredWeight: number;
  /** earned ÷ usedWeight × 100 — null เมื่อยังไม่มีคะแนนเลย */
  normalized: number | null;
  perComponent: { component: GradeComponent; score: ComponentScore }[];
}

/** คะแนนรวมของรายวิชา = ผลรวมของทุกหมวด */
export function courseScore(
  components: GradeComponent[],
  itemsByComponent: (componentId: string) => StructureItem[],
  scoreOf: (itemId: string) => number | null,
): CourseScore {
  const perComponent = components.map(component => ({
    component,
    score: componentScore(component, itemsByComponent(component.id), scoreOf),
  }));

  const earned = perComponent.reduce((a, p) => a + p.score.earned, 0);
  const usedWeight = perComponent.reduce((a, p) => a + p.score.maxPoints, 0);
  const declaredWeight = components.reduce((a, c) => a + (Number(c.weight_percent) || 0), 0);

  return {
    earned, usedWeight, declaredWeight,
    normalized: usedWeight > 0 ? (earned / usedWeight) * 100 : null,
    perComponent,
  };
}

/** น้ำหนักรวมครบ 100 หรือยัง (เผื่อความคลาดเคลื่อนของทศนิยม) */
export function weightsComplete(components: Pick<GradeComponent, 'weight_percent'>[]): boolean {
  const total = components.reduce((a, c) => a + (Number(c.weight_percent) || 0), 0);
  return Math.abs(total - 100) < 0.005;
}

/** น้ำหนักย่อยในหมวดโหมด weighted_items ต้องรวม 100 */
export function itemWeightsComplete(items: Pick<StructureItem, 'weight_in_component'>[]): boolean {
  if (items.length === 0) return true;
  const total = items.reduce((a, i) => a + (Number(i.weight_in_component) || 0), 0);
  return Math.abs(total - 100) < 0.005;
}

/**
 * ตรวจช่องที่กรอกผิดทั้งแผ่น คืน map ของ `${itemId}:${studentId}` -> ข้อความ
 * ใช้กฎชุดเดียวกับ validateScore() และกับที่ RPC ตรวจซ้ำอีกชั้น
 */
export function findBadCells(
  items: Pick<StructureItem, 'id' | 'max_score'>[],
  students: { id: string }[],
  grades: Record<string, number | null>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of items) {
    for (const s of students) {
      const key = `${it.id}:${s.id}`;
      const v = grades[key];
      if (v == null) continue;
      if (!Number.isFinite(v)) { out[key] = 'ไม่ใช่ตัวเลข'; continue; }
      const max = Number(it.max_score);
      if (!Number.isFinite(max) || max <= 0) {
        out[key] = 'หัวข้อนี้ยังตั้งคะแนนเต็มไม่ถูกต้อง';
      } else if (v < 0) {
        out[key] = 'ติดลบไม่ได้';
      } else if (v > max) {
        out[key] = `เกินคะแนนเต็ม (${max})`;
      }
    }
  }
  return out;
}
