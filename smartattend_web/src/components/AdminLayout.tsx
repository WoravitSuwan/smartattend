import { ReactNode, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Database, Brain, LogOut, Shield, BookOpen, ScrollText, History, TrendingUp, Building2, MoreHorizontal } from 'lucide-react';
import MoreMenuSheet, { type MoreMenuGroup } from './MoreMenuSheet';
import { useAuth } from '@/lib/auth-context';
import { useViewMode } from '@/lib/view-mode-context';
import ViewModeToggle from './ViewModeToggle';
import { useTheme } from '@/lib/theme-context';
import { Sun, Moon } from 'lucide-react';
import TrainingStatusBanner from './TrainingStatusBanner';

const menu = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/users', label: 'จัดการผู้ใช้', icon: Users },
  { to: '/admin/course-overview', label: 'ภาพรวมวิชา', icon: Building2 },
  { to: '/admin/courses', label: 'รายวิชา', icon: BookOpen },
  { to: '/admin/datasets', label: 'Dataset ใบหน้า', icon: Database },
  { to: '/admin/training', label: 'เทรนโมเดล', icon: Brain },
  { to: '/admin/training-history', label: 'ประวัติเทรน', icon: History },
  { to: '/admin/analytics', label: 'กราฟเทรน', icon: TrendingUp },
  { to: '/admin/logs', label: 'Audit Log', icon: ScrollText },
];

/** สี่แท็บที่ใช้บ่อยที่สุดของผู้ดูแลระบบ ที่เหลือย้ายไปอยู่ในแผ่น "เพิ่มเติม"
 *  แถบล่างบนจอ 390px ใส่ได้ห้าช่อง ช่องละ 78px โดยตัวหนังสือยังไม่เล็กกว่า 11px */
const adminBottomTabs = [
  { to: '/admin', label: 'ภาพรวม', icon: LayoutDashboard },
  { to: '/admin/users', label: 'ผู้ใช้', icon: Users },
  { to: '/admin/courses', label: 'รายวิชา', icon: BookOpen },
  { to: '/admin/datasets', label: 'ใบหน้า', icon: Database },
];

const adminMoreGroups: MoreMenuGroup[] = [
  {
    title: 'ผู้ใช้และรายวิชา',
    items: [
      { path: '/admin/course-overview', label: 'ภาพรวมวิชาทั้งมหาวิทยาลัย', icon: Building2 },
    ],
  },
  {
    title: 'การฝึกแบบจำลอง',
    items: [
      { path: '/admin/training', label: 'เทรนโมเดล', icon: Brain },
      { path: '/admin/training-history', label: 'ประวัติเทรน', icon: History },
      { path: '/admin/analytics', label: 'กราฟเทรน', icon: TrendingUp },
    ],
  },
  {
    title: 'การตรวจสอบระบบ',
    items: [
      { path: '/admin/logs', label: 'บันทึกการใช้งาน (Audit Log)', icon: ScrollText },
    ],
  },
];

/** เส้นทางที่อยู่ในแผ่นเพิ่มเติม ใช้ไฮไลต์แท็บ "เพิ่มเติม" เมื่ออยู่ในหน้าเหล่านั้น */
const adminMorePaths = adminMoreGroups.flatMap(g => g.items.map(i => i.path));

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { logout, user } = useAuth();
  const { isMobileView } = useViewMode();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/'); };

  // Mobile view → bottom nav
  if (isMobileView) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-20 bg-card/90 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-sm font-bold font-display text-foreground">Admin Panel</h1>
            <p className="text-[10px] text-muted-foreground">{user?.name}</p>
          </div>
          <ViewModeToggle />
          <button onClick={toggleTheme} className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={handleLogout} className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-destructive">
            <LogOut className="w-4 h-4" />
          </button>
        </header>
        <TrainingStatusBanner />
        <main className="flex-1 pb-20">{children}</main>
        {/* แถบล่าง 5 ช่องพอดีจอ ไม่มีการเลื่อนแนวนอน
            ของเดิมยัด 9 แท็บแล้วใช้ overflow-x-auto ตัวหนังสือเล็กจนอ่านไม่ออก
            และผู้ใช้ไม่รู้ว่ายังมีแท็บซ่อนอยู่ทางขวา */}
        <nav className="fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-xl border-t border-border safe-bottom z-30">
          <div className="grid grid-cols-5">
            {adminBottomTabs.map(m => {
              const active = pathname === m.to;
              return (
                <NavLink key={m.to} to={m.to}
                  className="flex flex-col items-center gap-1 py-2.5 px-1 min-w-0">
                  <m.icon className={`w-5 h-5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-[11px] font-medium leading-none truncate max-w-full ${
                    active ? 'text-primary' : 'text-muted-foreground'
                  }`}>{m.label}</span>
                </NavLink>
              );
            })}
            <button onClick={() => setMoreOpen(true)}
              className="flex flex-col items-center gap-1 py-2.5 px-1 min-w-0">
              <MoreHorizontal className={`w-5 h-5 shrink-0 ${
                adminMorePaths.includes(pathname) || moreOpen ? 'text-primary' : 'text-muted-foreground'
              }`} />
              <span className={`text-[11px] font-medium leading-none truncate max-w-full ${
                adminMorePaths.includes(pathname) || moreOpen ? 'text-primary' : 'text-muted-foreground'
              }`}>เพิ่มเติม</span>
            </button>
          </div>
        </nav>

        <MoreMenuSheet open={moreOpen} groups={adminMoreGroups}
          currentPath={pathname} onClose={() => setMoreOpen(false)} />
      </div>
    );
  }

  // Desktop view → sidebar
  //
  // ของเดิมใช้ min-h-screen กับตัวครอบ และ aside ไม่มีความสูงของตัวเอง
  // เมนูจึงยืดตามความสูงของ "เนื้อหา" ไม่ใช่ของหน้าจอ หน้าที่เนื้อหายาวเมนูจะ
  // เลื่อนหายไปกับเนื้อหา ส่วนหน้าที่เนื้อหาสั้นก็เหลือพื้นที่ว่างใต้เมนู
  //
  // แก้เป็น h-screen + overflow-hidden ที่ตัวครอบ แล้วให้ทั้ง aside และ main
  // เลื่อนภายในตัวเอง เมนูจึงสูงเต็มจอเสมอไม่ว่าเนื้อหาจะยาวแค่ไหน
  return (
    <div className="h-screen overflow-hidden bg-background flex w-full">
      <aside className="w-64 h-full shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-5 border-b border-sidebar-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-bold font-display text-sidebar-foreground">Admin Panel</h1>
            <p className="text-[10px] text-muted-foreground">RMUTL SmartAttend</p>
          </div>
        </div>
        {/* flex-1 + overflow-y-auto: ถ้ารายการเมนูยาวเกินจอ ให้เลื่อนในเมนูเอง
            โดยที่หัวเมนูกับบล็อกออกจากระบบยังอยู่กับที่ */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          {menu.map(m => {
            const active = pathname === m.to;
            return (
              <NavLink
                key={m.to}
                to={m.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-card'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent'
                }`}
              >
                <m.icon className="w-4 h-4" />
                <span className="text-sm font-medium">{m.label}</span>
              </NavLink>
            );
          })}
        </nav>
        {/* shrink-0 กันไม่ให้บล็อกนี้ถูกบีบเมื่อเมนูยาว จึงติดขอบล่างเสมอ */}
        <div className="shrink-0 p-3 border-t border-sidebar-border">
          <div className="px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-sidebar-foreground">{user?.name}</p>
            <p className="text-[10px]">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-colors"
          >
            <LogOut className="w-4 h-4" /> ออกจากระบบ
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 border-b border-border bg-card/50 backdrop-blur-xl flex items-center justify-end gap-2 px-6">
          <ViewModeToggle />
          <button onClick={toggleTheme} className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>
        <TrainingStatusBanner />
        {/* min-h-0 จำเป็นกับ flex child ที่ต้อง scroll ไม่งั้นมันจะยืดตามเนื้อหา
            แทนที่จะเลื่อนภายใน */}
        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
