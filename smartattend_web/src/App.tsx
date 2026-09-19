import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Routes, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import InstallAppBanner from "@/components/InstallAppBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import { NotificationProvider } from "@/lib/notification-context";
import { ViewModeProvider } from "@/lib/view-mode-context";
import {
  fetchMyRegStatus, getCurrentAuthUserId, subscribeRegStatuses,
  type RegistrationStatus,
} from "@/lib/registration-status";
import { supabase } from "@/integrations/supabase/client";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import StudentDashboard from "./pages/student/StudentDashboard";
import StudentCoursesPage from "./pages/student/StudentCoursesPage";
import AttendanceHistoryPage from "./pages/student/AttendanceHistoryPage";
import GradesPage from "./pages/student/GradesPage";
import StudentAnalyticsPage from "./pages/student/StudentAnalyticsPage";
import ProfilePage from "./pages/ProfilePage";
import InstructorDashboard from "./pages/instructor/InstructorDashboard";
import InstructorCoursesPage from "./pages/instructor/InstructorCoursesPage";
import InstructorAttendancePage from "./pages/instructor/InstructorAttendancePage";
import ManualAttendanceEditPage from "./pages/instructor/ManualAttendanceEditPage";
import AssignmentManagementPage from "./pages/instructor/AssignmentManagementPage";
import InstructorGradingPage from "./pages/instructor/InstructorGradingPage";
import GradeManagementPage from "./pages/instructor/GradeManagementPage";
import InstructorReportsPage from "./pages/instructor/InstructorReportsPage";
import ExportScoresPage from "./pages/instructor/ExportScoresPage";
import StudentAssignmentsPage from "./pages/student/StudentAssignmentsPage";
import StudentLeavePage from "./pages/student/StudentLeavePage";
import FaceRegistrationPage from "./pages/student/FaceRegistrationPage";
import WaitingApprovalPage from "./pages/student/WaitingApprovalPage";
import CompleteProfilePage from "./pages/student/CompleteProfilePage";
import MyStatusPage from "./pages/student/MyStatusPage";
import InstructorWaitingApprovalPage from "./pages/instructor/InstructorWaitingApprovalPage";
import InstructorLeavesPage from "./pages/instructor/InstructorLeavesPage";
import FaceRegistrationStatusPage from "./pages/instructor/FaceRegistrationStatusPage";
import ImportRosterPage from "./pages/instructor/ImportRosterPage";
import CourseRosterPage from "./pages/instructor/CourseRosterPage";
import StartClassTestPage from "./pages/instructor/StartClassTestPage";
import NotFound from "./pages/NotFound";
import AdminLayout from "./components/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsersPage from "./pages/admin/AdminUsersPage";
import AdminDatasetsPage from "./pages/admin/AdminDatasetsPage";
import AdminTrainingPage from "./pages/admin/AdminTrainingPage";
import AdminAuditLogPage from "./pages/admin/AdminAuditLogPage";
import AdminCoursesPage from "./pages/admin/AdminCoursesPage";
import AdminTrainingHistoryPage from "./pages/admin/AdminTrainingHistoryPage";
import AdminTrainingAnalyticsPage from "./pages/admin/AdminTrainingAnalyticsPage";
import AdminCourseOverviewPage from "./pages/admin/AdminCourseOverviewPage";

const queryClient = new QueryClient();

function ProtectedRoute({ children, role }: { children: React.ReactNode; role?: string }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (role && user?.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Blocks students from the main app until admin marks training_success.
 *  Allowed paths while pending: /student/waiting, /student/face-register. */
function StudentGate({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [status, setStatus] = useState<RegistrationStatus | null | 'loading'>('loading');
  const [profileCompleted, setProfileCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'student') { setStatus(null); return; }
    let alive = true;
    let unsub: (() => void) | null = null;
    (async () => {
      const uid = await getCurrentAuthUserId();
      if (!uid) { if (alive) setStatus(null); return; }
      const [s, prof] = await Promise.all([
        fetchMyRegStatus(uid).catch(() => null),
        supabase.from('profiles').select('profile_completed_at').eq('user_id', uid).maybeSingle(),
      ]);
      if (!alive) return;
      setStatus(s);
      setProfileCompleted(!!prof.data?.profile_completed_at);
      unsub = subscribeRegStatuses(async () => {
        const fresh = await fetchMyRegStatus(uid).catch(() => null);
        if (alive) setStatus(fresh);
      }, uid);
    })();
    return () => { alive = false; unsub?.(); };
  }, [isAuthenticated, user?.role, user?.id, user?.profileCompletedAt]);

  if (user?.role !== 'student') return <>{children}</>;
  if (status === 'loading' || profileCompleted === null) return null;

  const approved = status?.status === 'training_success';
  const allowedWhilePending = pathname === '/student/waiting' || pathname === '/student/face-register';

  if (!approved && !allowedWhilePending) return <Navigate to="/student/waiting" replace />;
  if (approved && pathname === '/student/waiting') return <Navigate to="/student" replace />;

  // After training success, force profile completion (allow profile pages themselves)
  if (approved && !profileCompleted && pathname !== '/student/complete-profile' && pathname !== '/student/profile') {
    return <Navigate to="/student/complete-profile" replace />;
  }
  if (approved && profileCompleted && pathname === '/student/complete-profile') {
    return <Navigate to="/student" replace />;
  }
  return <>{children}</>;
}

function roleHome(role?: string) {
  if (role === 'admin') return '/admin';
  if (role === 'instructor') return '/instructor';
  if (role === 'pending_instructor') return '/instructor/waiting';
  return '/student';
}

function AppRoutes() {
  const { isAuthenticated, user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/" element={
        loading
          ? null
          : isAuthenticated
            ? <Navigate to={roleHome(user?.role)} replace />
            : <LoginPage />
      } />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/instructor/waiting" element={<ProtectedRoute role="pending_instructor"><InstructorWaitingApprovalPage /></ProtectedRoute>} />
      {/* Admin Routes */}
      <Route path="/admin" element={<ProtectedRoute role="admin"><AdminLayout><AdminDashboard /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute role="admin"><AdminLayout><AdminUsersPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/courses" element={<ProtectedRoute role="admin"><AdminLayout><AdminCoursesPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/datasets" element={<ProtectedRoute role="admin"><AdminLayout><AdminDatasetsPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/training" element={<ProtectedRoute role="admin"><AdminLayout><AdminTrainingPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/training-history" element={<ProtectedRoute role="admin"><AdminLayout><AdminTrainingHistoryPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/analytics" element={<ProtectedRoute role="admin"><AdminLayout><AdminTrainingAnalyticsPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/logs" element={<ProtectedRoute role="admin"><AdminLayout><AdminAuditLogPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/course-overview" element={<ProtectedRoute role="admin"><AdminLayout><AdminCourseOverviewPage /></AdminLayout></ProtectedRoute>} />
      <Route path="/admin/course-roster/:courseId" element={<ProtectedRoute role="admin"><AdminLayout><CourseRosterPage /></AdminLayout></ProtectedRoute>} />
      {/* Student Routes — all wrapped in StudentGate */}
      <Route path="/student/waiting" element={<ProtectedRoute role="student"><StudentGate><WaitingApprovalPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/complete-profile" element={<ProtectedRoute role="student"><StudentGate><CompleteProfilePage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/face-register" element={<ProtectedRoute role="student"><StudentGate><FaceRegistrationPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student" element={<ProtectedRoute role="student"><StudentGate><StudentDashboard /></StudentGate></ProtectedRoute>} />
      <Route path="/student/courses" element={<ProtectedRoute role="student"><StudentGate><StudentCoursesPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/history" element={<ProtectedRoute role="student"><StudentGate><AttendanceHistoryPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/grades" element={<ProtectedRoute role="student"><StudentGate><GradesPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/assignments" element={<ProtectedRoute role="student"><StudentGate><StudentAssignmentsPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/leaves" element={<ProtectedRoute role="student"><StudentGate><StudentLeavePage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/analytics" element={<ProtectedRoute role="student"><StudentGate><StudentAnalyticsPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/my-status" element={<ProtectedRoute role="student"><StudentGate><MyStatusPage /></StudentGate></ProtectedRoute>} />
      <Route path="/student/profile" element={<ProtectedRoute role="student"><StudentGate><ProfilePage /></StudentGate></ProtectedRoute>} />
      {/* Instructor Routes */}
      <Route path="/instructor" element={<ProtectedRoute role="instructor"><InstructorDashboard /></ProtectedRoute>} />
      <Route path="/instructor/courses" element={<ProtectedRoute role="instructor"><InstructorCoursesPage /></ProtectedRoute>} />
      <Route path="/instructor/attendance" element={<ProtectedRoute role="instructor"><InstructorAttendancePage /></ProtectedRoute>} />
      <Route path="/instructor/attendance/edit" element={<ProtectedRoute role="instructor"><ManualAttendanceEditPage /></ProtectedRoute>} />
      <Route path="/instructor/assignments" element={<ProtectedRoute role="instructor"><AssignmentManagementPage /></ProtectedRoute>} />
      <Route path="/instructor/grading" element={<ProtectedRoute role="instructor"><InstructorGradingPage /></ProtectedRoute>} />
      <Route path="/instructor/grades" element={<ProtectedRoute role="instructor"><GradeManagementPage /></ProtectedRoute>} />
      <Route path="/instructor/reports" element={<ProtectedRoute role="instructor"><InstructorReportsPage /></ProtectedRoute>} />
      <Route path="/instructor/export" element={<ProtectedRoute role="instructor"><ExportScoresPage /></ProtectedRoute>} />
      <Route path="/instructor/leaves" element={<ProtectedRoute role="instructor"><InstructorLeavesPage /></ProtectedRoute>} />
      <Route path="/instructor/face-status" element={<ProtectedRoute role="instructor"><FaceRegistrationStatusPage /></ProtectedRoute>} />
      <Route path="/instructor/import-roster" element={<ProtectedRoute role="instructor"><ImportRosterPage /></ProtectedRoute>} />
      <Route path="/instructor/roster" element={<ProtectedRoute role="instructor"><CourseRosterPage /></ProtectedRoute>} />
      <Route path="/instructor/profile" element={<ProtectedRoute role="instructor"><ProfilePage /></ProtectedRoute>} />
      <Route path="/instructor/class-test" element={<ProtectedRoute role="instructor"><StartClassTestPage /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <NotificationProvider>
    <ViewModeProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <AppRoutes />
            <InstallAppBanner />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ViewModeProvider>
  </NotificationProvider>
);

export default App;
