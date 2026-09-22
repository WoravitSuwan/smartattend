import React, { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useNotifications } from '@/lib/notification-context';
import { Home, BookOpen, User, ClipboardList, LogOut, Sun, Moon, FileText, Bell, X, CheckCheck, CalendarOff, Upload, Users, Camera, ShieldCheck, Trash2, BellOff } from 'lucide-react';
import { useViewMode } from '@/lib/view-mode-context';
import ViewModeToggle from '@/components/ViewModeToggle';
import rmutlCrest from '@/assets/rmutl-crest.png';
import { motion, AnimatePresence } from 'framer-motion';

interface MobileLayoutProps {
  children: ReactNode;
  title?: string;
}

const studentTabs = [
  { path: '/student', icon: Home, label: 'Home' },
  { path: '/student/courses', icon: BookOpen, label: 'Courses' },
  { path: '/student/assignments', icon: FileText, label: 'งาน' },
  { path: '/student/leaves', icon: CalendarOff, label: 'ลาเรียน' },
  { path: '/student/my-status', icon: ShieldCheck, label: 'สถานะ' },
  { path: '/student/profile', icon: User, label: 'Profile' },
];

const instructorTabs = [
  { path: '/instructor', icon: Home, label: 'Home' },
  { path: '/instructor/courses', icon: BookOpen, label: 'Courses' },
  { path: '/instructor/attendance', icon: ClipboardList, label: 'Attend' },
  { path: '/instructor/grading', icon: FileText, label: 'ตรวจงาน' },
  { path: '/instructor/profile', icon: User, label: 'Profile' },
];

const instructorSidebarExtras = [
  { path: '/instructor/import-roster', icon: Upload, label: 'Import รายชื่อ' },
  { path: '/instructor/roster', icon: Users, label: 'รายชื่อในวิชา' },
  { path: '/instructor/class-test', icon: Camera, label: 'เช็คชื่อเข้าเรียน' },
];

const typeIcon: Record<string, string> = {
  assignment_posted: '📝',
  submission_received: '📩',
  grade_received: '🏆',
  deadline_approaching: '⏰',
  course_invite: '🎓',
  class_started: '📷',
  class_cancelled: '🚫',
  student_checked_in: '✅',
  leave_submitted: '📄',
  leave_approved: '✅',
  leave_rejected: '❌',
  grade_announced: '🏆',
  training_failed: '⚠️',
  grade_posted: '🏆',
  attendance_warning: '⚠️',
  attendance_blocked: '🚫',
};


function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'เมื่อสักครู่';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชม.ที่แล้ว`;
  return `${Math.floor(diff / 86400)} วันที่แล้ว`;
}

const MobileLayout = ({ children, title }: MobileLayoutProps) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notifications, markAsRead, markAllAsRead, clearAll, deleteNotification, courseInvites, acceptCourseInvite, declineCourseInvite } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobileView } = useViewMode();
  const tabs = user?.role === 'instructor' ? instructorTabs : studentTabs;
  const sidebarTabs = user?.role === 'instructor' ? [...instructorTabs, ...instructorSidebarExtras] : studentTabs;
  const [showNotifications, setShowNotifications] = useState(false);

  const myNotifications = notifications
    .filter(n => n.userId === user?.id)
    .slice(0, 20);
  const myUnread = myNotifications.filter(n => !n.read).length;

  const handleClearAll = () => {
    if (window.confirm('ลบการแจ้งเตือนทั้งหมด?')) clearAll();
  };

  const renderNotificationCard = (n: typeof myNotifications[number], i: number, useMotion: boolean) => {
    const isInvite = n.type === 'course_invite' && n.actionRequired && n.status !== 'actioned';
    const isCheckedIn = n.type === 'student_checked_in' && !!n.relatedId;
    const meta = n.relatedId ? courseInvites[n.relatedId] : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Wrapper: any = useMotion ? motion.div : 'div';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapperProps: any = useMotion
      ? {
          initial: { opacity: 0, x: -8 },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -80 },
          transition: { delay: i * 0.03 },
          drag: 'x' as const,
          dragConstraints: { left: 0, right: 0 },
          dragElastic: { left: 0.6, right: 0 },
          onDragEnd: (_e: unknown, info: { offset: { x: number } }) => {
            if (info.offset.x < -80) deleteNotification(n.id);
          },
        }
      : {};
    return (
      <Wrapper
        key={n.id}
        {...wrapperProps}
        className={`relative w-full text-left px-4 py-3 border-b border-border/30 transition-colors ${!n.read ? 'bg-primary/5' : ''}`}
      >
        <button
          type="button"
          aria-label="ลบการแจ้งเตือน"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); deleteNotification(n.id); }}
          className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            markAsRead(n.id);
            if (isCheckedIn) {
              setShowNotifications(false);
              navigate(`/instructor/attendance?session=${n.relatedId}`);
              return;
            }
            if (!isInvite && n.link) { navigate(n.link); setShowNotifications(false); }
          }}
          className="w-full text-left flex gap-3 items-start hover:opacity-90 pr-8"
        >
          <span className="text-lg mt-0.5">{typeIcon[n.type] || '🔔'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`text-xs font-semibold ${!n.read ? 'text-foreground' : 'text-muted-foreground'}`}>{n.title}</p>
              {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
            {isInvite && meta && (
              <p className="text-[11px] text-foreground/80 mt-1 font-medium">
                {meta.code} — {meta.name}{meta.section ? ` (ตอน ${meta.section})` : ''}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.createdAt)}</p>
          </div>
        </button>
        {isInvite && (
          <div className="flex gap-2 mt-2 pl-8">
            <button
              onClick={() => acceptCourseInvite(n)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90"
            >
              ยืนยันเข้าร่วม
            </button>
            <button
              onClick={() => declineCourseInvite(n)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-muted text-foreground text-[11px] font-semibold hover:bg-muted/70"
            >
              ปฏิเสธ
            </button>
          </div>
        )}
      </Wrapper>
    );
  };



  if (!isMobileView) {
    // ═══════ RESPONSIVE LAYOUT (mobile bottom-tabs → md icon sidebar → lg full sidebar) ═══════
    return (
      <div className="min-h-screen brand-surface flex">
        {/* Sidebar — hidden on mobile, icon-only md, full lg+ */}
        <aside className="hidden md:flex md:w-16 lg:w-64 bg-card border-r border-border/50 flex-col sticky top-0 h-screen">
          <div className="px-3 lg:px-5 py-4 border-b border-border/50">
            <div className="flex items-center gap-3 justify-center lg:justify-start">
              <img src={rmutlCrest} alt="" className="w-9 h-9 object-contain shrink-0" />
              <div className="hidden lg:block min-w-0">
                <h2 className="text-lg font-extrabold font-display text-gradient-primary leading-tight">SmartAttend</h2>
                <p className="text-xs text-muted-foreground truncate">{user?.name}</p>
              </div>
            </div>
            <div className="gold-rule mt-3 rounded-full opacity-70 hidden lg:block" />
          </div>
          <nav className="flex-1 py-3 px-2 lg:px-3 space-y-1 overflow-y-auto">
            {sidebarTabs.map((tab) => {
              const isActive = tab.path === location.pathname;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.path}
                  onClick={() => navigate(tab.path)}
                  title={tab.label}
                  className={`w-full flex items-center gap-3 px-2 lg:px-3 py-2.5 rounded-xl text-sm font-medium transition-colors justify-center lg:justify-start ${
                    isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="hidden lg:inline truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="px-2 lg:px-3 py-3 border-t border-border/50">
            <div className="flex items-center gap-2 flex-col lg:flex-row">
              <div className="hidden lg:block"><ViewModeToggle /></div>
              <button onClick={toggleTheme} title="Theme" className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button onClick={() => { logout(); navigate('/'); }} title="Logout" className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-h-screen min-w-0">
          <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50">
            <div className="flex items-center justify-between px-4 md:px-6 py-3">
              <h1 className="text-lg md:text-xl font-bold font-display text-foreground truncate">{title || 'Dashboard'}</h1>
              <div className="flex items-center gap-2">
                <div className="md:hidden"><ViewModeToggle /></div>
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative w-9 h-9 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card"
                >
                  <Bell className="w-4 h-4" />
                  {myUnread > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {myUnread > 9 ? '9+' : myUnread}
                    </span>
                  )}
                </button>
                <button onClick={toggleTheme} className="md:hidden w-9 h-9 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card">
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button onClick={() => { logout(); navigate('/'); }} className="md:hidden w-9 h-9 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          {/* Notification Panel (responsive) */}
          <AnimatePresence>
            {showNotifications && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-foreground/10" onClick={() => setShowNotifications(false)} />
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="fixed top-14 right-2 left-2 md:left-auto md:right-6 z-50 md:w-96 bg-card rounded-2xl shadow-elevated max-h-[70vh] flex flex-col overflow-hidden border border-border/50">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                    <h3 className="text-sm font-bold text-foreground">แจ้งเตือน</h3>
                    <div className="flex items-center gap-2">
                      {myUnread > 0 && (
                        <button onClick={markAllAsRead} className="flex items-center gap-1 text-[10px] text-primary font-medium">
                          <CheckCheck className="w-3 h-3" /> อ่านทั้งหมด
                        </button>
                      )}
                      {myNotifications.length > 0 && (
                        <button onClick={handleClearAll} className="flex items-center gap-1 text-[10px] text-destructive font-medium">
                          <Trash2 className="w-3 h-3" /> ล้างทั้งหมด
                        </button>
                      )}
                      <button onClick={() => setShowNotifications(false)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {myNotifications.length === 0 ? (
                      <div className="py-10 text-center">
                        <BellOff className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">ไม่มีการแจ้งเตือน</p>
                      </div>
                    ) : (
                      myNotifications.map((n, i) => renderNotificationCard(n, i, false))
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
            <div className="mx-auto w-full max-w-lg md:max-w-4xl lg:max-w-6xl xl:max-w-7xl">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile bottom tabs — shown only under md */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-xl border-t border-border/50 safe-bottom shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-around px-2 py-2 max-w-lg mx-auto">
            {tabs.map((tab) => {
              const isActive = tab.path === location.pathname;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.path}
                  onClick={() => navigate(tab.path)}
                  className={`press relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {isActive && (
                    <motion.div layoutId="tab-indicator-resp"
                      className="absolute inset-0 rounded-2xl bg-primary/10 border border-primary/20" />
                  )}
                  <Icon className="w-5 h-5 relative" />
                  <span className="text-[10px] font-semibold relative">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    );
  }


  // ═══════ MOBILE LAYOUT ═══════
  return (
    <div className="min-h-screen brand-surface flex flex-col max-w-lg mx-auto relative">
      {/* Header */}
      <header className="safe-top sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src={rmutlCrest} alt="" className="w-8 h-8 object-contain shrink-0" />
            <div className="min-w-0">
              {title && <h1 className="text-lg font-bold font-display text-foreground truncate">{title}</h1>}
              {!title && (
                <>
                  <p className="text-[11px] text-muted-foreground">ยินดีต้อนรับ</p>
                  <h1 className="text-lg font-bold font-display text-foreground truncate">{user?.name}</h1>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ViewModeToggle />
            {/* Notification Bell */}
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative w-9 h-9 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card"
            >
              <Bell className="w-4 h-4" />
              {myUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {myUnread > 9 ? '9+' : myUnread}
                </span>
              )}
            </button>
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => { logout(); navigate('/'); }}
              className="w-9 h-9 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Notification Panel */}
      <AnimatePresence>
        {showNotifications && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-foreground/20"
              onClick={() => setShowNotifications(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="absolute top-14 right-2 left-2 z-50 bg-card rounded-2xl shadow-elevated max-h-[70vh] flex flex-col overflow-hidden border border-border/50"
            >
              {/* Panel Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                <h3 className="text-sm font-bold text-foreground">แจ้งเตือน</h3>
                <div className="flex items-center gap-2">
                  {myUnread > 0 && (
                    <button onClick={markAllAsRead} className="flex items-center gap-1 text-[10px] text-primary font-medium">
                      <CheckCheck className="w-3 h-3" /> อ่านทั้งหมด
                    </button>
                  )}
                  {myNotifications.length > 0 && (
                    <button onClick={handleClearAll} className="flex items-center gap-1 text-[10px] text-destructive font-medium">
                      <Trash2 className="w-3 h-3" /> ล้างทั้งหมด
                    </button>
                  )}
                  <button onClick={() => setShowNotifications(false)} className="text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Notification List */}
              <div className="overflow-y-auto flex-1">
                {myNotifications.length === 0 ? (
                  <div className="py-10 text-center">
                    <BellOff className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">ไม่มีการแจ้งเตือน</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {myNotifications.map((n, i) => renderNotificationCard(n, i, true))}
                  </AnimatePresence>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-30 bg-card/95 backdrop-blur-xl border-t border-border/50 safe-bottom shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-around px-2 py-2">
          {tabs.map((tab) => {
            const isActive = tab.path === location.pathname;
            const Icon = tab.icon;
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className={`press relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute inset-0 rounded-2xl bg-primary/10 border border-primary/20"
                  />
                )}
                <Icon className="w-5 h-5 relative" />
                <span className="text-[10px] font-semibold relative">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default MobileLayout;
