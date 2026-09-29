/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './client';

/**
 * ไคลเอนต์ Supabase ตัวเดียวกัน แต่ไม่ผูกกับชนิดข้อมูลที่ generate ไว้
 *
 * ทำไมต้องมี
 *   `src/integrations/supabase/types.ts` ถูก generate มาไม่ครบทุกตาราง
 *   (เช่น `user_roles`, `profiles`, `face_images`, `grade_structure_templates`)
 *   การเรียกตารางเหล่านั้นผ่าน client ที่ผูกชนิดไว้จะเป็น error ตอนคอมไพล์
 *   โค้ดเดิมจึงเขียน `(supabase as any).from(...)` กระจายอยู่หลายไฟล์
 *   ซึ่งทำให้มี `any` โผล่ทุกที่ที่เรียกใช้ และกฎ no-explicit-any ร้องทุกจุด
 *
 *   ไฟล์นี้ย้าย `any` มาไว้ที่เดียว มีคำอธิบายกำกับ และปิดกฎเฉพาะไฟล์นี้
 *   ที่เรียกใช้จึงเขียน `db.from(...)` ได้โดยไม่ต้องมี `any` ของตัวเอง
 *
 * ⚠️ ใช้เฉพาะกับตารางที่ยังไม่อยู่ใน types.ts เท่านั้น
 *    ตารางที่อยู่ในนั้นแล้วให้ใช้ `supabase` ตัวปกติ จะได้ยังมีการตรวจชนิดให้
 *
 * ทางแก้ที่ถาวรคือ generate types.ts ใหม่จากฐานข้อมูลจริง
 *   npx supabase gen types typescript --project-id <your-project-ref> > src/integrations/supabase/types.ts
 * แล้วค่อยไล่เปลี่ยน `db` กลับเป็น `supabase` ทีละจุด ซึ่งต้องต่อฐานข้อมูลจริง
 * จึงยังทำจากที่นี่ไม่ได้
 */
export const db = supabase as any;
