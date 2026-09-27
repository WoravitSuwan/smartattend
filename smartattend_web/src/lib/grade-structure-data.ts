import { supabase } from '@/integrations/supabase/client';
import type { CalcMode, GradeComponent, ScoreMode, StructureItem } from '@/lib/grade-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const componentKinds = {
  attendance: 'การเข้าเรียน',
  assignment: 'งานที่มอบหมาย',
  lab: 'ปฏิบัติการ',
  quiz: 'ทดสอบย่อย',
  midterm: 'สอบกลางภาค',
  final: 'สอบปลายภาค',
  affective: 'จิตพิสัย',
  other: 'อื่น ๆ',
} as const;

export const calcModeLabels: Record<CalcMode, string> = {
  proportional: 'ตามสัดส่วนคะแนนรวม',
  weighted_items: 'ถ่วงน้ำหนักรายการย่อย',
};

export const calcModeHelp: Record<CalcMode, string> = {
  proportional:
    'รวมคะแนนที่ได้ทั้งหมวด หารด้วยคะแนนเต็มทั้งหมวด แล้วคูณน้ำหนักหมวด ' +
    'เหมาะกับหมวดที่งานคะแนนไม่เท่ากันและจำนวนงานไม่แน่นอน เช่น LAB ที่เพิ่มงานได้เรื่อย ๆ',
  weighted_items:
    'แต่ละรายการถือน้ำหนักย่อยของตัวเอง (รวมกันต้องเป็น 100) แล้วคูณน้ำหนักหมวด ' +
    'เหมาะกับหมวดที่มีเกณฑ์ย่อยไม่เท่ากัน เช่นโครงงานที่แบ่งเป็นรายงาน/นำเสนอ/ชิ้นงาน',
};

export const scoreModeLabels: Record<ScoreMode, string> = {
  manual: 'อาจารย์กรอกเอง',
  auto_assignment: 'ดึงจากการตรวจงาน',
  auto_attendance: 'คำนวณจากการเข้าเรียน',
};

export async function fetchComponents(courseId: string): Promise<GradeComponent[]> {
  const { data, error } = await (supabase as any)
    .from('grade_components').select('*').eq('course_id', courseId).order('position');
  if (error) { console.error('fetchComponents', error); return []; }
  return (data ?? []).map((r: any) => ({
    ...r,
    weight_percent: Number(r.weight_percent) || 0,
    drop_lowest: Number(r.drop_lowest) || 0,
    credit_on_time: Number(r.credit_on_time ?? 1),
    credit_late: Number(r.credit_late ?? 0.5),
    credit_excused: Number(r.credit_excused ?? 1),
    credit_absent: Number(r.credit_absent ?? 0),
  })) as GradeComponent[];
}

export async function fetchStructureItems(courseId: string): Promise<StructureItem[]> {
  const { data, error } = await (supabase as any)
    .from('grade_items')
    .select('id, component_id, name, max_score, weight_in_component, position, source')
    .eq('course_id', courseId).order('position');
  if (error) { console.error('fetchStructureItems', error); return []; }
  return (data ?? []).map((r: any) => ({
    ...r,
    max_score: Number(r.max_score) || 0,
    weight_in_component: Number(r.weight_in_component) || 0,
    position: Number(r.position) || 0,
  })) as StructureItem[];
}

/** ข้อมูลหมวดที่ส่งไปบันทึก — ไม่ส่ง id = สร้างใหม่ */
export interface ComponentDraft {
  id?: string | null;
  name: string;
  kind: string;
  weight_percent: number;
  calc_mode: CalcMode;
  drop_lowest: number;
  is_final_exam: boolean;
  score_mode: ScoreMode;
  credit_on_time?: number;
  credit_late?: number;
  credit_excused?: number;
  credit_absent?: number;
}

/**
 * บันทึกโครงสร้างคะแนนทั้งชุด
 *
 * deleteMissing ต้องส่ง true มาอย่างชัดเจนถึงจะลบหมวดที่ไม่ได้ส่งมา และฐานข้อมูล
 * จะปฏิเสธถ้าหมวดที่จะถูกลบมีคะแนนของนักศึกษาอยู่ — ของเดิมลบทิ้งเงียบ ๆ
 * พร้อมคะแนนทั้งห้องผ่าน ON DELETE CASCADE
 */
export async function saveGradeStructure(
  courseId: string, components: ComponentDraft[],
  opts: { deleteMissing?: boolean; reason?: string | null } = {},
) {
  return supabase.rpc('save_grade_structure_v2', {
    _course_id: courseId,
    _components: components as unknown as never,
    _delete_missing: opts.deleteMissing ?? false,
    _reason: opts.reason ?? undefined,
  });
}

/** คัดลอกโครงสร้างจากรายวิชาอื่นของอาจารย์คนเดียวกัน — ไม่คัดลอกคะแนนนักศึกษา */
export async function copyGradeStructure(
  fromCourseId: string, toCourseId: string, includeItems = true,
) {
  return supabase.rpc('copy_grade_structure', {
    _from_course_id: fromCourseId,
    _to_course_id: toCourseId,
    _include_items: includeItems,
  });
}

export interface StructureTemplate {
  id: string;
  name: string;
  created_at: string;
  componentCount: number;
}

export async function fetchTemplates(): Promise<StructureTemplate[]> {
  const { data, error } = await (supabase as any)
    .from('grade_structure_templates')
    .select('id, name, payload, created_at')
    .order('created_at', { ascending: false });
  if (error) { console.error('fetchTemplates', error); return []; }
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, created_at: r.created_at,
    componentCount: Array.isArray(r.payload) ? r.payload.length : 0,
  }));
}

export async function saveTemplate(courseId: string, name: string) {
  return supabase.rpc('save_grade_structure_template', { _course_id: courseId, _name: name });
}

export async function applyTemplate(templateId: string, courseId: string) {
  return supabase.rpc('apply_grade_structure_template', {
    _template_id: templateId, _course_id: courseId,
  });
}

export async function deleteTemplate(templateId: string) {
  return (supabase as any).from('grade_structure_templates').delete().eq('id', templateId);
}
