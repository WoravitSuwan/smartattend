import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';
import { cancelClassSession } from '@/lib/attendance-score-data';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  sessionId: string | null;
  /** ข้อความบอกว่าเป็นคาบไหน ใช้แสดงในหัวข้อ */
  sessionLabel?: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * ยกเลิกคาบเรียน — ต้องทำสามอย่างตามสเปกข้อ 3.3
 *   1. บังคับระบุเหตุผล
 *   2. แจ้งเตือนนักศึกษาทุกคนในรายวิชา (ทำในฐานข้อมูล)
 *   3. ถามว่าจะนัดชดเชยเมื่อไร ถ้าเลือกนัดจะสร้างคาบใหม่ผูกกับคาบที่ยกเลิก
 *
 * และถ้ามีคนเช็คชื่อไปแล้ว ต้องถามว่าจะทำอย่างไรกับระเบียนที่มีอยู่
 *   เก็บไว้เป็นหลักฐานแต่ไม่นับคะแนน (สอนไปแล้วบางส่วน)
 *   ลบทั้งหมด (เปิดคาบผิด)
 *
 * ไม่บันทึกขาดเรียนอัตโนมัติเมื่อยกเลิก การบันทึกขาดทำเฉพาะตอนปิดคาบตามปกติ
 */
const CancelSessionDialog = ({ open, sessionId, sessionLabel, onClose, onDone }: Props) => {
  const [reason, setReason] = useState('');
  const [records, setRecords] = useState<'keep' | 'delete'>('keep');
  const [makeup, setMakeup] = useState('');
  const [makeupEnd, setMakeupEnd] = useState('');
  const [existing, setExisting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return;
    setReason(''); setRecords('keep'); setMakeup(''); setMakeupEnd('');
    setExisting(null);
    // จำนวนระเบียนที่มีอยู่ เพื่อถามเฉพาะเมื่อมีจริง
    supabase.from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .neq('status', 'absent')
      .then(({ count }) => setExisting(count ?? 0));
  }, [open, sessionId]);

  const submit = async () => {
    if (!sessionId) return;
    if (!reason.trim()) { toast.error('ต้องระบุเหตุผลในการยกเลิกคาบ'); return; }
    if (makeup && makeupEnd && new Date(makeupEnd) <= new Date(makeup)) {
      toast.error('เวลาสิ้นสุดของคาบชดเชยต้องหลังเวลาเริ่ม'); return;
    }
    setBusy(true);
    const { data, error } = await cancelClassSession({
      sessionId, reason: reason.trim(), records,
      makeupStart: makeup ? new Date(makeup).toISOString() : null,
      makeupEnd: makeupEnd ? new Date(makeupEnd).toISOString() : null,
    });
    setBusy(false);
    if (error) { toast.error(error.message || 'ยกเลิกคาบไม่สำเร็จ'); return; }
    const r = data as { removed_records?: number; notified?: number; makeup_session_id?: string } | null;
    toast.success(
      `ยกเลิกคาบแล้ว · แจ้งเตือนนักศึกษา ${r?.notified ?? 0} คน`
      + (records === 'delete' ? ` · ลบระเบียน ${r?.removed_records ?? 0} รายการ` : '')
      + (r?.makeup_session_id ? ' · สร้างคาบชดเชยแล้ว' : ''),
    );
    onClose();
    onDone();
  };

  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <AlertDialogContent className="max-w-sm rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-display">
            ยกเลิกคาบเรียน{sessionLabel ? ` ${sessionLabel}` : ''}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-xs text-muted-foreground leading-relaxed">
              คาบที่ยกเลิกจะไม่ถูกนับในคะแนนการเข้าเรียนของทุกคน ทั้งตัวตั้งและตัวหาร
              และนักศึกษาทุกคนจะได้รับการแจ้งเตือน
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2.5">
          <div>
            <label className="text-[11px] font-medium text-foreground">เหตุผล (จำเป็น)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} autoFocus
              placeholder="เช่น อาจารย์ไปราชการ / มหาวิทยาลัยประกาศหยุด"
              className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none resize-none" />
          </div>

          {existing != null && existing > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-destructive">
                มีนักศึกษาเช็คชื่อในคาบนี้ไปแล้ว {existing} คน — จะทำอย่างไรกับระเบียนเหล่านั้น
              </p>
              {([
                ['keep', 'เก็บไว้เป็นหลักฐาน แต่ไม่นับคะแนน', 'ใช้เมื่อสอนไปแล้วบางส่วนแล้วต้องยกเลิกกลางคาบ'],
                ['delete', 'ลบระเบียนทั้งหมด', 'ใช้เมื่อเปิดคาบผิดวันหรือผิดวิชา'],
              ] as const).map(([v, label, help]) => (
                <label key={v} className={`block rounded-xl border p-2 cursor-pointer ${
                  records === v ? 'border-primary bg-primary/5' : 'border-border'
                }`}>
                  <span className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                    <input type="radio" checked={records === v} onChange={() => setRecords(v)} />
                    {label}
                  </span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5 ml-5">{help}</span>
                </label>
              ))}
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-foreground">นัดชดเชย (ไม่บังคับ)</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <input type="datetime-local" value={makeup} onChange={e => setMakeup(e.target.value)}
                className="px-2 py-2 rounded-xl bg-muted text-[11px] text-foreground outline-none" />
              <input type="datetime-local" value={makeupEnd} onChange={e => setMakeupEnd(e.target.value)}
                disabled={!makeup}
                className="px-2 py-2 rounded-xl bg-muted text-[11px] text-foreground outline-none disabled:opacity-50" />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              ถ้าระบุ ระบบจะสร้างคาบใหม่ที่ผูกกลับกับคาบนี้ และแจ้งวันชดเชยให้นักศึกษาด้วย
            </p>
          </div>
        </div>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <button onClick={submit} disabled={busy || !reason.trim()}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-xs font-semibold disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            ยืนยันยกเลิกคาบเรียน
          </button>
          <button onClick={onClose} disabled={busy}
            className="w-full py-2.5 rounded-xl bg-muted text-xs font-semibold text-foreground disabled:opacity-50">
            ไม่ยกเลิก
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CancelSessionDialog;
