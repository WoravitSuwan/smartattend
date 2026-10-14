/**
 * ไดอะล็อกยืนยันกลางของแอป เรียกใช้แบบ await ได้เหมือน window.confirm
 *
 * ที่ต้องมีตัวกลาง ไม่ให้แต่ละหน้าสร้าง ConfirmDialog ของตัวเอง เพราะเดิมมี
 * จุดที่เรียก window.confirm อยู่สิบสามแห่งกระจายทั่วแอป ถ้าให้แต่ละแห่ง
 * ถือ state ของไดอะล็อกเอง จะต้องเพิ่ม state สามตัวต่อหนึ่งจุด และหน้าตา
 * จะค่อย ๆ เพี้ยนออกจากกันเมื่อมีคนแก้ทีละที่
 *
 * วิธีใช้
 *     const ask = useConfirm();
 *     if (!await ask({ title: 'ลบใบลานี้?' })) return;
 *
 * ค่าที่คืน
 *     null                        ผู้ใช้กดยกเลิกหรือปิดไดอะล็อก
 *     { choice, value }           choice คือค่าของปุ่มที่กด ('confirm' ถ้าไม่ได้
 *                                 กำหนด choices เอง) value คือข้อความที่กรอก
 *                                 ในช่อง input ถ้ามี
 *
 * ไดอะล็อกจะปิดทันทีที่กดยืนยัน แล้วผู้เรียกค่อยทำงานต่อ การกดซ้ำจึงเป็นไปไม่ได้
 * อยู่แล้วเพราะปุ่มหายไปแล้ว ผู้เรียกควรบอกผลด้วย toast เมื่อทำงานเสร็จ
 */
import {
  createContext, useCallback, useContext, useRef, useState, type ReactNode,
} from 'react';
import ConfirmDialog, { type ConfirmChoice } from '@/components/ConfirmDialog';

export interface AskOptions {
  title: string;
  description?: ReactNode;
  /** ปุ่มทางเลือก ถ้าไม่ส่งมาจะมีปุ่ม "ยืนยัน" เดียวที่คืน choice = 'confirm' */
  choices?: ConfirmChoice[];
  /** บังคับพิมพ์ข้อความนี้ให้ตรงก่อนกดยืนยันได้ ใช้กับการกระทำที่กู้คืนไม่ได้ */
  requireText?: string | null;
  requireTextLabel?: string;
  /** ช่องกรอกข้อความอิสระ ใช้แทน window.prompt */
  input?: {
    label: string;
    placeholder?: string;
    required?: boolean;
    multiline?: boolean;
    maxLength?: number;
  };
  cancelLabel?: string;
}

export interface AskResult {
  choice: string;
  value: string;
}

type Ask = (options: AskOptions) => Promise<AskResult | null>;

const ConfirmContext = createContext<Ask | null>(null);

const EMPTY: AskOptions = { title: '' };

export const ConfirmProvider = ({ children }: { children: ReactNode }) => {
  // เก็บ options ไว้ต่อแม้ปิดแล้ว เพื่อไม่ให้ข้อความหายวับระหว่างอนิเมชันปิด
  const [state, setState] = useState<{ open: boolean; options: AskOptions }>(
    { open: false, options: EMPTY });
  const resolver = useRef<((result: AskResult | null) => void) | null>(null);

  const ask = useCallback<Ask>(options => new Promise(resolve => {
    // ถ้ามีไดอะล็อกเดิมค้างอยู่ ให้ถือว่าถูกยกเลิก จะได้ไม่มี promise ค้างตลอดไป
    resolver.current?.(null);
    resolver.current = resolve;
    setState({ open: true, options });
  }), []);

  const finish = (result: AskResult | null) => {
    setState(s => ({ ...s, open: false }));
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(result);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmDialog
        open={state.open}
        title={state.options.title}
        description={state.options.description}
        choices={state.options.choices}
        requireText={state.options.requireText}
        requireTextLabel={state.options.requireTextLabel}
        input={state.options.input}
        cancelLabel={state.options.cancelLabel}
        onCancel={() => finish(null)}
        onConfirm={(choice, value) => finish({ choice, value })}
      />
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): Ask => {
  const ask = useContext(ConfirmContext);
  if (!ask) {
    throw new Error('useConfirm ต้องอยู่ภายใต้ ConfirmProvider');
  }
  return ask;
};
