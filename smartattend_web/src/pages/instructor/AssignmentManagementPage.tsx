import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { fetchInstructorCourses } from '@/lib/attendance-data';
import {
  fetchAssignments, fetchAssignmentSubmissions, fmtDateTime, formatFileSize,
  getSubmissionFileUrl, uploadAssignmentAttachment, ALLOWED_EXTENSIONS, MAX_FILE_SIZE,
  type AssignmentRow,
} from '@/lib/assignment-data';
import { supabase } from '@/integrations/supabase/client';
import { calcModeLabels, fetchComponents } from '@/lib/grade-structure-data';
import type { GradeComponent } from '@/lib/grade-structure';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Plus, FileText, Calendar, Users, Trash2, Loader2, X, Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';

interface Course { id: string; code: string; name: string }

/** หน้าจัดการงาน — ถ้าส่ง embeddedCourseId มา จะทำงานเป็นส่วนหนึ่งของหน้า
 *  รายละเอียดรายวิชา (ล็อกวิชาไว้ ไม่ต้องมีแถบเลือกวิชา และไม่ครอบ layout ซ้ำ) */
const AssignmentManagementPage = ({ embeddedCourseId }: { embeddedCourseId?: string } = {}) => {
  const { user } = useAuth();
  const embedded = !!embeddedCourseId;
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState(embeddedCourseId ?? '');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', due_at: '', max_score: '100',
    component_id: '', counts_toward_grade: true,
    late_penalty_per_day: '', late_penalty_max: '',
  });
  /** หมวดคะแนนของรายวิชา สำหรับผูกงานเข้ากับรายการคะแนนอัตโนมัติ */
  const [components, setComponents] = useState<GradeComponent[]>([]);
  /** แยกจาก components.length === 0 เพราะ "ยังโหลดไม่เสร็จ" กับ "ไม่มีหมวดจริง"
   *  ต้องแสดงคนละอย่าง ไม่งั้นจะขึ้นคำเตือนวาบหนึ่งทุกครั้งที่เปิดฟอร์ม */
  const [loadingComponents, setLoadingComponents] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user || embedded) return;
    fetchInstructorCourses(user.id).then((cs) => {
      setCourses(cs as Course[]);
      setSelectedCourse(prev => prev || (cs as Course[])[0]?.id || '');
      if (cs.length === 0) setLoading(false);
    });
  }, [user, embedded]);

  useEffect(() => {
    if (embeddedCourseId) setSelectedCourse(embeddedCourseId);
  }, [embeddedCourseId]);

  useEffect(() => {
    if (!selectedCourse) { setComponents([]); setLoadingComponents(false); return; }
    let cancelled = false;
    setLoadingComponents(true);
    fetchComponents(selectedCourse).then(cs => {
      if (cancelled) return;
      setComponents(cs);
      setLoadingComponents(false);
      // เลือกหมวดที่เหมาะกับงานให้เป็นค่าเริ่มต้น เพื่อไม่ให้อาจารย์ลืมผูก
      // แล้วคะแนนไม่เข้าตารางคะแนน (หมวด weighted_items สร้างรายการอัตโนมัติ
      // ไม่ได้ เพราะระบบกำหนดน้ำหนักย่อยให้เองไม่ได้)
      const preferred = cs.find(c => c.calc_mode === 'proportional'
        && ['assignment', 'lab', 'quiz'].includes(c.kind))
        ?? cs.find(c => c.calc_mode === 'proportional');
      setForm(f => (f.component_id ? f : { ...f, component_id: preferred?.id ?? '' }));
    });
    return () => { cancelled = true; };
  }, [selectedCourse]);

  /** พาไปหน้าตั้งโครงสร้างคะแนนของวิชาที่กำลังเลือกอยู่
   *  ใช้ ?tab=grades เพื่อให้เปิดมาที่แท็บคะแนนเลย ไม่ต้องให้อาจารย์หาต่อเอง */
  const goToGradeStructure = () =>
    navigate(`/instructor/courses/${selectedCourse}?tab=grades`);

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
      const perDay = form.late_penalty_per_day.trim();
      const maxPen = form.late_penalty_max.trim();
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
        // ผูกกับหมวดคะแนน -> trigger สร้างรายการคะแนนให้อัตโนมัติ
        component_id: form.counts_toward_grade && form.component_id ? form.component_id : null,
        counts_toward_grade: form.counts_toward_grade,
        // ว่างไว้ = ใช้กฎหักคะแนนของหมวด
        late_penalty_per_day: perDay === '' ? null : Number(perDay),
        late_penalty_max: maxPen === '' ? null : Number(maxPen),
      });
      if (error) throw error;
      toast.success('สร้างงานเรียบร้อย');
      setForm(f => ({
        title: '', description: '', due_at: '', max_score: '100',
        component_id: f.component_id, counts_toward_grade: true,
        late_penalty_per_day: '', late_penalty_max: '',
      }));
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

  const body = (
      <div className={embedded ? 'space-y-4' : 'px-4 py-4 space-y-4'}>
        {!embedded && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {courses.map(c => (
              <button key={c.id} onClick={() => setSelectedCourse(c.id)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                  selectedCourse === c.id ? 'gradient-primary text-primary-foreground shadow-elevated' : 'bg-card text-muted-foreground shadow-card'
                }`}>{c.code}</button>
            ))}
          </div>
        )}

        {!embedded && courses.length === 0 && !loading && (
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
            {/* ── ผูกกับคะแนน: โพสต์งานแล้วรายการคะแนนถูกสร้างให้อัตโนมัติ ── */}
            <div className="rounded-xl border border-border p-2.5 space-y-2">
              <label className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                <input type="checkbox" checked={form.counts_toward_grade}
                  onChange={e => setForm({ ...form, counts_toward_grade: e.target.checked })} />
                นับเป็นคะแนนของรายวิชา
              </label>

              {/* ช่องเลือกหมวดต้องเห็นเสมอเมื่อสวิตช์เปิด และเมื่อรายวิชายังไม่มีหมวด
                  ต้องบอกทางไปตั้งโครงสร้าง ไม่ใช่ซ่อนช่องไปเฉย ๆ จนอาจารย์ไม่รู้ว่า
                  ต้องทำอะไรก่อน */}
              {form.counts_toward_grade && (
                <>
                  <div>
                    <label className="text-[10px] text-muted-foreground">หมวดคะแนนที่งานนี้เข้า</label>
                    {loadingComponents ? (
                      <p className="text-[11px] text-muted-foreground py-2">กำลังโหลดหมวดคะแนน...</p>
                    ) : components.length === 0 ? (
                      <div className="mt-1 rounded-xl border border-warning/40 bg-warning/10 p-2.5 space-y-1.5">
                        <p className="text-[11px] font-semibold text-warning">
                          ยังไม่ได้ตั้งโครงสร้างคะแนนของรายวิชานี้
                        </p>
                        <p className="text-[10px] text-foreground leading-relaxed">
                          ต้องสร้างหมวดคะแนนก่อน งานนี้จึงจะผูกเข้าหมวดได้ ถ้าโพสต์งานตอนนี้
                          คะแนนที่ตรวจจะไม่เข้าตารางคะแนนให้เอง ต้องไปกรอกเองในหน้าคะแนน
                        </p>
                        <button type="button" onClick={goToGradeStructure}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                          ไปตั้งโครงสร้างคะแนน <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <select value={form.component_id}
                        onChange={e => setForm({ ...form, component_id: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none">
                        <option value="">— ไม่ผูกกับหมวด (ต้องกรอกคะแนนเองในหน้าคะแนน) —</option>
                        {components.map(c => (
                          <option key={c.id} value={c.id}
                            disabled={c.calc_mode === 'weighted_items'}>
                            {c.name} ({c.weight_percent}% · {calcModeLabels[c.calc_mode]})
                            {c.calc_mode === 'weighted_items' ? ' — ต้องสร้างรายการเอง' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {components.length > 0 && !form.component_id && (
                      <p className="text-[10px] text-warning mt-1">
                        ยังไม่ได้เลือกหมวด — คะแนนที่ตรวจจะไม่เข้าตารางคะแนนให้เอง
                      </p>
                    )}
                    {form.component_id && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        ตรวจงานแล้วคะแนนจะเข้าตารางคะแนนทันที ไม่ต้องกรอกซ้ำ
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">หักช้า %/วัน</label>
                      <input type="number" min={0} max={100} step="any"
                        value={form.late_penalty_per_day}
                        onChange={e => setForm({ ...form, late_penalty_per_day: e.target.value })}
                        placeholder="ตามหมวด"
                        className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">หักได้สูงสุด %</label>
                      <input type="number" min={0} max={100} step="any"
                        value={form.late_penalty_max}
                        onChange={e => setForm({ ...form, late_penalty_max: e.target.value })}
                        placeholder="ตามหมวด"
                        className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    เว้นว่างไว้ = ใช้กฎของหมวดคะแนน · นับวันช้าจากกำหนดส่งเทียบกับเวลาที่ส่งจริง
                    ด้วยเวลาของเซิร์ฟเวอร์ ส่งช้าเกินกำหนดแม้นาทีเดียวนับเป็น 1 วัน
                  </p>
                </>
              )}
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
                      className="flex items-center gap-1 text-primary font-medium max-w-full">
                      <Paperclip className="w-3 h-3 shrink-0" />
                      <span className="truncate">{a.attachment_name ?? 'ไฟล์แนบ'}</span>
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
  );

  if (embedded) return body;
  return <MobileLayout title="จัดการงาน">{body}</MobileLayout>;
};

export default AssignmentManagementPage;
