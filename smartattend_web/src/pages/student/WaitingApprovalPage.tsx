import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hourglass, CheckCircle2, XCircle, LogOut, RefreshCw, Camera, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import {
  fetchMyRegStatus, getCurrentAuthUserId, subscribeRegStatuses,
  type RegistrationStatus,
} from '@/lib/registration-status';

/** Landing page for students whose face registration is not yet approved.
 *  Realtime-subscribed to their own registration_statuses row. */
export default function WaitingApprovalPage() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;
    (async () => {
      const id = await getCurrentAuthUserId();
      if (!id) { navigate('/'); return; }
      if (!alive) return;
      setUid(id);
      const s = await fetchMyRegStatus(id).catch(() => null);
      if (!alive) return;
      setStatus(s);
      setLoading(false);
      unsub = subscribeRegStatuses(async () => {
        const fresh = await fetchMyRegStatus(id).catch(() => null);
        if (alive) setStatus(fresh);
      }, id);
    })();
    return () => { alive = false; unsub?.(); };
  }, [navigate]);

  useEffect(() => {
    if (status?.status === 'training_success') {
      // Approved → let them into the app
      setTimeout(() => navigate('/student', { replace: true }), 800);
    }
  }, [status, navigate]);

  const refresh = async () => {
    if (!uid) return;
    const s = await fetchMyRegStatus(uid).catch(() => null);
    setStatus(s);
  };

  const handleLogout = () => { logout(); navigate('/', { replace: true }); };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const state = status?.status ?? 'pending_registration';

  const view = {
    pending_registration: {
      icon: <Camera className="w-8 h-8 text-primary" />,
      title: 'ยังไม่ได้ลงทะเบียนใบหน้า',
      desc: 'กรุณาแนบรูปใบหน้าเพื่อให้แอดมินเทรนโมเดล',
      accent: 'border-primary/40 bg-primary/10',
      cta: (
        <button onClick={() => navigate('/student/face-register')}
          className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2">
          <Camera className="w-4 h-4" /> ไปหน้าลงทะเบียนใบหน้า
        </button>
      ),
    },
    pending_training: {
      icon: <Hourglass className="w-8 h-8 text-warning" />,
      title: 'รอแอดมินเทรนโมเดล',
      desc: 'รูปของคุณถูกส่งแล้ว โปรดรอแอดมินตรวจสอบและเทรนโมเดล — หน้านี้จะอัปเดตอัตโนมัติเมื่อเสร็จ',
      accent: 'border-warning/40 bg-warning/10',
      cta: (
        <button onClick={refresh}
          className="w-full h-12 rounded-2xl border border-border font-semibold flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4" /> ตรวจสอบสถานะอีกครั้ง
        </button>
      ),
    },
    training_failed: {
      icon: <XCircle className="w-8 h-8 text-destructive" />,
      title: 'เทรนโมเดลไม่สำเร็จ',
      desc: status?.failureReason ?? 'แอดมินไม่สามารถเทรนโมเดลจากรูปที่ส่งมาได้ กรุณาส่งรูปใหม่',
      accent: 'border-destructive/40 bg-destructive/10',
      cta: (
        <button onClick={() => navigate('/student/face-register')}
          className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2">
          <Camera className="w-4 h-4" /> ส่งรูปใหม่
        </button>
      ),
    },
    training_success: {
      icon: <CheckCircle2 className="w-8 h-8 text-success" />,
      title: 'อนุมัติเรียบร้อย',
      desc: 'กำลังพาไปหน้าหลัก…',
      accent: 'border-success/40 bg-success/10',
      cta: null,
    },
  }[state];

  return (
    <div className="min-h-screen bg-background flex flex-col p-4">
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-semibold">{user?.name}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-destructive font-medium px-3 py-1.5 rounded-lg bg-destructive/10">
          <LogOut className="w-3.5 h-3.5" /> ออกจากระบบ
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className={`w-full max-w-md rounded-3xl border ${view.accent} p-6 space-y-5`}
        >
          <div className="w-16 h-16 rounded-2xl bg-card flex items-center justify-center mx-auto shadow-card">
            {view.icon}
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-lg font-bold font-display">{view.title}</h1>
            <p className="text-sm text-muted-foreground">{view.desc}</p>
          </div>
          {view.cta}
          {state === 'pending_training' && (
            <p className="text-[11px] text-muted-foreground text-center">
              ส่งเมื่อ: {status?.updatedAt ? new Date(status.updatedAt).toLocaleString('th-TH') : '-'}
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
