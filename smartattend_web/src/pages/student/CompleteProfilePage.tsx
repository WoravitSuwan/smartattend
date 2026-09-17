import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { UserCircle2, Loader2, LogOut, Building, GraduationCap, Phone, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';

const FACULTIES = [
  'คณะวิศวกรรมศาสตร์',
  'คณะบริหารธุรกิจและศิลปศาสตร์',
  'คณะศิลปกรรมและสถาปัตยกรรมศาสตร์',
  'คณะวิทยาศาสตร์และเทคโนโลยีการเกษตร',
  'วิทยาลัยเทคโนโลยีและสหวิทยาการ',
];

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuth();
  const [faculty, setFaculty] = useState(user?.faculty ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [busy, setBusy] = useState(false);

  const phoneOk = /^0\d{9}$/.test(phone.replace(/[-\s]/g, ''));
  const canSave = !!faculty.trim() && !!department.trim() && phoneOk;

  const handleSave = async () => {
    if (!canSave) {
      toast.error('กรุณากรอกข้อมูลให้ครบและตรวจสอบเบอร์โทร (10 หลัก)');
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('ไม่พบผู้ใช้');
      const nowIso = new Date().toISOString();
      const cleanPhone = phone.replace(/[-\s]/g, '');
      const { error } = await supabase
        .from('profiles')
        .update({
          faculty: faculty.trim(),
          department: department.trim(),
          phone: cleanPhone,
          profile_completed_at: nowIso,
        })
        .eq('user_id', auth.user.id);
      if (error) throw error;
      updateUser({
        faculty: faculty.trim(),
        department: department.trim(),
        phone: cleanPhone,
        profileCompletedAt: nowIso,
      });
      toast.success('บันทึกข้อมูลเรียบร้อย');
      navigate('/student', { replace: true });
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col p-4">
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-semibold">{user?.name}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <button
          onClick={() => { logout(); navigate('/', { replace: true }); }}
          className="flex items-center gap-1.5 text-xs text-destructive font-medium px-3 py-1.5 rounded-lg bg-destructive/10"
        >
          <LogOut className="w-3.5 h-3.5" /> ออกจากระบบ
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-3xl border border-primary/40 bg-primary/5 p-6 space-y-5"
        >
          <div className="w-16 h-16 rounded-2xl bg-card flex items-center justify-center mx-auto shadow-card">
            <UserCircle2 className="w-8 h-8 text-primary" />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-lg font-bold font-display">กรอกข้อมูลส่วนตัว</h1>
            <p className="text-sm text-muted-foreground">
              กรุณากรอกข้อมูลให้ครบถ้วนก่อนเข้าใช้งานระบบ
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">คณะ *</label>
              <div className="flex items-center gap-2 bg-card rounded-xl px-3 py-2.5 border border-border">
                <Building className="w-4 h-4 text-primary" />
                <select
                  value={faculty}
                  onChange={(e) => setFaculty(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-foreground outline-none"
                >
                  <option value="">-- เลือกคณะ --</option>
                  {FACULTIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">สาขาวิชา *</label>
              <div className="flex items-center gap-2 bg-card rounded-xl px-3 py-2.5 border border-border">
                <GraduationCap className="w-4 h-4 text-primary" />
                <input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="เช่น วิศวกรรมซอฟต์แวร์"
                  className="flex-1 bg-transparent text-sm text-foreground outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">เบอร์โทรศัพท์ *</label>
              <div className="flex items-center gap-2 bg-card rounded-xl px-3 py-2.5 border border-border">
                <Phone className="w-4 h-4 text-primary" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0XXXXXXXXX (10 หลัก)"
                  maxLength={12}
                  className="flex-1 bg-transparent text-sm text-foreground outline-none"
                />
              </div>
              {phone && !phoneOk && (
                <p className="text-[11px] text-destructive mt-1">รูปแบบเบอร์โทรไม่ถูกต้อง</p>
              )}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave || busy}
            className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            บันทึกและเข้าใช้งาน
          </button>
        </motion.div>
      </div>
    </div>
  );
}
