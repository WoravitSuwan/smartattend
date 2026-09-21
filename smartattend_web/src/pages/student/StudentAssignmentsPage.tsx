import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchEnrolledCourses } from '@/lib/attendance-data';
import {
  ALLOWED_EXTENSIONS, MAX_FILE_SIZE, fetchAssignments, fetchMySubmissions, fmtDateTime,
  formatFileSize, getSubmissionFileUrl, uploadSubmissionFile,
  type AssignmentRow, type SubmissionRow,
} from '@/lib/assignment-data';
import { supabase } from '@/integrations/supabase/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Upload, Calendar, CheckCircle, Clock, XCircle, Star, MessageSquare, Paperclip, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Course { id: string; code: string; name: string }

const statusChip = {
  not_submitted: { label: 'ยังไม่ส่ง', color: 'bg-muted text-muted-foreground', icon: XCircle },
  submitted: { label: 'รอตรวจ', color: 'bg-success/15 text-success', icon: Clock },
  late: { label: 'ส่งช้า', color: 'bg-warning/15 text-warning', icon: Clock },
  graded: { label: 'ตรวจแล้ว', color: 'bg-primary/15 text-primary', icon: CheckCircle },
} as const;

const StudentAssignmentsPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<Record<string, File>>({});
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchEnrolledCourses(user.id).then((cs) => {
      const list = (cs as Course[]).map(c => ({ id: c.id, code: c.code, name: c.name }));
      setCourses(list);
      setSelectedCourse(prev => prev || list[0]?.id || '');
      if (list.length === 0) setLoading(false);
    });
  }, [user]);

  const load = useCallback(async () => {
    if (!user || !selectedCourse) return;
    setLoading(true);
    const as = await fetchAssignments([selectedCourse]);
    setAssignments(as);
    setSubs(await fetchMySubmissions(user.id, as.map(a => a.id)));
    setLoading(false);
  }, [user, selectedCourse]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('my-submissions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignment_submissions', filter: `student_id=eq.${user.id}` },
        () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const subOf = useCallback((id: string) => subs.find(s => s.assignment_id === id), [subs]);

  const stats = useMemo(() => {
    const graded = subs.filter(s => s.status === 'graded').length;
    const pending = assignments.length - subs.length;
    return { total: assignments.length, submitted: subs.length, graded, pending: Math.max(0, pending) };
  }, [assignments, subs]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = activeRef.current;
    e.target.value = '';
    activeRef.current = null;
    if (!file || !id) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) { toast.error(`ไฟล์ไม่รองรับ (${ext})`); return; }
    if (file.size > MAX_FILE_SIZE) { toast.error('ไฟล์ใหญ่เกิน 20MB'); return; }
    setPickedFile(prev => ({ ...prev, [id]: file }));
  };

  const submit = async (a: AssignmentRow) => {
    if (!user) return;
    const file = pickedFile[a.id];
    const text = (noteText[a.id] ?? '').trim();
    if (!file && !text) { toast.error('กรุณาแนบไฟล์หรือกรอกข้อความก่อนส่งงาน'); return; }
    setUploading(a.id);
    try {
      let path: string | null = null;
      if (file) {
        path = await uploadSubmissionFile(user.id, file);
        if (!path) { toast.error('อัปโหลดไฟล์ไม่สำเร็จ'); setUploading(null); return; }
      }
      const isLate = a.due_at ? new Date() > new Date(a.due_at) : false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('assignment_submissions').upsert({
        assignment_id: a.id, student_id: user.id, content: text || null,
        file_path: path, submitted_at: new Date().toISOString(),
        status: isLate ? 'late' : 'submitted',
      }, { onConflict: 'assignment_id,student_id' });
      if (error) throw error;
      toast.success(isLate ? 'ส่งงานแล้ว (ส่งช้ากว่ากำหนด)' : 'ส่งงานเรียบร้อย');
      setPickedFile(prev => { const n = { ...prev }; delete n[a.id]; return n; });
      setNoteText(prev => ({ ...prev, [a.id]: '' }));
      load();
    } catch (e) {
      console.error(e);
      toast.error('ส่งงานไม่สำเร็จ');
    } finally {
      setUploading(null);
    }
  };

  const openFile = async (path: string) => {
    const url = await getSubmissionFileUrl(path);
    if (url) window.open(url, '_blank'); else toast.error('เปิดไฟล์ไม่สำเร็จ');
  };

  return (
    <MobileLayout title="งานที่ได้รับมอบหมาย">
      <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} />
      <div className="px-4 py-4 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {courses.map(c => (
            <button key={c.id} onClick={() => setSelectedCourse(c.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                selectedCourse === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'
              }`}>{c.code}</button>
          ))}
        </div>

        {courses.length === 0 && !loading && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีรายวิชาที่ลงทะเบียน</div>
        )}

        {assignments.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'ทั้งหมด', value: stats.total },
              { label: 'ส่งแล้ว', value: stats.submitted },
              { label: 'ตรวจแล้ว', value: stats.graded },
            ].map(s => (
              <div key={s.label} className="bg-card rounded-xl p-3 shadow-card text-center">
                <p className="text-lg font-bold font-display text-foreground">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
        {!loading && selectedCourse && assignments.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีงานในรายวิชานี้</div>
        )}

        {assignments.map((a, i) => {
          const sub = subOf(a.id);
          const key = (sub?.status ?? 'not_submitted') as keyof typeof statusChip;
          const chip = statusChip[key];
          const Icon = chip.icon;
          const open = expandedId === a.id;
          return (
            <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="bg-card rounded-2xl p-4 shadow-card space-y-2">
              <button className="w-full text-left" onClick={() => setExpandedId(open ? null : a.id)}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Calendar className="w-3 h-3" /> กำหนดส่ง {fmtDateTime(a.due_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${chip.color}`}>
                    <Icon className="w-3 h-3" /> {chip.label}
                  </span>
                </div>
              </button>

              {sub?.status === 'graded' && (
                <div className="rounded-xl bg-primary/5 p-3 space-y-1">
                  <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" /> {sub.score}/{a.max_score} คะแนน
                  </p>
                  {sub.feedback && (
                    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" /> {sub.feedback}
                    </p>
                  )}
                </div>
              )}

              <AnimatePresence>
                {open && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-2">
                    {a.description && <p className="text-xs text-foreground/80 pt-1">{a.description}</p>}
                    {a.attachment_path && (
                      <button onClick={() => openFile(a.attachment_path!)}
                        className="w-full max-w-full text-xs text-primary font-medium flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{a.attachment_name ?? 'ไฟล์แนบจากอาจารย์'}</span>
                      </button>
                    )}

                    {sub && (
                      <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="shrink-0">ส่งเมื่อ {fmtDateTime(sub.submitted_at)}</span>
                        {sub.file_path && (
                          <button onClick={() => openFile(sub.file_path!)} className="text-primary font-medium inline-flex items-center gap-1 shrink-0">
                            <Paperclip className="w-3 h-3" /> ดูไฟล์ที่ส่ง
                          </button>
                        )}
                      </div>
                    )}

                    {sub?.status !== 'graded' && (
                      <>
                        <textarea value={noteText[a.id] ?? ''} rows={2}
                          onChange={e => setNoteText(prev => ({ ...prev, [a.id]: e.target.value.slice(0, 2000) }))}
                          placeholder="ข้อความถึงอาจารย์ (ไม่บังคับ)"
                          className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none resize-none" />

                        {pickedFile[a.id] ? (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted">
                            <Paperclip className="w-3.5 h-3.5 text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-foreground truncate">{pickedFile[a.id].name}</p>
                              <p className="text-[10px] text-muted-foreground">{formatFileSize(pickedFile[a.id].size)}</p>
                            </div>
                            <button onClick={() => setPickedFile(prev => { const n = { ...prev }; delete n[a.id]; return n; })}>
                              <X className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { activeRef.current = a.id; fileInputRef.current?.click(); }}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-muted text-[11px] text-muted-foreground">
                            <Paperclip className="w-3.5 h-3.5" /> แนบไฟล์
                          </button>
                        )}

                        <button onClick={() => submit(a)} disabled={uploading === a.id}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold shadow-elevated disabled:opacity-50">
                          {uploading === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          {sub ? 'ส่งงานอีกครั้ง' : 'ส่งงาน'}
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </MobileLayout>
  );
};

export default StudentAssignmentsPage;
