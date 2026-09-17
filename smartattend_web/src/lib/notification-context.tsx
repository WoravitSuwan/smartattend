import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';

export type NotificationType =
  | 'assignment_posted'
  | 'submission_received'
  | 'grade_received'
  | 'deadline_approaching'
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_rejected'
  | 'grade_announced'
  | 'training_failed'
  | 'course_invite'
  | string;

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
  link?: string;
  actionRequired?: boolean;
  relatedId?: string | null;
  status?: string; // 'unread' | 'read' | 'actioned'
}

export interface CourseInviteMeta {
  code: string;
  name: string;
  section?: string | null;
  semester?: string | null;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, 'id' | 'read' | 'createdAt'>) => void;
  addNotifications: (list: Omit<Notification, 'id' | 'read' | 'createdAt'>[]) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  courseInvites: Record<string, CourseInviteMeta>;
  acceptCourseInvite: (n: Notification) => Promise<void>;
  declineCourseInvite: (n: Notification) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

// Preserved for potential rollback to mock data.
// function generateMockNotifications(): Notification[] {
//   const now = new Date();
//   return [
//     { id: 'N1', userId: 'S1', type: 'assignment_posted', title: 'งานใหม่', message: 'อ.ธนิต โพสต์งาน "Design Patterns Workshop" ใน ENGSE207', read: false, createdAt: new Date(now.getTime() - 1000 * 60 * 30), link: '/student/assignments' },
//     // ... (see git history for the rest)
//   ];
// }

let _seq = 0;
const genId = () => `N-local-${Date.now()}-${++_seq}`;

function mapRow(row: {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  status: string;
  action_required: boolean;
  related_id: string | null;
  created_at: string;
}): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.body ?? '',
    read: row.status !== 'unread',
    createdAt: new Date(row.created_at),
    actionRequired: row.action_required,
    relatedId: row.related_id,
    status: row.status,
  };
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [courseInvites, setCourseInvites] = useState<Record<string, CourseInviteMeta>>({});

  const loadCourseMeta = useCallback(async (courseIds: string[]) => {
    const ids = Array.from(new Set(courseIds)).filter(Boolean);
    if (!ids.length) return;
    const { data } = await supabase
      .from('courses')
      .select('id, code, name, section, semester')
      .in('id', ids);
    if (!data) return;
    setCourseInvites(prev => {
      const next = { ...prev };
      for (const c of data) {
        next[c.id] = { code: c.code, name: c.name, section: c.section, semester: c.semester };
      }
      return next;
    });
  }, []);

  // Load from DB + subscribe to realtime whenever user changes.
  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, user_id, type, title, body, status, action_required, related_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (error) {
        console.error('load notifications failed', error);
        return;
      }
      const mapped = (data ?? []).map(mapRow);
      setNotifications(mapped);
      const inviteCourseIds = mapped
        .filter(n => n.type === 'course_invite' && n.relatedId)
        .map(n => n.relatedId as string);
      loadCourseMeta(inviteCourseIds);
    })();

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as Parameters<typeof mapRow>[0];
          const n = mapRow(row);
          setNotifications(prev => (prev.some(x => x.id === n.id) ? prev : [n, ...prev]));
          if (n.type === 'course_invite' && n.relatedId) loadCourseMeta([n.relatedId]);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = mapRow(payload.new as Parameters<typeof mapRow>[0]);
          setNotifications(prev => prev.map(x => (x.id === n.id ? n : x)));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const id = (payload.old as { id: string }).id;
          setNotifications(prev => prev.filter(x => x.id !== id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id, loadCourseMeta]);

  const addNotification = useCallback((n: Omit<Notification, 'id' | 'read' | 'createdAt'>) => {
    setNotifications(prev => [{ ...n, id: genId(), read: false, createdAt: new Date() }, ...prev]);
  }, []);

  const addNotifications = useCallback((list: Omit<Notification, 'id' | 'read' | 'createdAt'>[]) => {
    if (!list.length) return;
    const now = new Date();
    setNotifications(prev => [
      ...list.map(n => ({ ...n, id: genId(), read: false, createdAt: now })),
      ...prev,
    ]);
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true, status: n.status === 'actioned' ? 'actioned' : 'read' } : n)));
    if (!id.startsWith('N-local-')) {
      await supabase.from('notifications').update({ status: 'read' }).eq('id', id).eq('status', 'unread');
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true, status: n.status === 'actioned' ? 'actioned' : 'read' })));
    if (user?.id) {
      await supabase.from('notifications').update({ status: 'read' }).eq('user_id', user.id).eq('status', 'unread');
    }
  }, [user?.id]);

  const clearAll = useCallback(async () => {
    if (!user?.id) return;
    const { error } = await supabase.from('notifications').delete().eq('user_id', user.id);
    if (error) {
      console.error('clear notifications failed', error);
      return;
    }
    setNotifications([]);
  }, [user?.id]);

  const deleteNotification = useCallback(async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (!id.startsWith('N-local-')) {
      const { error } = await supabase.from('notifications').delete().eq('id', id);
      if (error) console.error('delete notification failed', error);
    }
  }, []);


  const setActioned = useCallback(async (n: Notification) => {
    setNotifications(prev => prev.map(x => (x.id === n.id ? { ...x, read: true, status: 'actioned', actionRequired: false } : x)));
    if (!n.id.startsWith('N-local-')) {
      await supabase.from('notifications').update({ status: 'actioned' }).eq('id', n.id);
    }
  }, []);

  const acceptCourseInvite = useCallback(async (n: Notification) => {
    if (!user?.id || !n.relatedId) return;
    const { error } = await supabase
      .from('course_enrollments')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('course_id', n.relatedId)
      .eq('student_id', user.id);
    if (error) {
      console.error('accept course invite failed', error);
      return;
    }
    await setActioned(n);
  }, [user?.id, setActioned]);

  const declineCourseInvite = useCallback(async (n: Notification) => {
    if (!user?.id || !n.relatedId) return;
    const { error } = await supabase
      .from('course_enrollments')
      .update({ status: 'declined' })
      .eq('course_id', n.relatedId)
      .eq('student_id', user.id);
    if (error) {
      console.error('decline course invite failed', error);
      return;
    }
    await setActioned(n);
  }, [user?.id, setActioned]);

  const unreadCount = notifications.filter(n => (n.status ? n.status === 'unread' : !n.read)).length;

  return (
    <NotificationContext.Provider value={{
      notifications, unreadCount,
      addNotification, addNotifications,
      markAsRead, markAllAsRead, clearAll, deleteNotification,
      courseInvites, acceptCourseInvite, declineCourseInvite,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
