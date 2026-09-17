import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import rmutlCrest from '@/assets/rmutl-crest.png';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';

/** Landing page for the "ลืมรหัสผ่าน?" email link. Supabase puts the
 *  password-recovery session in place automatically when this page loads
 *  from that link; we just collect and save the new password. */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { updatePassword } = useAuth();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    // The recovery link either already produced a session (event fires on
    // load) or one was set moments before this page mounted — check both.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && alive) setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (alive && session) setReady(true);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (password !== confirmPassword) { setError('รหัสผ่านไม่ตรงกัน'); return; }
    setError('');
    setSubmitting(true);
    const res = await updatePassword(password);
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ'); return; }
    toast.success('ตั้งรหัสผ่านใหม่เรียบร้อย กรุณาเข้าสู่ระบบอีกครั้ง');
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 brand-surface safe-top safe-bottom">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="mx-auto mb-4 w-24 h-24 rounded-3xl bg-card/90 backdrop-blur-xl border border-border/60 shadow-float flex items-center justify-center gold-ring">
            <img src={rmutlCrest} alt="ตราสัญลักษณ์ มทร.ล้านนา" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold font-display text-gradient-primary">ตั้งรหัสผ่านใหม่</h1>
        </div>

        {!ready ? (
          <div className="glass-card-elevated rounded-3xl p-6 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              ลิงก์นี้อาจหมดอายุหรือถูกใช้ไปแล้ว กรุณากด "ลืมรหัสผ่าน?" ที่หน้าเข้าสู่ระบบเพื่อขอลิงก์ใหม่
            </p>
            <button onClick={() => navigate('/')} className="text-xs text-primary font-semibold hover:underline">
              กลับหน้าเข้าสู่ระบบ
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass-card-elevated rounded-3xl p-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                รหัสผ่านใหม่
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                  className="w-full px-4 py-3.5 rounded-2xl bg-muted/70 border border-border/60 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary/50 transition-all pr-11"
                  maxLength={128}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                ยืนยันรหัสผ่านใหม่
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3.5 rounded-2xl bg-muted/70 border border-border/60 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary/50 transition-all"
                maxLength={128}
              />
            </div>

            {error && <p className="text-xs text-destructive text-center">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="press w-full py-3.5 rounded-2xl gradient-primary text-primary-foreground font-bold text-[15px] shadow-brand hover:shadow-float transition-all disabled:opacity-60"
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
