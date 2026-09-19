import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import {
  fetchAssignments, fetchAssignmentSubmissions, fmtDateTime, formatFileSize,
  getSubmissionFileUrl, uploadAssignmentAttachment, ALLOWED_EXTENSIONS, MAX_FILE_SIZE,
  type AssignmentRow,
} from '@/lib/assignment-data';
import { supabase } from '@/integrations/supabase/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, FileText, Calendar, Users, Trash2, Loader2, X, Paperclip } from 'lucide-react';
import { toast } from 'sonner';

interface Course { id: string; code: string; name: string }

const AssignmentManagementPage = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', due_at: '', max_score: '100' });
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    fetchInstructorCourses(user.id).then((cs) => {
      setCourses(cs as Course[]);
      setSelectedCourse(prev => prev || (cs as Course[])[0]?.id || '');
      if (cs.length === 0) setLoading(false);
    });
  }, [user]);

  const load = useCallback(async () => {
    if (!selectedCourse) return;
    setLoading(true);
    const as = await fetchAssignments([selectedCourse]);
    setAssignments(as);
    const entries = await Promise.all(as.map(async a => [a.id, (await fetchAssignmentSubmissions(a.id)).length] as const));
    setCounts(Object.fromEntries(entries));
    setLoading(false);
  }, [selectedCourse]);

  useEffect(() => { load(); }, [load]);

  const onPickAttachment = (file: File | null) => {
    if (!file) { setAttachment(null); return; }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast.error(`ไฟล์นามสกุล .${ext} ไม่รองรับ`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`ไฟล์ใหญ่เกินไป (สูงสุด ${formatFileSize(MAX_FILE_SIZE)})`);
      return;
    }
    setAttachment(file);
  };

  const create = async () => {
    if (!user || !selectedCourse) return;
    const title = form.title.trim();
    if (!title) { toast.error('กรุณากรอกชื่องาน'); return; }
    const max = Number(form.max_score);
    if (!Number.isFinite(max) || max <= 0 || max > 1000) { toast.error('คะแนนเต็มไม่ถูกต้อง'); return; }
    setSaving(true);
    try {
      let attachment_path: string | null = null;
      let attachment_name: string | null = null;
      if (attachment) {
        attachment_path = await uploadAssignmentAttachment(user.id, attachment);
        if (!attachment_path) throw new Error('อัปโหลดไฟล์แนบไม่สำเร็จ');
        attachment_name = attachment.name;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('assignments').insert({
        course_id: selectedCourse,
        title: title.slice(0, 200),
        description: form.description.trim().slice(0, 2000) || null,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        max_score: max,
        created_by: user.id,
        attachment_path,
        attachment_name,
      });
      if (error) throw error;
      toast.success('สร้างงานเรียบร้อย');
      setForm({ title: '', description: '', due_at: '', max_score: '100' });
      setAttachment(null);
      setShowForm(false);
      load();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'สร้างงานไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const openAttachment = async (path: string) => {
    const url = await getSubmissionFileUrl(path);
    if (url) window.open(url, '_blank'); else toast.error('เปิดไฟล์ไม่สำเร็จ');
  };

  const remove = async (id: string) => {
    if (!confirm('ลบงานนี้และผลการส่งทั้งหมด?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('assignments').delete().eq('id', id);
    if (error) { toast.error('ลบไม่สำเร็จ'); return; }
    toast.success('ลบงานแล้ว');
    load();
  };

  return (
    <MobileLayout title="จัดการงาน">
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
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีรายวิชาที่สอน</div>
        )}

        {selectedCourse && (
          <button onClick={() => setShowForm(v => !v)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold shadow-elevated">
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm ? 'ยกเลิก' : 'สร้างงานใหม่'}
          </button>
        )}

        {showForm && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl p-4 shadow-card space-y-2">
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="ชื่องาน"
              className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
            <textarea value={form.description} rows={3} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="รายละเอียดงาน" className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none resize-none" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">กำหนดส่ง</label>
                <input type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">คะแนนเต็ม</label>
                <input type="number" min={1} max={1000} value={form.max_score} onChange={e => setForm({ ...form, max_score: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">ไฟล์แนบ (ไม่บังคับ)</label>
              <input ref={fileInputRef} type="file" className="hidden"
                onChange={e => onPickAttachment(e.target.files?.[0] ?? null)} />
              {attachment ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted text-xs">
                  <Paperclip className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="flex-1 truncate text-foreground">{attachment.name}</span>
                  <span className="text-muted-foreground shrink-0">{formatFileSize(attachment.size)}</span>
                  <button onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="shrink-0 text-muted-foreground hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary">
                  <Paperclip className="w-3.5 h-3.5" /> แนบไฟล์โจทย์/เอกสารประกอบ
                </button>
              )}
            </div>
            <button onClick={create} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} บันทึกงาน
            </button>
          </motion.div>
        )}

        {loading && <p className="text-center text-sm text-muted-foreground py-8">กำลังโหลด...</p>}
        {!loading && selectedCourse && assignments.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">ยังไม่มีงานในรายวิชานี้</div>
        )}

        {assignments.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            className="bg-card rounded-2xl p-4 shadow-card">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{a.title}</p>
                {a.description && <p className="text-[11px] text-muted-foreground line-clamp-2">{a.description}</p>}
                <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtDateTime(a.due_at)}</span>
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" /> ส่งแล้ว {counts[a.id] ?? 0} คน</span>
                  <span>เต็ม {a.max_score}</span>
                  {a.attachment_path && (
                    <button onClick={() => openAttachment(a.attachment_path!)}
                      className="flex items-center gap-1 text-primary font-medium">
                      <Paperclip className="w-3 h-3" /> {a.attachment_name ?? 'ไฟล์แนบ'}
                    </button>
                  )}
                </div>
              </div>
              <button onClick={() => remove(a.id)} className="shrink-0 p-2 rounded-xl bg-destructive/10">
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </MobileLayout>
  );
};

export default AssignmentManagementPage;
