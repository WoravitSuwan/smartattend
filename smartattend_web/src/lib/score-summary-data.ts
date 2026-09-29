import { supabase } from '@/integrations/supabase/client';
import type { CalcMode } from '@/lib/grade-structure';

/** คะแนนของหมวดหนึ่ง ตามที่ฐานข้อมูลคำนวณให้ */
export interface SummaryComponent {
  component_id: string;
  name: string;
  kind: string;
  /** น้ำหนักหมวดที่อาจารย์ตั้งไว้ (%) */
  weight: number;
  calc_mode: CalcMode;
  drop_lowest: number;
  /** คะแนนที่ได้ หน่วยเป็น "คะแนนของวิชา" (0..weight) */
  earned: number;
  /** น้ำหนักของส่วนที่ตรวจแล้ว = ตัวหารที่ถูกต้องของ earned */
  max_points: number;
  graded_items: number;
  total_items: number;
  dropped: number;
  has_any_score: boolean;
  /** จำนวนงานที่อาจารย์วางแผนไว้ (null = คิดจากงานที่มีอยู่จริง) */
  planned_item_count: number | null;
  /** จำนวนงานที่ใช้เป็นฐานของตัวหาร — ที่วางแผนไว้ หรือที่มีอยู่จริง */
  counts_toward: number;
  /** true = หมวดนี้ยังถูกปิดบัง บอกได้แค่ว่ากินน้ำหนักเท่าไร ไม่บอกคะแนน */
  masked: boolean;
}

export interface ScoreSummary {
  course_id: string;
  student_id: string;
  components: SummaryComponent[];
  /** คะแนนที่ได้ เทียบกับ used_weight ไม่ใช่เทียบ 100 */
  earned: number;
  used_weight: number;
  declared_weight: number;
  /** น้ำหนักที่ถูกปิดบังอยู่ (คะแนนปลายภาคก่อนประกาศผล) */
  masked_weight: number;
  /** ร้อยละของส่วนที่ตรวจแล้ว — null เมื่อยังไม่มีคะแนนเลย */
  normalized: number | null;
  fully_graded: boolean;
  final_published: boolean;
  /** ตัวอักษรเกรด — null เมื่อยังไม่ถึงเวลาที่จะบอกได้ */
  grade: string | null;
  grade_is_final: boolean;
  attendance_blocked: boolean;
}

/**
 * สรุปคะแนนของนักศึกษาหนึ่งคนในรายวิชาหนึ่ง คำนวณที่ฐานข้อมูล
 *
 * ทำไมไม่คำนวณในเบราว์เซอร์
 *   สูตรคิดคะแนนอยู่ในฟังก์ชัน component_score() ของฐานข้อมูล ถ้าหน้าจอคิดเอง
 *   จะมีสูตรสองชุดที่ต้องคอยให้ตรงกัน และฝั่งนักศึกษาก็ไม่มีทางรู้ว่าหมวดใด
 *   ถูก RLS ปิดบังไว้ ต่างจาก "ยังไม่ตรวจ" อย่างไร
 *
 *   RPC นี้เป็น SECURITY INVOKER โดยเจตนา จึงอ่านข้อมูลด้วยสิทธิ์ของผู้เรียก
 *   และให้ RLS เป็นคนปิดบังคะแนนปลายภาค — จุดบังคับเดียว
 *
 * ส่ง studentId มาได้เฉพาะอาจารย์ผู้สอนหรือผู้ดูแล ไม่ส่ง = ตัวผู้เรียกเอง
 */
export async function fetchScoreSummary(
  courseId: string, studentId?: string,
): Promise<ScoreSummary | null> {
  const { data, error } = await supabase.rpc('get_student_score_summary', {
    _course_id: courseId,
    _student_id: studentId ?? undefined,
  });
  if (error) { console.error('fetchScoreSummary', error); return null; }
  return data as unknown as ScoreSummary;
}
