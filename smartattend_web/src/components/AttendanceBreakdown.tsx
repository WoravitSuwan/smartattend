import { useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { fetchAttendanceDetail, type AttendanceScoreDetail } from '@/lib/attendance-score-data';

/**
 * บอกนักศึกษาว่าคะแนนการเข้าเรียนมาจากไหน (สเปกข้อ 3.4)
 *
 * "ตรงเวลา 8 สาย 3 ขาด 1 จาก 12 คาบ ยกเลิก 2 คาบ นับจริง 10 คาบ คิดเป็น 7.92 จาก 10"
 * ตัวเลขทุกตัวมาจาก attendance_score_detail() ในฐานข้อมูล ซึ่งเป็นตัวเดียวกับที่
 * ใช้คำนวณคะแนนจริง จึงไม่มีทางที่ตัวเลขที่อธิบายจะต่างจากคะแนนที่ได้
 */
const AttendanceBreakdown = ({ componentId, studentId }: { componentId: string; studentId: string }) => {
  const [d, setD] = useState<AttendanceScoreDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAttendanceDetail(componentId, studentId).then(r => { if (!cancelled) setD(r); });
    return () => { cancelled = true; };
  }, [componentId, studentId]);

  if (!d) return null;

  const total = d.counted_sessions + d.cancelled_sessions;

  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2.5 space-y-1.5">
      <p className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
        <CalendarCheck className="w-3.5 h-3.5 text-primary" /> ที่มาของคะแนนการเข้าเรียน
      </p>

      <div className="grid grid-cols-4 gap-1.5 text-center">
        {([
          ['ตรงเวลา', d.on_time, d.credits.on_time],
          ['สาย', d.late, d.credits.late],
          ['ลา', d.excused, d.credits.excused],
          ['ขาด', d.absent, d.credits.absent],
        ] as const).map(([label, n, credit]) => (
          <div key={label} className="rounded-lg bg-background px-1 py-1.5">
            <p className="text-[9px] text-muted-foreground">{label}</p>
            <p className="text-sm font-bold text-foreground">{n}</p>
            <p className="text-[9px] text-muted-foreground">×{credit}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        คาบทั้งหมด {total} คาบ
        {d.cancelled_sessions > 0 && ` · ยกเลิก ${d.cancelled_sessions} คาบ (ไม่นับ)`}
        {' '}· นับจริง {d.counted_sessions} คาบ
        {d.joined_at && ` · นับตั้งแต่วันที่เข้าร่วมรายวิชา`}
        {d.withdrawn_at && ` · นับถึงวันที่ถอนรายวิชา`}
      </p>

      {d.ratio != null && (
        <p className="text-[11px] text-foreground">
          <span className="text-muted-foreground">รวมค่าน้ำหนัก </span>
          {d.credit_sum} ÷ {d.counted_sessions} คาบ × {d.weight} คะแนน =
          <span className="font-bold text-primary"> {d.earned.toFixed(2)} จาก {d.weight}</span>
        </p>
      )}

      {d.counted_sessions === 0 && (
        <p className="text-[10px] text-muted-foreground">
          ยังไม่มีคาบที่นับได้ จึงยังไม่มีคะแนนส่วนนี้
        </p>
      )}
    </div>
  );
};

export default AttendanceBreakdown;
