import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react';
import CancelSessionDialog from '@/components/CancelSessionDialog';

interface ScheduledSession {
  id: string;
  title: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  late_after_minutes: number;
  status: string;
}

/** รวมวันที่กับเวลาจาก <input type=date> + <input type=time> เป็นเวลาท้องถิ่น
 *  แล้วค่อยแปลงเป็น ISO ตอนส่งขึ้นเซิร์ฟเวอร์ */
function toISO(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fmt(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

/** อาจารย์ตั้งคาบเรียนล่วงหน้าเองได้ เลือกวันและเวลาเริ่ม-สิ้นสุด
 *  ใช้สำหรับคาบตามตาราง คาบชดเชย หรือคาบนอกตาราง — พอถึงเวลาระบบจะเปิด
 *  หน้าต่างสแกนให้เอง และปิดให้อัตโนมัติเมื่อหมดเวลา */
export default function ScheduleSessionPanel({ courseId, courseCode }: {
  courseId: string;
  courseCode?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ScheduledSession[]>([]);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; label: string } | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');
  const [title, setTitle] = useState('');
  const [lateAfter, setLateAfter] = useState(15);

  const load = useCallback(async () => {
    if (!courseId) { setRows([]); return; }
    // ให้สถานะตรงกับเวลาจริงก่อนอ่าน เผื่อคาบถึงเวลาเปิด/หมดเวลาแล้ว
    await supabase.rpc('sync_scheduled_sessions');
    const { data } = await supabase
      .from('class_sessions')
      .select('id, title, scheduled_start, scheduled_end, late_after_minutes, status')
      .eq('course_id', courseId)
      .in('status', ['scheduled', 'open'])
      .not('scheduled_start', 'is', null)
      .order('scheduled_start', { ascending: true });
    setRows((data ?? []) as ScheduledSession[]);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const startISO = toISO(date, startTime);
    const endISO = toISO(date, endTime);
    if (!startISO || !endISO) { toast.error('กรุณาเลือกวันและเวลาให้ครบ'); return; }
    if (new Date(endISO) <= new Date(startISO)) {
      toast.error('เวลาสิ้นสุดต้องหลังเวลาเริ่ม'); return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('schedule_class_session', {
      _course_id: courseId,
      _start: startISO,
      _end: endISO,
      _late_after_minutes: lateAfter,
      _title: title.trim() || undefined,
      _mode: 'manual',
    });
    setSaving(false);
    if (error) { toast.error(error.message || 'ตั้งเวลาคาบไม่สำเร็จ'); return; }
    toast.success('ตั้งเวลาคาบเรียนแล้ว');
    setTitle('');
    load();
  };

  /** เปิดไดอะล็อกยกเลิกคาบ
   *  ของเดิมอัปเดต status = 'cancelled' ตรง ๆ ซึ่งไม่บังคับเหตุผล ไม่แจ้งเตือน
   *  นักศึกษา ไม่ถามว่าจะทำอย่างไรกับระเบียนที่มีคนเช็คชื่อไปแล้ว และไม่นัดชดเชย */
  const cancel = (row: ScheduledSession) => {
    setCancelTarget({ id: row.id, label: fmt(row.scheduled_start) });
  };

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">ตั้งเวลาคาบเรียนล่วงหน้า</span>
          {rows.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary">
              {rows.length}
            </span>
          )}
        </div>
        <Plus className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border p-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            เลือกวันและเวลาเองได้ ใช้ได้ทั้งคาบตามตารางและคาบชดเชย — พอถึงเวลาระบบจะเปิดให้สแกนเอง
            และปิดคาบอัตโนมัติเมื่อหมดเวลา
          </p>

          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">วันที่</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-2 py-2 rounded-lg border border-border bg-background text-sm" />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">เริ่ม</span>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="w-full px-2 py-2 rounded-lg border border-border bg-background text-sm" />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">สิ้นสุด</span>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full px-2 py-2 rounded-lg border border-border bg-background text-sm" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 text-xs space-y-1">
              <span className="text-muted-foreground">ชื่อคาบ (ไม่บังคับ)</span>
              <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80}
                placeholder="เช่น คาบชดเชย สัปดาห์ที่ 5"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-muted-foreground">สายหลัง (นาที)</span>
              <input type="number" min={1} max={120} value={lateAfter}
                onChange={e => setLateAfter(Math.max(1, Number(e.target.value) || 15))}
                className="w-full px-2 py-2 rounded-lg border border-border bg-background text-sm" />
            </label>
          </div>

          <button onClick={create} disabled={saving || !courseId}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
            ตั้งเวลาคาบ{courseCode ? ` ${courseCode}` : ''}
          </button>

          {rows.length > 0 && (
            <div className="pt-1 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                คาบที่ตั้งไว้
              </p>
              {rows.map(r => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {r.title || 'คาบเรียน'}
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        r.status === 'open' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                      }`}>
                        {r.status === 'open' ? 'กำลังเปิด' : 'รอถึงเวลา'}
                      </span>
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {fmt(r.scheduled_start)} – {r.scheduled_end
                        ? new Date(r.scheduled_end).toLocaleTimeString('th-TH', { timeStyle: 'short' })
                        : '-'}
                    </p>
                  </div>
                  <button onClick={() => cancel(r)} className="shrink-0 p-1.5 rounded-lg hover:bg-destructive/10">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CancelSessionDialog
        open={!!cancelTarget}
        sessionId={cancelTarget?.id ?? null}
        sessionLabel={cancelTarget?.label}
        onClose={() => setCancelTarget(null)}
        onDone={load}
      />
    </div>
  );
}
