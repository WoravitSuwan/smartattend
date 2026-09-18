import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Share, Plus, X } from 'lucide-react';

/** Chrome fires this before showing its own install prompt. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'smartattend-install-dismissed';

const InstallAppBanner = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [visible, setVisible] = useState(false);

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS exposes this non-standard flag instead of display-mode
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  useEffect(() => {
    if (isStandalone) return;                       // already installed
    if (sessionStorage.getItem(DISMISS_KEY)) return; // dismissed this session

    if (isIos) {
      // iOS has no install event — surface the manual instructions instead
      const t = setTimeout(() => setVisible(true), 2500);
      return () => clearTimeout(t);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [isIos, isStandalone]);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
    setShowIosHelp(false);
  };

  const install = async () => {
    if (isIos) {
      setShowIosHelp(true);
      return;
    }
    if (!deferred) return;
    await deferred.prompt();
    // The native prompt can only be used once — whatever the outcome, this
    // banner has nothing left to offer, so hide it instead of leaving a
    // button that silently does nothing on a second tap.
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-sm"
      >
        <div className="glass-card-elevated rounded-2xl p-4">
          {!showIosHelp ? (
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                <Download className="w-5 h-5 text-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">ติดตั้งเป็นแอป</p>
                <p className="text-[11px] text-muted-foreground">
                  เปิดเต็มจอ ใช้งานได้เหมือนแอปทั่วไป
                </p>
              </div>
              <button
                onClick={install}
                className="press px-3.5 py-2 rounded-xl gradient-primary text-primary-foreground text-xs font-bold shrink-0"
              >
                ติดตั้ง
              </button>
              <button
                onClick={dismiss}
                aria-label="ปิด"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">วิธีติดตั้งบน iPhone</p>
                <button onClick={dismiss} aria-label="ปิด" className="text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold grid place-items-center text-[10px]">1</span>
                <Share className="w-4 h-4 text-primary" />
                <span>แตะปุ่มแชร์ด้านล่างของ Safari</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold grid place-items-center text-[10px]">2</span>
                <Plus className="w-4 h-4 text-primary" />
                <span>เลือก &ldquo;เพิ่มไปยังหน้าจอโฮม&rdquo;</span>
              </div>
              <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                ต้องเปิดผ่าน Safari เท่านั้น เบราว์เซอร์อื่นบน iPhone ติดตั้งไม่ได้
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default InstallAppBanner;
