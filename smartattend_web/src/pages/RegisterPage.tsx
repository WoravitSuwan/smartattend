import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, ChevronLeft, Eye, EyeOff, User, Mail, GraduationCap, Lock, ArrowRight, Upload, XCircle, Hourglass, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import rmutlCrest from '@/assets/rmutl-crest.png';
import { useViewMode } from '@/lib/view-mode-context';
import ViewModeToggle from '@/components/ViewModeToggle';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { upsertMyRegStatus } from '@/lib/registration-status';
import { augmentImage, normalizeOriginal } from '@/lib/dataset-store';
import { validateThaiFullName } from '@/lib/thai-name';

const AUGMENT_PER_POSE = 9; // 1 original + 9 augmented = 10 per pose → 50 total

/* ── 5 required face poses (file upload) ── */
interface PoseSlot {
  id: 'front' | 'up' | 'down' | 'left' | 'right';
  label: string;
  hint: string;
  icon: string;
}

const POSES: PoseSlot[] = [
  { id: 'front', label: 'หน้าตรง', hint: 'มองตรงไปที่กล้อง', icon: '😐' },
  { id: 'up',    label: 'เงยหน้า', hint: 'ค่อยๆ เงยหน้าขึ้น', icon: '🙄' },
  { id: 'down',  label: 'ก้มหน้า', hint: 'ค่อยๆ ก้มหน้าลง', icon: '😔' },
  { id: 'left',  label: 'หันซ้าย', hint: 'หันหน้าไปทางซ้าย', icon: '👈' },
  { id: 'right', label: 'หันขวา', hint: 'หันหน้าไปทางขวา', icon: '👉' },
];

const MAX_SIZE_MB = 5;

type PageStep = 'form' | 'face' | 'done';

interface UploadedPose {
  file: File;
  dataUrl: string;
}

/** โดเมนที่อนุญาตให้สมัคร — ฐานข้อมูลบังคับซ้ำอีกชั้นด้วย trigger */
const ALLOWED_DOMAINS = ['rmutl.ac.th', 'live.rmutl.ac.th'];

const isAllowedEmail = (email: string) => {
  const domain = email.trim().toLowerCase().split('@')[1];
  return !!domain && ALLOWED_DOMAINS.includes(domain);
};

/** รหัสนักศึกษา มทร.ล้านนา อยู่ในรูป 67543210064-1
 *  ตัวเลข 11 หลัก + ขีด + เลขตรวจสอบ 1 หลัก
 *  ผู้ใช้จะพิมพ์ขีดเองหรือไม่ก็ได้ ระบบเติมให้อัตโนมัติเมื่อครบ 11 หลัก
 */
const formatStudentId = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 12);
  if (digits.length <= 11) return digits;
  return `${digits.slice(0, 11)}-${digits.slice(11)}`;
};

/** ตัดขีดออกก่อนเทียบ เพื่อให้ตรงกับรหัสในไฟล์รายชื่อจากระบบทะเบียน */
export const normalizeStudentId = (v: string) => v.replace(/\D/g, '');

const isValidStudentId = (v: string) => {
  const digits = normalizeStudentId(v);
  return digits.length >= 9 && digits.length <= 13;
};

const RegisterPage = () => {
  const navigate = useNavigate();
  const { isMobileView } = useViewMode();
  const { register } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [pageStep, setPageStep] = useState<PageStep>('form');
  const [mode, setMode] = useState<'student' | 'instructor'>('student');
  const [instructorSubmitting, setInstructorSubmitting] = useState(false);

  /* ── Form fields ── */
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');

  /* ── Uploaded pose files ── */
  const [uploads, setUploads] = useState<Partial<Record<PoseSlot['id'], UploadedPose>>>({});
  const pickerRef = useRef<HTMLInputElement>(null);
  const pickingForRef = useRef<PoseSlot['id'] | null>(null);

  const readAsDataUrl = (file: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

  const openPicker = (poseId: PoseSlot['id']) => {
    pickingForRef.current = poseId;
    pickerRef.current?.click();
  };

  const onPickFile = async (files: FileList | null) => {
    const poseId = pickingForRef.current;
    pickingForRef.current = null;
    if (!files || !files[0] || !poseId) return;
    const f = files[0];
    if (!f.type.startsWith('image/')) { toast.error('ไฟล์ต้องเป็นรูปภาพ'); return; }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) { toast.error(`ไฟล์เกิน ${MAX_SIZE_MB}MB`); return; }
    try {
      const dataUrl = await readAsDataUrl(f);
      setUploads(prev => ({ ...prev, [poseId]: { file: f, dataUrl } }));
      toast.success(`บันทึก "${POSES.find(p => p.id === poseId)?.label}" แล้ว`);
    } catch {
      toast.error('อ่านไฟล์ไม่สำเร็จ');
    }
  };

  const removePose = (poseId: PoseSlot['id']) => {
    setUploads(prev => {
      const next = { ...prev };
      delete next[poseId];
      return next;
    });
  };

  const uploadedCount = Object.keys(uploads).length;
  const allUploaded = uploadedCount === POSES.length;

  /* ── Form validation ── */
  const validateForm = (): boolean => {
    const nameError = validateThaiFullName(name);
    if (nameError) { setFormError(nameError); return false; }
    if (mode === 'student') {
      if (!isValidStudentId(studentId)) { setFormError('กรุณากรอกรหัสนักศึกษาให้ถูกต้อง (9–13 หลัก ใส่ขีดหรือไม่ใส่ก็ได้)'); return false; }
    } else {
      if (!department.trim()) { setFormError('กรุณากรอกภาควิชา / สังกัด'); return false; }
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFormError('กรุณากรอกอีเมลให้ถูกต้อง'); return false; }
    if (!isAllowedEmail(email)) { setFormError('ต้องใช้อีเมลของมหาวิทยาลัยเท่านั้น (@rmutl.ac.th หรือ @live.rmutl.ac.th)'); return false; }
    if (password.length < 8) { setFormError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return false; }
    if (password !== confirmPassword) { setFormError('รหัสผ่านไม่ตรงกัน'); return false; }
    setFormError('');
    return true;
  };

  const handleInstructorSubmit = async () => {
    if (!validateForm()) return;
    setInstructorSubmitting(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { name: name.trim() } },
      });
      if (error) {
        const msg = error.message.toLowerCase().includes('already registered')
          ? 'อีเมลนี้ถูกใช้งานแล้ว' : error.message;
        toast.error(msg);
        setInstructorSubmitting(false);
        return;
      }
      const uid = data.user?.id;
      if (!uid) {
        toast.error('สมัครไม่สำเร็จ');
        setInstructorSubmitting(false);
        return;
      }
      // Wait until the session is present so RLS-authenticated inserts succeed.
      if (!data.session) {
        // If email confirmation is required, tell the user.
        toast.info('กรุณายืนยันอีเมลของคุณเพื่อดำเนินการต่อ');
        setInstructorSubmitting(false);
        return;
      }
      // Create profile + role_request (no user_roles insert)
      await supabase.from('profiles').upsert(
        { user_id: uid, name: name.trim(), email: cleanEmail, department: department.trim() },
        { onConflict: 'user_id' },
      );
      const { error: reqErr } = await supabase.from('role_requests').insert({
        user_id: uid, requested_role: 'instructor', department: department.trim(),
      });
      if (reqErr) {
        toast.error(`บันทึกคำขอไม่สำเร็จ: ${reqErr.message}`);
        setInstructorSubmitting(false);
        return;
      }
      toast.success('ส่งคำขอเป็นอาจารย์เรียบร้อย รอแอดมินอนุมัติ');
      window.location.href = '/instructor/waiting';
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สมัครไม่สำเร็จ');
      setInstructorSubmitting(false);
    }
  };

  const handleFormNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'instructor') {
      handleInstructorSubmit();
      return;
    }
    if (validateForm()) setPageStep('face');
  };

  const handleGoDone = () => {
    if (!allUploaded) { toast.error(`กรุณาแนบให้ครบ ${POSES.length} ท่า`); return; }
    setPageStep('done');
  };

  const handleComplete = async () => {
    if (!allUploaded) { toast.error('กรุณาแนบรูปให้ครบก่อน'); return; }
    setSubmitting(true);
    try {
      const res = await register({ name, studentId, email, password });
      if (!res.success) {
        toast.error(res.error || 'ลงทะเบียนไม่สำเร็จ');
        setSubmitting(false);
        return;
      }
      // Get uid from session
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) {
        toast.error('ไม่พบเซสชันผู้ใช้ กรุณาเข้าสู่ระบบ');
        setSubmitting(false);
        return;
      }

      // Build 50 rows: for each of 5 poses → 1 normalized original + 9 augmented copies.
      const totalRows = POSES.length * (1 + AUGMENT_PER_POSE); // 50
      setProgress({ done: 0, total: totalRows + 1 });

      const rows: any[] = [];
      for (let i = 0; i < POSES.length; i++) {
        const p = POSES[i];
        const u = uploads[p.id]!;
        const original = await normalizeOriginal(u.dataUrl);
        const augmented = await augmentImage(u.dataUrl, AUGMENT_PER_POSE);
        rows.push({
          user_id: uid,
          student_id: uid,
          student_code: studentId,
          student_name: name,
          pose: p.id,
          pose_label: `${p.label} (ต้นฉบับ)`,
          kind: 'original',
          variant: 0,
          image_data: original,
          captured_at: new Date().toISOString(),
        });
        augmented.forEach((dataUrl, j) => {
          rows.push({
            user_id: uid,
            student_id: uid,
            student_code: studentId,
            student_name: name,
            pose: p.id,
            pose_label: `${p.label} (เสริม #${j + 1})`,
            kind: 'augmented',
            variant: j + 1,
            image_data: dataUrl,
            captured_at: new Date().toISOString(),
          });
        });
      }

      // Clear previous (should be empty for a fresh account, but safe)
      await supabase.from('face_images').delete().eq('user_id', uid);
      let done = 1;
      setProgress({ done, total: totalRows + 1 });

      // Chunked insert so a bad row doesn't blow up the whole batch.
      const CHUNK = 5;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await supabase.from('face_images').insert(chunk);
        if (error) throw new Error(error.message);
        done += chunk.length;
        setProgress({ done, total: totalRows + 1 });
      }

      await upsertMyRegStatus({
        userId: uid,
        studentCode: studentId,
        studentName: name,
        status: 'pending_training',
      });

      toast.success('ส่งรูปเรียบร้อย รอแอดมินเทรนโมเดล');
      navigate('/student/waiting', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ';
      toast.error(msg);
      setSubmitting(false);
      setProgress(null);
    }
  };

  useEffect(() => { /* no-op cleanup placeholder */ }, []);

  const progressPct = (uploadedCount / POSES.length) * 100;

  return (
    <div className={`min-h-screen bg-background flex flex-col ${isMobileView ? '' : 'items-center justify-center'}`}>
      {/* Header */}
      <div className={`sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border px-4 py-3 flex items-center gap-3 ${isMobileView ? '' : 'max-w-2xl w-full mx-auto'}`}>
        <button
          onClick={() => {
            if (pageStep === 'face') setPageStep('form');
            else if (pageStep === 'done') setPageStep('face');
            else navigate('/');
          }}
          className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1">
          <h1 className={`font-bold font-display text-foreground ${isMobileView ? 'text-base' : 'text-lg'}`}>
            {pageStep === 'form' ? 'ลงทะเบียนสมาชิก' : pageStep === 'face' ? 'แนบรูปใบหน้า 5 ท่า' : 'ยืนยันการลงทะเบียน'}
          </h1>
          <p className="text-[10px] text-muted-foreground">
            {pageStep === 'form' ? 'ขั้นตอนที่ 1/2 — กรอกข้อมูล' : pageStep === 'face' ? 'ขั้นตอนที่ 2/2 — แนบรูปตามท่าที่กำหนด' : 'ตรวจสอบและส่งข้อมูล'}
          </p>
        </div>
        <ViewModeToggle />
      </div>

      {/* Step progress indicator */}
      <div className={`px-4 pt-3 flex items-center gap-2 ${isMobileView ? '' : 'max-w-2xl w-full mx-auto'}`}>
        <div className={`flex-1 h-1.5 rounded-full transition-colors ${pageStep === 'form' ? 'bg-primary' : 'bg-primary'}`} />
        <div className={`flex-1 h-1.5 rounded-full transition-colors ${pageStep !== 'form' ? 'bg-primary' : 'bg-muted'}`} />
      </div>

      <div className={`flex-1 flex flex-col ${isMobileView ? '' : 'max-w-2xl w-full mx-auto'}`}>
        <AnimatePresence mode="wait">
          {/* STEP 1: FORM */}
          {pageStep === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 px-4 py-3"
            >
              <div className="flex items-center justify-center gap-2.5 mb-3">
                <img src={rmutlCrest} alt="ตราสัญลักษณ์ มทร.ล้านนา"
                  className="w-9 h-9 object-contain flex-shrink-0" />
                <p className="text-xs text-muted-foreground">กรอกข้อมูลส่วนตัวเพื่อสร้างบัญชี</p>
              </div>

              <form onSubmit={handleFormNext} className="space-y-2.5">
                <div className="bg-card rounded-2xl p-1.5 shadow-card grid grid-cols-2 gap-1">
                  <button type="button" onClick={() => setMode('student')}
                    className={`py-2 rounded-xl text-sm font-semibold transition-colors ${mode === 'student' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                    นักศึกษา
                  </button>
                  <button type="button" onClick={() => setMode('instructor')}
                    className={`py-2 rounded-xl text-sm font-semibold transition-colors ${mode === 'instructor' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                    อาจารย์
                  </button>
                </div>
                {mode === 'instructor' && (
                  <div className="rounded-xl bg-warning/10 border border-warning/30 px-3 py-1.5 text-[11px] leading-snug text-warning">
                    บัญชีอาจารย์ต้องรอแอดมินอนุมัติก่อนใช้งาน
                  </div>
                )}

                <div className="bg-card rounded-2xl p-4 space-y-2.5 shadow-elevated">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5 block">ชื่อ-นามสกุล (ภาษาไทย พร้อมคำนำหน้า)</label>
                    <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                      <User className="w-4 h-4 text-primary flex-shrink-0" />
                      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="นายสมชาย ใจดี"
                        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" maxLength={100} />
                    </div>
                  </div>
                  {mode === 'student' ? (
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5 block">รหัสนักศึกษา</label>
                      <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                        <GraduationCap className="w-4 h-4 text-primary flex-shrink-0" />
                        <input type="text" inputMode="numeric" value={studentId} onChange={e => setStudentId(formatStudentId(e.target.value))} placeholder="67543210064-1"
                          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" maxLength={13} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5 block">ภาควิชา / สังกัด</label>
                      <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                        <GraduationCap className="w-4 h-4 text-primary flex-shrink-0" />
                        <input type="text" value={department} onChange={e => setDepartment(e.target.value)} placeholder="วิศวกรรมซอฟต์แวร์"
                          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" maxLength={120} />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5 block">อีเมล</label>
                    <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                      <Mail className="w-4 h-4 text-primary flex-shrink-0" />
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@live.rmutl.ac.th"
                        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" maxLength={255} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      ใช้ได้เฉพาะอีเมลมหาวิทยาลัย และต้องยืนยันผ่านอีเมลก่อนเข้าใช้งาน
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5 block">รหัสผ่าน</label>
                    <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                      <Lock className="w-4 h-4 text-primary flex-shrink-0" />
                      <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร"
                        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" maxLength={128} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-muted-foreground">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5 block">ยืนยันรหัสผ่าน</label>
                    <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                      <Lock className="w-4 h-4 text-primary flex-shrink-0" />
                      <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="กรอกรหัสผ่านอีกครั้ง"
                        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" maxLength={128} />
                    </div>
                  </div>

                  {formError && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-destructive text-center">
                      {formError}
                    </motion.p>
                  )}
                </div>

                <button type="submit" disabled={instructorSubmitting}
                  className="press w-full py-2.5 rounded-xl gradient-primary text-primary-foreground font-semibold text-sm shadow-brand hover:shadow-float transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                  {instructorSubmitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> กำลังส่งคำขอ…</>
                  ) : mode === 'student' ? (
                    <>ถัดไป — แนบรูปใบหน้า <ArrowRight className="w-4 h-4" /></>
                  ) : (
                    <>ส่งคำขอเป็นอาจารย์ <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>

                <p className="text-center text-xs text-muted-foreground">
                  มีบัญชีแล้ว?{' '}
                  <button type="button" onClick={() => navigate('/')} className="text-primary font-semibold hover:underline">
                    เข้าสู่ระบบ
                  </button>
                </p>
              </form>
            </motion.div>
          )}

          {/* STEP 2: UPLOAD 5 POSES */}
          {pageStep === 'face' && (
            <motion.div
              key="face"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 px-4 py-4 space-y-4"
            >
              <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">ความคืบหน้า</p>
                  <p className="text-xs text-muted-foreground">{uploadedCount}/{POSES.length} ท่า</p>
                </div>
                <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
                  <motion.div className="absolute inset-y-0 left-0 rounded-full bg-primary" animate={{ width: `${progressPct}%` }} transition={{ duration: 0.4 }} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  แนบรูปใบหน้าของคุณตามท่าที่กำหนด — JPG/PNG สูงสุด {MAX_SIZE_MB}MB ต่อไฟล์ แสงสว่างพอ เห็นใบหน้าชัด
                </p>
              </div>

              <input ref={pickerRef} type="file" accept="image/*" className="hidden"
                onChange={e => { onPickFile(e.target.files); e.target.value = ''; }} />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {POSES.map(pose => {
                  const up = uploads[pose.id];
                  return (
                    <div key={pose.id} className="rounded-2xl border border-border bg-card overflow-hidden">
                      <div className="aspect-square relative bg-muted flex items-center justify-center">
                        {up ? (
                          <>
                            <img src={up.dataUrl} alt={pose.label} className="w-full h-full object-cover" />
                            <button onClick={() => removePose(pose.id)}
                              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-destructive">
                              <XCircle className="w-4 h-4" />
                            </button>
                            <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> บันทึกแล้ว
                            </div>
                          </>
                        ) : (
                          <button onClick={() => openPicker(pose.id)}
                            className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors">
                            <span className="text-3xl">{pose.icon}</span>
                            <Upload className="w-4 h-4" />
                            <span className="text-[10px]">แตะเพื่อเลือกรูป</span>
                          </button>
                        )}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-sm font-semibold text-foreground">{pose.label}</p>
                        <p className="text-[10px] text-muted-foreground">{pose.hint}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={handleGoDone} disabled={!allUploaded}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-elevated disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                ถัดไป — ยืนยันข้อมูล <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* STEP 3: DONE / SUBMIT */}
          {pageStep === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4 text-center"
            >
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                <Hourglass className="w-10 h-10 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold font-display text-foreground">พร้อมส่งข้อมูลแล้ว</h2>
                <p className="text-sm text-muted-foreground mt-1">หลังกดยืนยัน ระบบจะส่งรูปให้แอดมินเทรนโมเดล</p>
              </div>
              <div className="w-full max-w-sm bg-card rounded-xl p-3 shadow-card text-left space-y-1">
                <p className="text-xs text-muted-foreground">ชื่อ: <span className="text-foreground font-medium">{name}</span></p>
                <p className="text-xs text-muted-foreground">รหัส: <span className="text-foreground font-medium">{studentId}</span></p>
                <p className="text-xs text-muted-foreground">อีเมล: <span className="text-foreground font-medium">{email}</span></p>
                <p className="text-xs text-muted-foreground">รูปใบหน้า: <span className="text-primary font-medium">✓ ครบ {POSES.length} ท่า</span></p>
              </div>

              <div className="grid grid-cols-5 gap-1.5 w-full max-w-sm">
                {POSES.map(p => (
                  <div key={p.id} className="aspect-square rounded-lg overflow-hidden border border-border">
                    {uploads[p.id] && <img src={uploads[p.id]!.dataUrl} alt={p.label} className="w-full h-full object-cover" />}
                  </div>
                ))}
              </div>

              <button onClick={handleComplete} disabled={submitting}
                className="w-full max-w-sm py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-elevated disabled:opacity-60 flex items-center justify-center gap-2">
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {progress ? `กำลังอัปโหลด ${progress.done}/${progress.total}` : 'กำลังลงทะเบียน…'}
                  </>
                ) : (
                  <>ยืนยันและส่งรูป</>
                )}
              </button>

              <p className="text-[11px] text-muted-foreground max-w-sm">
                หลังส่งแล้ว บัญชีของคุณจะอยู่ในสถานะ "รอแอดมินเทรน" — จะเข้าสู่ระบบใช้งานได้เมื่อแอดมินอนุมัติ
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default RegisterPage;
