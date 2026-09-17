import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { logAudit } from '@/lib/audit-log';
import { fetchEnrolledCourses } from '@/lib/attendance-data';
import {
  ALLOWED_EXTENSIONS, MAX_FILE_SIZE, fetchMyLeaves, findSessionForDate, fmtDate,
  formatFileSize, getAttachmentUrl, leaveStatusClass, leaveStatusLabels, leaveTypeLabels,
  uploadLeaveAttachment, type LeaveRequestRow, type LeaveType,
} from '@/lib/leave-data';
import { supabase } from '@/integrations/supabase/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusCircle, Calendar, Clock, CheckCircle, XCircle, Paperclip, X, FileText, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const statusIcon = { pending: Clock, approved: CheckCircle, rejected: XCircle } as const;

interface CourseOpt { id: string; code: string; name: string }

const StudentLeavePage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('sick');
  const [reason, setReason] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [cs, ls] = await Promise.all([fetchEnrolledCourses(user.id), fetchMyLeaves(user.id)]);
    setCourses(cs.map((c: { id: string; code: string; name: string }) => ({ id: c.id, code: c.code, name: c.name })));
    setLeaves(ls);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('my-leaves')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests', filter: `student_id=eq.${user.id}` },
        () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast.error(`รองรับเฉพาะไฟล์ ${ALLOWED_EXTENSIONS.join(', ')}`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    setAttachedFile(file);
  };

  const resetForm = () => {
    setSelectedCourse(''); setLeaveDate(''); setLeaveType('sick'); setReason(''); setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!selectedCourse || !leaveDate || !reason.trim()) {
      toast.error('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    setSaving(true);
    try {
      let path: string | null = null;
      if (attachedFile) {
        path = await uploadLeaveAttachment(user.id, attachedFile);
        if (!path) { toast.error('อัปโหลดไฟล์แนบไม่สำเร็จ'); setSaving(false); return; }
      }
      const sessionId = await findSessionForDate(selectedCourse, leaveDate);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('leave_requests').insert({
        student_id: user.id,
        course_id: selectedCourse,
        session_id: sessionId,
        leave_type: leaveType,
        leave_date: leaveDate,
        reason: reason.trim(),
        attachment_path: path,
      });
      if (error) throw error;

      const course = courses.find(c => c.id === selectedCourse);
      await logAudit({
        action: 'leave.submit', target: 'leave', targetId: selectedCourse,
        detail: `ยื่นใบลา ${leaveDate} (${course?.code ?? ''})`,
        after: { leaveType, leaveDate },
      });
      toast.success('ส่งใบลาเรียบร้อย รออาจารย์อนุมัติ');
      resetForm();
      setShowForm(false);
      load();
    } catch (e) {
      console.error(e);
      toast.error('ส่งใบลาไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (leave: LeaveRequestRow) => {
    if (!window.confirm('ยกเลิกใบลานี้?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('leave_requests').delete().eq('id', leave.id);
    if (error) { toast.error('ยกเลิกไม่สำเร็จ'); return; }
    toast.success('ยกเลิกใบลาแล้ว');
    setLeaves(prev => prev.filter(l => l.id !== leave.id));
  };

  const openAttachment = async (path: string) => {
    const url = await getAttachmentUrl(path);
    if (url) window.open(url, '_blank');
    else toast.error('เปิดไฟล์แนบไม่สำเร็จ');
  };

  return (
    <MobileLayout title="ใบลา">
      <div className="px-4 py-4 space-y-4">
        <button
          onClick={() => setShowForm(v => !v)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl gradient-primary text-primary-foreground text-sm font-semibold shadow-elevated"
        >
          <PlusCircle className="w-4 h-4" /> {showForm ? 'ปิดฟอร์ม' : 'ยื่นใบลาใหม่'}
        </button>

        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-card rounded-2xl p-5 shadow-elevated space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">รายวิชา</label>
                  <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}
                    className="w-full mt-1 px-3 py-2.5 rounded-xl bg-muted text-sm text-foreground outline-none">
                    <option value="">-- เลือกรายวิชา --</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                  </select>
                  {courses.length === 0 && !loading && (
                    <p className="text-[11px] text-muted-foreground mt-1">ยังไม่มีรายวิชาที่ลงทะเบียน</p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">ประเภทการลา</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {(Object.keys(leaveTypeLabels) as LeaveType[]).map(t => (
                      <button key={t} onClick={() => setLeaveType(t)}
                        className={`py-2 rounded-xl text-xs font-medium transition-all ${
                          leaveType === t ? 'gradient-primary text-primary-foreground shadow-card' : 'bg-muted text-muted-foreground'
                        }`}>{leaveTypeLabels[t]}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">วันที่ลา</label>
                  <input type="date" value={leaveDate} onChange={e => setLeaveDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2.5 rounded-xl bg-muted text-sm text-foreground outline-none" />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">เหตุผล</label>
                  <textarea value={reason} onChange={e => setReason(e.target.value.slice(0, 1000))} rows={3}
                    placeholder="ระบุเหตุผลการลา"
                    className="w-full mt-1 px-3 py-2.5 rounded-xl bg-muted text-sm text-foreground outline-none resize-none" />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">ไฟล์หลักฐาน (ถ้ามี)</label>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange}
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                  {attachedFile ? (
                    <div className="mt-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted">
                      <FileText className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">{attachedFile.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatFileSize(attachedFile.size)}</p>
                      </div>
                      <button onClick={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => fileInputRef.current?.click()}
                      className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-muted text-xs text-muted-foreground">
                      <Paperclip className="w-4 h-4" /> แนบไฟล์ (ใบรับรองแพทย์ ฯลฯ)
                    </button>
                  )}
                </div>

                <button onClick={handleSubmit} disabled={saving}
                  className="w-full py-3 rounded-xl gradient-primary text-primary-foreground text-sm font-semibold shadow-elevated disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} ส่งใบลา
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
        {!loading && leaves.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีใบลา</div>
        )}

        {leaves.map((l, i) => {
          const Icon = statusIcon[l.status];
          return (
            <motion.div key={l.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="bg-card rounded-2xl p-4 shadow-card space-y-2">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{l.courseCode} <span className="font-normal text-muted-foreground">{l.courseName}</span></p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3.5 h-3.5" /> {fmtDate(l.leave_date)} · {leaveTypeLabels[l.leave_type]}
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
                <p className="text-[11px] text-muted-foreground bg-muted rounded-lg px-2.5 py-1.5">
                  หมายเหตุจากอาจารย์: {l.review_note}
                </p>
              )}

              {l.status === 'pending' && (
                <button onClick={() => handleCancel(l)}
                  className="inline-flex items-center gap-1.5 text-[11px] text-destructive font-medium">
                  <Trash2 className="w-3 h-3" /> ยกเลิกใบลา
                </button>
              )}
            </motion.div>
          );
        })}
      </div>
    </MobileLayout>
  );
};

export default StudentLeavePage;
