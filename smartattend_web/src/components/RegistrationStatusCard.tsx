import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Hourglass, CheckCircle, XCircle, Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { fetchMyRegStatus, getCurrentAuthUserId, subscribeRegStatuses, type RegistrationStatus } from '@/lib/registration-status';

/** Student dashboard banner: live face-registration/training status (realtime). */
export default function RegistrationStatusCard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    let unsub: (() => void) | null = null;
    getCurrentAuthUserId()
      .then(authUserId => {
        if (!active) return;
        if (!authUserId) { setLoaded(true); return; }
        const load = () => fetchMyRegStatus(authUserId)
          .then(s => { if (active) { setStatus(s); setLoaded(true); } })
          .catch(() => { if (active) setLoaded(true); });
        load();
        unsub = subscribeRegStatuses(load, authUserId);
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; unsub?.(); };
  }, [user]);

  if (!loaded) return null;

  const st = status?.status ?? 'pending_registration';
  const cfg = {
    pending_registration: {
      icon: Camera, cls: 'border-primary/30 bg-primary/5', iconCls: 'text-primary',
      title: 'ยังไม่ได้ลงทะเบียนใบหน้า', desc: 'ถ่ายรูปใบหน้าเพื่อเริ่มใช้งานการสแกนเช็คชื่อ', action: 'ลงทะเบียน',
    },
    pending_training: {
      icon: Hourglass, cls: 'border-secondary/40 bg-secondary/10', iconCls: 'text-secondary animate-pulse',
      title: 'รอการเทรนจากแอดมิน (Pending Training)', desc: 'รูปของคุณอยู่ในคิวเทรนแล้ว — สถานะอัปเดตอัตโนมัติ', action: 'ดูสถานะ',
    },
    training_failed: {
      icon: XCircle, cls: 'border-destructive/40 bg-destructive/10', iconCls: 'text-destructive',
      title: 'เทรนไม่สำเร็จ', desc: status?.failureReason ?? 'กรุณาถ่ายรูปใบหน้าใหม่', action: 'ถ่ายรูปใหม่',
    },
    training_success: {
      icon: CheckCircle, cls: 'border-success/40 bg-success/10', iconCls: 'text-success',
      title: 'เทรนสำเร็จ — พร้อมใช้งาน', desc: 'สแกนหน้าเช็คชื่อที่หน้าห้องเรียนได้เลย', action: 'ดูสถานะ',
    },
  }[st];
  const Icon = cfg.icon;

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate('/student/face-register')}
      className={`w-full text-left flex items-center gap-3 p-3.5 rounded-2xl border shadow-card ${cfg.cls}`}
    >
      <Icon className={`w-6 h-6 shrink-0 ${cfg.iconCls}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">{cfg.title}</p>
        <p className="text-xs text-muted-foreground truncate">{cfg.desc}</p>
      </div>
      <span className={`text-xs font-semibold shrink-0 ${cfg.iconCls}`}>{cfg.action} ›</span>
    </motion.button>
  );
}
