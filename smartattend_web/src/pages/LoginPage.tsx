import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Sun, Moon } from 'lucide-react';
import { toast } from 'sonner';
import rmutlCrest from '@/assets/rmutl-crest.png';
import rmutlWordmark from '@/assets/rmutl-wordmark.png';
import ViewModeToggle from '@/components/ViewModeToggle';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);
  const { login, requestPasswordReset } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetSending(true);
    const res = await requestPasswordReset(resetEmail || email);
    setResetSending(false);
    if (!res.success) { toast.error(res.error || 'ส่งลิงก์ไม่สำเร็จ'); return; }
    toast.success('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว กรุณาตรวจสอบกล่องจดหมาย');
    setShowReset(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('กรุณากรอกข้อมูลให้ครบ');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await login(email.trim(), password);
      if (result.success) {
        // Navigate based on role from the auth context after login
        // We'll check in App.tsx
        navigate('/');
      } else {
        setError(result.error || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 brand-surface safe-top safe-bottom relative overflow-hidden">
      {/* soft decorative glow, purely visual */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-secondary/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-20 w-80 h-80 rounded-full bg-primary/15 blur-3xl" />
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <ViewModeToggle />
        <button
          onClick={toggleTheme}
          className="w-10 h-10 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="mx-auto mb-4 w-24 h-24 rounded-3xl bg-card/90 backdrop-blur-xl border border-border/60 shadow-float flex items-center justify-center gold-ring">
            <img src={rmutlCrest} alt="ตราสัญลักษณ์ มทร.ล้านนา" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-[28px] leading-tight font-extrabold font-display text-gradient-primary">SmartAttend</h1>
          <p className="text-sm text-muted-foreground mt-1.5">ระบบเช็คชื่อเข้าเรียนด้วยการจดจำใบหน้า</p>
          <div className="gold-rule w-20 mx-auto my-3 rounded-full opacity-80" />
          <img src={rmutlWordmark} alt="มหาวิทยาลัยเทคโนโลยีราชมงคลล้านนา" className="h-6 mx-auto object-contain opacity-90" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="glass-card-elevated rounded-3xl p-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                อีเมล / รหัสนักศึกษา
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@live.rmutl.ac.th"
                className="w-full px-4 py-3.5 rounded-2xl bg-muted/70 border border-border/60 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary/50 transition-all"
                maxLength={255}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                รหัสผ่าน
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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

            <div className="text-right">
              <button
                type="button"
                onClick={() => { setResetEmail(email); setShowReset(v => !v); }}
                className="text-xs text-primary hover:underline"
              >
                ลืมรหัสผ่าน?
              </button>
            </div>

            <AnimatePresence>
              {showReset && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <form onSubmit={handleResetRequest} className="rounded-2xl bg-muted/50 p-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      กรอกอีเมลที่ใช้สมัคร ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้
                    </p>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@live.rmutl.ac.th"
                      className="w-full px-3 py-2.5 rounded-xl bg-background border border-border/60 text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:ring-2 focus:ring-secondary/50"
                    />
                    <button
                      type="submit"
                      disabled={resetSending || !resetEmail.trim()}
                      className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
                    >
                      {resetSending ? 'กำลังส่ง...' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-destructive text-center">
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="press w-full py-3.5 rounded-2xl gradient-primary text-primary-foreground font-bold text-[15px] shadow-brand hover:shadow-float transition-all disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  กำลังเข้าสู่ระบบ...
                </span>
              ) : 'เข้าสู่ระบบ'}
            </button>

            <div className="text-center">
              <span className="text-xs text-muted-foreground">ยังไม่มีบัญชี? </span>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="text-xs text-primary font-semibold hover:underline"
              >
                ลงทะเบียน
              </button>
            </div>
          </div>
        </form>

        <p className="text-[11px] text-center text-muted-foreground mt-6">
          คณะวิศวกรรมศาสตร์ · หลักสูตรวิศวกรรมซอฟต์แวร์
        </p>
      </motion.div>
    </div>
  );
};

export default LoginPage;
