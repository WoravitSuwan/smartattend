/**
 * ตัวรับ error ที่หลุดออกมาจากการ render
 *
 * ก่อนหน้านี้ทั้งโปรเจกต์ไม่มีตัวนี้เลย ผลคือ error ตอน render ทำให้ React
 * ถอดทุกอย่างออกจากหน้าจอ เหลือเป็นจอขาวเปล่าที่ไม่บอกสาเหตุ ใครเจอก็ไล่ต่อไม่ได้
 * ยิ่งบนมือถือที่เปิด console ดูไม่ได้ ก็ไม่มีทางรู้เลยว่าพังที่อะไร
 *
 * ต้องเป็น class component เพราะ React ยังไม่มี hook ที่ทำหน้าที่นี้
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BootFailed } from './BootScreen';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // เก็บลง console ไว้ให้ไล่ย้อนได้ตอนมีเครื่องที่เปิด devtools ได้
    console.error('ErrorBoundary จับ error จากการ render ได้', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <BootFailed
        title="ระบบทำงานผิดพลาด"
        // แสดงข้อความจริงของ error เพราะผู้ใช้ส่วนใหญ่อยู่บนมือถือและเปิด
        // console ไม่ได้ ข้อความนี้จึงเป็นข้อมูลเดียวที่ส่งต่อมาให้เราได้
        detail={error.message || 'ไม่ทราบสาเหตุ'}
      />
    );
  }
}
