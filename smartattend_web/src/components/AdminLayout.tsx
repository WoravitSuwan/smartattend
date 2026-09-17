import { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Database, Brain, LogOut, Shield, BookOpen, ScrollText, History, TrendingUp, Building2 } from 'lucide-react';
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

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { logout, user } = useAuth();
  const { isMobileView } = useViewMode();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();

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
        <nav className="fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-xl border-t border-border safe-bottom z-30">
          <div className="flex overflow-x-auto no-scrollbar">
            {menu.map(m => {
              const active = pathname === m.to;
              return (
                <NavLink key={m.to} to={m.to} className="flex flex-col items-center gap-1 py-2.5 px-4 min-w-[72px] shrink-0">
                  <m.icon className={`w-5 h-5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-[10px] font-medium whitespace-nowrap ${active ? 'text-primary' : 'text-muted-foreground'}`}>{m.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>
    );
  }

  // Desktop view → sidebar
  return (
    <div className="min-h-screen bg-background flex w-full">
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-5 border-b border-sidebar-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-bold font-display text-sidebar-foreground">Admin Panel</h1>
            <p className="text-[10px] text-muted-foreground">RMUTL SmartAttend</p>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
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
        <div className="p-3 border-t border-sidebar-border">
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
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b border-border bg-card/50 backdrop-blur-xl flex items-center justify-end gap-2 px-6">
          <ViewModeToggle />
          <button onClick={toggleTheme} className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>
        <TrainingStatusBanner />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
