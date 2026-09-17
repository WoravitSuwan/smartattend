import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { logAudit } from '@/lib/audit-log';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import {
  fetchInstructorLeaves, fmtDate, getAttachmentUrl, leaveStatusClass, leaveStatusLabels,
  leaveTypeLabels, type LeaveRequestRow, type LeaveStatus,
} from '@/lib/leave-data';
import { supabase } from '@/integrations/supabase/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, CheckCircle, XCircle, Clock, User, Filter, Paperclip } from 'lucide-react';
import { toast } from 'sonner';

const statusIcon = { pending: Clock, approved: CheckCircle, rejected: XCircle } as const;
const FILTERS: { key: 'all' | LeaveStatus; label: string }[] = [
  { key: 'pending', label: 'รออนุมัติ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'rejected', label: 'ไม่อนุมัติ' },
  { key: 'all', label: 'ทั้งหมด' },
];

const InstructorLeavesPage = () => {
  const { user } = useAuth();
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | LeaveStatus>('pending');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<'approved' | 'rejected'>('approved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const cs = await fetchInstructorCourses(user.id);
    const ids = cs.map(c => c.id);
    setCourseIds(ids);
    setLeaves(await fetchInstructorLeaves(ids));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (courseIds.length === 0) return;
    const channel = supabase
      .channel('instructor-leaves')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [courseIds, load]);

  const filtered = useMemo(
    () => (filter === 'all' ? leaves : leaves.filter(l => l.status === filter)),
    [leaves, filter],
  );
  const pendingCount = useMemo(() => leaves.filter(l => l.status === 'pending').length, [leaves]);

  const submitReview = async () => {
    if (!reviewId || !user) return;
    if (reviewMode === 'rejected' && !note.trim()) {
      toast.error('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
      return;
    }
    setBusy(true);
    const leave = leaves.find(l => l.id === reviewId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('leave_requests')
      .update({
        status: reviewMode,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: note.trim() || null,
      })
      .eq('id', reviewId);
    setBusy(false);
    if (error) { console.error(error); toast.error('บันทึกผลไม่สำเร็จ'); return; }

    await logAudit({
      action: reviewMode === 'approved' ? 'leave.approve' : 'leave.reject',
      target: 'leave', targetId: reviewId,
      detail: `${reviewMode === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}ใบลา ${leave?.leave_date ?? ''} (${leave?.courseCode ?? ''})`,
      before: { status: 'pending' }, after: { status: reviewMode }, reason: note.trim() || undefined,
    });

    toast.success(reviewMode === 'approved' ? 'อนุมัติใบลาเรียบร้อย' : 'บันทึกการไม่อนุมัติแล้ว');
    setReviewId(null); setNote('');
    load();
  };

  const openAttachment = async (path: string) => {
    const url = await getAttachmentUrl(path);
    if (url) window.open(url, '_blank');
    else toast.error('เปิดไฟล์แนบไม่สำเร็จ');
  };

  return (
    <MobileLayout title="ใบลานักศึกษา">
      <div className="px-4 py-4 space-y-4">
        <div className="bg-card rounded-2xl p-4 shadow-card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-warning/15 flex items-center justify-center">
            <Clock className="w-5 h-5 text-warning" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">ใบลารออนุมัติ</p>
            <p className="text-xl font-bold font-display text-foreground">{pendingCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
                filter === f.key ? 'gradient-primary text-primary-foreground shadow-card' : 'bg-card text-muted-foreground shadow-card'
              }`}>{f.label}</button>
          ))}
        </div>

        {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ไม่มีใบลาในหมวดนี้</div>
        )}

        {filtered.map((l, i) => {
          const Icon = statusIcon[l.status];
          return (
            <motion.div key={l.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="bg-card rounded-2xl p-4 shadow-card space-y-2">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-muted-foreground" /> {l.studentName}
                    {l.studentCode && <span className="text-[10px] text-muted-foreground">{l.studentCode}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{l.courseCode} · {leaveTypeLabels[l.leave_type]}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3.5 h-3.5" /> {fmtDate(l.leave_date)}
                  </p>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${leaveStatusClass[l.status]}`}>
                  <Icon className="w-3 h-3" /> {leaveStatusLabels[l.status]}
                </span>
              </div>

              <p className="text-xs text-foreground/80">{l.reason}</p>

              {l.attachment_path && (
                <button onClick={() => openAttachment(l.attachment_path!)}
                  className="inline-flex items-center gap-1.5 text-[11px] text-primary font-medium">
                  <Paperclip className="w-3 h-3" /> ดูไฟล์แนบ
                </button>
              )}

              {l.status !== 'pending' && l.review_note && (
                <p className="text-[11px] text-muted-foreground bg-muted rounded-lg px-2.5 py-1.5">หมายเหตุ: {l.review_note}</p>
              )}

              {l.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => { setReviewId(l.id); setReviewMode('approved'); setNote(''); }}
                    className="flex-1 py-2 rounded-xl bg-success/15 text-success text-xs font-semibold">อนุมัติ</button>
                  <button onClick={() => { setReviewId(l.id); setReviewMode('rejected'); setNote(''); }}
                    className="flex-1 py-2 rounded-xl bg-destructive/15 text-destructive text-xs font-semibold">ไม่อนุมัติ</button>
                </div>
              )}

              {reviewId === l.id && (
                <div className="space-y-2 pt-1">
                  <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 500))} rows={2}
                    placeholder={reviewMode === 'approved' ? 'หมายเหตุ (ไม่บังคับ)' : 'เหตุผลที่ไม่อนุมัติ (จำเป็น)'}
                    className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none resize-none" />
                  <div className="flex gap-2">
                    <button onClick={submitReview} disabled={busy}
                      className="flex-1 py-2 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
                      ยืนยัน{reviewMode === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}
                    </button>
                    <button onClick={() => { setReviewId(null); setNote(''); }}
                      className="px-4 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-medium">ยกเลิก</button>
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </MobileLayout>
  );
};

export default InstructorLeavesPage;
