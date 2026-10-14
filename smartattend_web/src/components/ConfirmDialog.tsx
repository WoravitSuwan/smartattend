import { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';

export interface ConfirmChoice {
  /** ค่าที่จะถูกส่งกลับไปเมื่อเลือกปุ่มนี้ */
  value: string;
  label: string;
  detail?: string;
  tone?: 'primary' | 'danger' | 'muted';
}

interface Props {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  /** ปุ่มทางเลือก — ถ้าไม่ส่งมา จะมีปุ่ม "ยืนยัน" เดียว */
  choices?: ConfirmChoice[];
  /** ถ้าตั้งค่า ผู้ใช้ต้องพิมพ์ข้อความนี้ให้ตรงก่อนจึงกดยืนยันได้ */
  requireText?: string | null;
  requireTextLabel?: string;
  /**
   * ช่องกรอกข้อความอิสระ ใช้แทน window.prompt
   *
   * ต่างจาก requireText ตรงที่ requireText บังคับให้พิมพ์ให้ "ตรง" กับค่าที่กำหนด
   * เพื่อกันการกดพลาด ส่วนช่องนี้รับข้อความอะไรก็ได้แล้วส่งกลับไปให้ผู้เรียกใช้
   * เช่นเหตุผลการแก้ข้อมูลการเข้าเรียน ที่ฐานข้อมูลบังคับว่าต้องมี
   */
  input?: {
    label: string;
    placeholder?: string;
    /** true = กดยืนยันไม่ได้ถ้ายังไม่กรอก */
    required?: boolean;
    multiline?: boolean;
    maxLength?: number;
  };
  busy?: boolean;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: (choice: string, inputValue: string) => void;
}

const toneClass = (tone: ConfirmChoice['tone']) =>
  tone === 'danger'
    ? 'bg-destructive text-destructive-foreground'
    : tone === 'muted'
      ? 'bg-muted text-foreground'
      : 'gradient-primary text-primary-foreground';

/**
 * ไดอะล็อกยืนยันของแอป ใช้แทน window.confirm
 *
 * window.confirm มีปัญหาสามอย่างในบริบทนี้
 *   1. ให้ได้แค่ "ตกลง/ยกเลิก" รองรับทางเลือกหลายแบบไม่ได้
 *      (เช่นลดคะแนนเต็มแล้วจะปรับสัดส่วน หรือตัดคะแนน หรือยกเลิก)
 *   2. บังคับพิมพ์ยืนยันสำหรับการกระทำที่กู้คืนไม่ได้ไม่ได้
 *   3. เบราว์เซอร์บนมือถือบางตัวบล็อกหรือแสดงผิดรูป และสไตล์ไม่เข้ากับแอป
 */
const ConfirmDialog = ({
  open, title, description, choices, requireText, requireTextLabel, input,
  busy, cancelLabel = 'ยกเลิก', onCancel, onConfirm,
}: Props) => {
  const [typed, setTyped] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => { if (open) { setTyped(''); setValue(''); } }, [open]);

  const locked = (!!requireText && typed.trim() !== requireText.trim())
    || (!!input?.required && !value.trim());
  const buttons: ConfirmChoice[] = choices?.length
    ? choices
    : [{ value: 'confirm', label: 'ยืนยัน', tone: 'primary' }];

  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o && !busy) onCancel(); }}>
      <AlertDialogContent className="max-w-sm rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-display">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2">
                {description}
              </div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {requireText && (
          <div className="space-y-1">
            <p className="text-[11px] text-foreground">
              {requireTextLabel ?? `พิมพ์ "${requireText}" เพื่อยืนยัน`}
            </p>
            <input value={typed} onChange={e => setTyped(e.target.value)} autoFocus
              placeholder={requireText}
              className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
          </div>
        )}

        {input && (
          <div className="space-y-1">
            <label htmlFor="confirm-input" className="block text-[11px] text-foreground">
              {input.label}
              {input.required && <span className="text-destructive"> *</span>}
            </label>
            {input.multiline ? (
              <textarea id="confirm-input" value={value} rows={3} autoFocus
                maxLength={input.maxLength} placeholder={input.placeholder}
                onChange={e => setValue(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none resize-none" />
            ) : (
              <input id="confirm-input" value={value} autoFocus
                maxLength={input.maxLength} placeholder={input.placeholder}
                onChange={e => setValue(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-muted text-xs text-foreground outline-none" />
            )}
            {input.required && !value.trim() && (
              <p className="text-[10px] text-muted-foreground">ต้องกรอกช่องนี้ก่อนจึงจะยืนยันได้</p>
            )}
          </div>
        )}

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {buttons.map(b => (
            <button key={b.value} onClick={() => onConfirm(b.value, value.trim())}
              disabled={busy || locked}
              className={`w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50 ${toneClass(b.tone)}`}>
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span className="flex flex-col items-center">
                <span>{b.label}</span>
                {b.detail && <span className="text-[10px] font-normal opacity-80">{b.detail}</span>}
              </span>
            </button>
          ))}
          <button onClick={onCancel} disabled={busy}
            className="w-full py-2.5 rounded-xl bg-muted text-xs font-semibold text-foreground disabled:opacity-50">
            {cancelLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmDialog;
