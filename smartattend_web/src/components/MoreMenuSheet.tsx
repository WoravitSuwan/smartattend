import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, type LucideIcon } from 'lucide-react';

export interface MoreMenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export interface MoreMenuGroup {
  /** หัวข้อของกลุ่ม เช่น "ผู้ใช้และรายวิชา" */
  title: string;
  items: MoreMenuItem[];
}

interface Props {
  open: boolean;
  groups: MoreMenuGroup[];
  /** เส้นทางปัจจุบัน ใช้ไฮไลต์รายการที่กำลังเปิดอยู่ */
  currentPath: string;
  onClose: () => void;
}

/**
 * แผ่นรายการเมนูที่เปิดขึ้นมาจากด้านล่าง
 *
 * ใช้แทนการยัดแท็บทั้งหมดลงในแถบล่าง ซึ่งบนจอ 390px ทำให้ตัวหนังสือเล็กจน
 * อ่านไม่ออกและต้องเลื่อนแนวนอนเพื่อดูให้ครบ
 *
 * รายการจัดกลุ่มตามหัวข้อ เพราะรายการที่ไม่ได้ใช้บ่อยมักหาไม่เจอถ้าเรียงยาว
 * ต่อกันโดยไม่มีหัวข้อคั่น
 */
const MoreMenuSheet = ({ open, groups, currentPath, onClose }: Props) => {
  const navigate = useNavigate();

  // เปิดแผ่นอยู่แล้วล็อกการเลื่อนของหน้าด้านหลัง ไม่งั้นเลื่อนแผ่นจะไปเลื่อนหน้าแทน
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ปิดด้วยปุ่ม Escape สำหรับคนที่ใช้คีย์บอร์ด
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const go = (path: string) => { onClose(); navigate(path); };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
            aria-hidden />
          <motion.div
            role="dialog" aria-modal="true" aria-label="เมนูเพิ่มเติม"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto
                       rounded-t-3xl bg-card shadow-float safe-bottom">
            <div className="sticky top-0 bg-card px-4 pt-4 pb-2 flex items-center justify-between">
              <p className="text-sm font-bold font-display text-foreground">เพิ่มเติม</p>
              <button onClick={onClose} aria-label="ปิดเมนูเพิ่มเติม"
                className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="px-4 pb-4 space-y-4">
              {groups.map(g => (
                <div key={g.title}>
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{g.title}</p>
                  <div className="space-y-1">
                    {g.items.map(it => {
                      const active = currentPath === it.path;
                      const Icon = it.icon;
                      return (
                        <button key={it.path} onClick={() => go(it.path)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                            active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                          }`}>
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{it.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MoreMenuSheet;
