import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, ArrowLeftRight, CheckCircle, XCircle, ScanFace, Loader2 } from 'lucide-react';

type Challenge = 'blink' | 'turn_left' | 'turn_right' | 'smile';
type Phase = 'prompt' | 'scanning' | 'result';

const CHALLENGES: { key: Challenge; label: string; icon: typeof Eye }[] = [
  { key: 'blink', label: 'กะพริบตา 2 ครั้งช้าๆ', icon: Eye },
  { key: 'turn_left', label: 'หันหน้าไปทางซ้ายเล็กน้อย', icon: ArrowLeftRight },
  { key: 'turn_right', label: 'หันหน้าไปทางขวาเล็กน้อย', icon: ArrowLeftRight },
  { key: 'smile', label: 'ยิ้มค้างไว้ 1 วินาที', icon: ScanFace },
];

interface Props {
  open: boolean;
  subjectName?: string;
  onClose: () => void;
  /** Called after check completes. `flagged` = liveness ไม่ผ่าน แต่ยังบันทึกได้ */
  onComplete: (result: { passed: boolean; flagged: boolean; challenge: Challenge }) => void;
}

export default function LivenessCheckModal({ open, subjectName, onClose, onComplete }: Props) {
  const [challenge, setChallenge] = useState<Challenge>('blink');
  const [phase, setPhase] = useState<Phase>('prompt');
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const pick = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    setChallenge(pick.key);
    setPhase('prompt');
    setPassed(false);
  }, [open]);

  const runCheck = () => {
    setPhase('scanning');
    // Simulated liveness detection (85% pass rate)
    setTimeout(() => {
      const ok = Math.random() > 0.15;
      setPassed(ok);
      setPhase('result');
    }, 2200);
  };

  const finish = () => {
    onComplete({ passed, flagged: !passed, challenge });
    onClose();
  };

  const cur = CHALLENGES.find(c => c.key === challenge)!;
  const Icon = cur.icon;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={phase !== 'scanning' ? onClose : undefined}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-card rounded-3xl shadow-float border border-border p-6 w-full max-w-sm space-y-4"
          >
            <div className="text-center space-y-1">
              <h3 className="text-base font-bold font-display text-foreground">ตรวจสอบตัวตน (Liveness)</h3>
              {subjectName && <p className="text-xs text-muted-foreground">กำลังยืนยัน: {subjectName}</p>}
            </div>

            {phase === 'prompt' && (
              <>
                <div className="rounded-2xl bg-muted/50 p-5 flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
                    <Icon className="w-8 h-8" />
                  </div>
                  <p className="text-sm font-semibold text-foreground text-center">{cur.label}</p>
                  <p className="text-[11px] text-muted-foreground text-center">
                    เพื่อยืนยันว่าเป็นบุคคลจริง ไม่ใช่รูปถ่ายหรือวิดีโอ
                  </p>
                </div>
                <button onClick={runCheck}
                  className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
                  เริ่มตรวจสอบ
                </button>
              </>
            )}

            {phase === 'scanning' && (
              <div className="py-10 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">กำลังวิเคราะห์การเคลื่อนไหว…</p>
              </div>
            )}

            {phase === 'result' && (
              <>
                <div className={`rounded-2xl p-5 flex flex-col items-center gap-2 ${
                  passed ? 'bg-success/10' : 'bg-warning/10'
                }`}>
                  {passed
                    ? <CheckCircle className="w-12 h-12 text-success" />
                    : <XCircle className="w-12 h-12 text-warning" />}
                  <p className={`text-sm font-semibold ${passed ? 'text-success' : 'text-warning'}`}>
                    {passed ? 'ผ่านการตรวจสอบ' : 'ตรวจสอบไม่ผ่าน'}
                  </p>
                  <p className="text-[11px] text-muted-foreground text-center">
                    {passed
                      ? 'บันทึกการเข้าเรียนเรียบร้อย'
                      : 'จะบันทึกเป็น "รอตรวจสอบ" ให้อาจารย์ยืนยันภายหลัง'}
                  </p>
                </div>
                <button onClick={finish}
                  className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
                  {passed ? 'ตกลง' : 'บันทึกเป็น flagged'}
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
