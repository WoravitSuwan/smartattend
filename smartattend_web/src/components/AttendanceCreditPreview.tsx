import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import {
  fetchCriteriaImpact, previewAttendanceScores,
  type AttendancePreviewRow, type CriteriaImpact,
} from '@/lib/attendance-score-data';

interface Props {
  componentId: string;
  /** เกณฑ์ที่กำลังปรับอยู่ในฟอร์ม (ยังไม่บันทึก) */
  credits: { on_time: number; late: number; excused: number; absent: number };
}

/**
 * แสดงตัวอย่างคะแนนของนักศึกษาจริงด้วยเกณฑ์ที่อาจารย์กำลังปรับ
 *
 * ข้อ 3.4 ของสเปก: อาจารย์ปรับค่าแล้วต้องเห็นผลเปลี่ยนทันที เพราะตัวเลข
 * credit_late = 0.5 ไม่ได้บอกอะไรเลยถ้าไม่เห็นว่ามันทำให้ใครได้เท่าไร
 * และต้องเตือนว่าการแก้เกณฑ์กระทบนักศึกษากี่คนที่มีคะแนนบันทึกไว้แล้ว
 */
const AttendanceCreditPreview = ({ componentId, credits }: Props) => {
  // แยกเป็นค่าพื้นฐานก่อนใส่ใน deps — ถ้าใส่ object ตรง ๆ effect จะรันทุกครั้งที่
  // พ่อ render ใหม่ เพราะ object ถูกสร้างใหม่ทุกรอบ
  const { on_time: cOnTime, late: cLate, excused: cExcused, absent: cAbsent } = credits;
  const [rows, setRows] = useState<AttendancePreviewRow[]>([]);
  const [impact, setImpact] = useState<CriteriaImpact | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // หน่วงเล็กน้อยระหว่างพิมพ์ เพื่อไม่ยิงทุกตัวอักษร
    const timer = setTimeout(() => {
      Promise.all([
        previewAttendanceScores(componentId,
          { on_time: cOnTime, late: cLate, excused: cExcused, absent: cAbsent }, 3),
        fetchCriteriaImpact(componentId),
      ]).then(([r, imp]) => {
        if (cancelled) return;
        setRows(r);
        setImpact(imp);
        setLoading(false);
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [componentId, cOnTime, cLate, cExcused, cAbsent]);

  if (!loading && rows.length === 0 && !impact?.closed_sessions) {
    return (
      <p className="text-[10px] text-muted-foreground">
        ยังไม่มีคาบเรียนที่ปิดแล้ว จึงยังไม่มีตัวอย่างคะแนนให้ดู
      </p>
    );
  }

  return (
    <div className="rounded-lg bg-background/60 px-2 py-1.5 space-y-1">
      <p className="text-[10px] font-semibold text-foreground flex items-center gap-1">
        <Users className="w-3 h-3" /> ตัวอย่างคะแนนด้วยเกณฑ์นี้
        {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </p>

      {rows.map(r => (
        <div key={r.student_id} className="flex items-center gap-1.5 text-[10px]">
          <span className="flex-1 min-w-0 truncate text-foreground">{r.name}</span>
          <span className="text-muted-foreground shrink-0">
            ตรงเวลา {r.on_time} · สาย {r.late} · ลา {r.excused} · ขาด {r.absent}
            {' '}จาก {r.counted_sessions} คาบ
          </span>
          <span className="font-bold text-primary shrink-0 w-14 text-right">
            {r.earned == null ? '—' : `${r.earned.toFixed(2)}/${r.weight}`}
          </span>
        </div>
      ))}

      {rows.length > 0 && rows[0].cancelled_sessions > 0 && (
        <p className="text-[10px] text-muted-foreground">
          มีคาบที่ยกเลิก {rows[0].cancelled_sessions} คาบ ซึ่งไม่ถูกนับทั้งตัวตั้งและตัวหาร
        </p>
      )}

      {impact?.has_recorded_scores && (
        <p className="text-[10px] text-warning leading-relaxed">
          หมวดนี้มีคะแนนบันทึกไว้แล้ว การเปลี่ยนเกณฑ์จะกระทบนักศึกษา {impact.affected_students} คน
          จาก {impact.closed_sessions} คาบที่ปิดแล้ว — ต้องกด "คำนวณคะแนนเข้าเรียน" อีกครั้ง
          หลังบันทึก คะแนนจึงจะเปลี่ยนตาม
        </p>
      )}
    </div>
  );
};

export default AttendanceCreditPreview;
