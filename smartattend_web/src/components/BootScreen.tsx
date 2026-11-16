/**
 * หน้าจอระหว่างเปิดแอป และหน้าจอเมื่อเปิดไม่สำเร็จ
 *
 * ใช้แทน `return null` ทุกจุดที่เคยรอข้อมูลตอน boot ใน App.tsx — `return null`
 * ทำให้ React ไม่วาดอะไรเลย ผู้ใช้เห็นเป็นจอขาวเปล่า และถ้าข้อมูลไม่มาเพราะ
 * เน็ตพลาดหรือฐานข้อมูลไม่ตอบ จอขาวนั้นค้างถาวร ไม่มี timeout ไม่มีปุ่มลองใหม่
 * บนมือถือยิ่งไล่สาเหตุไม่ได้เลยเพราะเปิด console ดูไม่ได้
 */
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { clearSupabaseSession } from '@/lib/boot-state';
import { BOOT_TIMEOUT_MS, useBootTimeout } from '@/lib/use-boot-timeout';

function reload() {
  window.location.reload();
}

/**
 * ล้าง session แล้วโหลดใหม่ เพื่อให้กลับไปหน้าเข้าสู่ระบบได้
 *
 * มีไว้เพราะกรณีที่พบจริงคือ session เก่าใน localStorage ใช้ไม่ได้แล้ว แต่แอป
 * ยังพยายามใช้มันทุกครั้งที่เปิด บนมือถือผู้ใช้ล้างข้อมูลเว็บไซต์เองยากมาก
 * ปุ่มนี้จึงเป็นทางออกที่กดได้จากในแอปเลย
 */
function signOutAndReload() {
  try {
    clearSupabaseSession(window.localStorage);
  } catch {
    // localStorage ถูกปิด หรืออยู่ในโหมดส่วนตัวบางเบราว์เซอร์ — โหลดใหม่ต่อไปได้
  }
  window.location.href = '/';
}

/** ตัวหมุนรอ พร้อมข้อความสั้น ๆ ว่ากำลังทำอะไรอยู่ */
export function BootWaiting({ label = 'กำลังเตรียมข้อมูล…' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 bg-background">
      <div
        className="w-8 h-8 rounded-full border-2 border-muted-foreground/25 border-t-primary animate-spin"
        role="status"
        aria-label={label}
      />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * หน้าจอเมื่อเปิดแอปไม่สำเร็จ
 *
 * บอกสาเหตุเท่าที่รู้ พร้อมทางออกสองทางที่กดได้เอง ไม่ต้องรอใครมาแก้
 */
export function BootFailed({
  title = 'เปิดระบบไม่สำเร็จ',
  detail,
  showSignOut = true,
}: {
  title?: string;
  detail?: string;
  showSignOut?: boolean;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="w-full max-w-sm bg-card rounded-2xl shadow-card p-6 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
        <div className="space-y-2">
          <h1 className="text-base font-semibold text-foreground">{title}</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {detail ?? 'ติดต่อฐานข้อมูลไม่ได้ อาจเป็นเพราะสัญญาณอินเทอร์เน็ตขาดช่วง หรือเซิร์ฟเวอร์ไม่ตอบ'}
          </p>
        </div>

        <div className="space-y-2 pt-1">
          <button
            onClick={reload}
            className="w-full gradient-primary text-primary-foreground rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> ลองใหม่
          </button>
          {showSignOut && (
            <button
              onClick={signOutAndReload}
              className="w-full bg-muted text-foreground rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" /> ออกจากระบบแล้วเริ่มใหม่
            </button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          ถ้ากดลองใหม่แล้วยังไม่หาย ให้ลองออกจากระบบแล้วเริ่มใหม่
        </p>
      </div>
    </div>
  );
}

/**
 * ตัวห่อที่เลือกแสดงตัวหมุนรอหรือหน้าจอผิดพลาดให้เอง
 *
 * ใช้แทน `return null` ได้ตรง ๆ โดยผู้เรียกบอกแค่ว่ารออะไรอยู่และพลาดไปหรือยัง
 */
export function BootGate({
  failed = false,
  timedOutAfter = BOOT_TIMEOUT_MS,
  label,
  detail,
  showSignOut,
}: {
  failed?: boolean;
  timedOutAfter?: number;
  label?: string;
  detail?: string;
  showSignOut?: boolean;
}) {
  const timedOut = useBootTimeout(!failed, timedOutAfter);
  if (failed || timedOut) return <BootFailed detail={detail} showSignOut={showSignOut} />;
  return <BootWaiting label={label} />;
}
