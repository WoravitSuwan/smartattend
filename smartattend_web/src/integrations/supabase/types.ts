export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assignment_submissions: {
        Row: {
          assignment_id: string
          content: string | null
          feedback: string | null
          file_path: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          score: number | null
          status: string
          student_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          assignment_id: string
          content?: string | null
          feedback?: string | null
          file_path?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          score?: number | null
          status?: string
          student_id: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          content?: string | null
          feedback?: string | null
          file_path?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          score?: number | null
          status?: string
          student_id?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          course_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          max_score: number
          title: string
          updated_at: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          course_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          max_score?: number
          title: string
          updated_at?: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          course_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          max_score?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          checked_in_at: string | null
          confidence: number | null
          edit_reason: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          photo_data_url: string | null
          session_id: string
          status: string
          student_id: string
        }
        Insert: {
          checked_in_at?: string | null
          confidence?: number | null
          edit_reason?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          photo_data_url?: string | null
          session_id: string
          status?: string
          student_id: string
        }
        Update: {
          checked_in_at?: string | null
          confidence?: number | null
          edit_reason?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          photo_data_url?: string | null
          session_id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          after: Json | null
          before: Json | null
          created_at: string
          detail: string | null
          id: string
          ip: string | null
          reason: string | null
          target: string | null
          target_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          detail?: string | null
          id?: string
          ip?: string | null
          reason?: string | null
          target?: string | null
          target_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          detail?: string | null
          id?: string
          ip?: string | null
          reason?: string | null
          target?: string | null
          target_id?: string | null
        }
        Relationships: []
      }
      class_sessions: {
        Row: {
          closed_at: string | null
          course_id: string
          id: string
          instructor_id: string
          late_after_minutes: number
          planned_end_time: string | null
          started_at: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          course_id: string
          id?: string
          instructor_id: string
          late_after_minutes?: number
          planned_end_time?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          course_id?: string
          id?: string
          instructor_id?: string
          late_after_minutes?: number
          planned_end_time?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_sessions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_enrollments: {
        Row: {
          confirmed_at: string | null
          course_id: string
          created_at: string
          id: string
          status: string
          student_code_raw: string
          student_id: string | null
          student_name_raw: string
        }
        Insert: {
          confirmed_at?: string | null
          course_id: string
          created_at?: string
          id?: string
          status?: string
          student_code_raw: string
          student_id?: string | null
          student_name_raw: string
        }
        Update: {
          confirmed_at?: string | null
          course_id?: string
          created_at?: string
          id?: string
          status?: string
          student_code_raw?: string
          student_id?: string | null
          student_name_raw?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string
          created_at: string
          id: string
          instructor_id: string
          name: string
          section: string
          semester: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          instructor_id: string
          name: string
          section?: string
          semester?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          instructor_id?: string
          name?: string
          section?: string
          semester?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      device_heartbeats: {
        Row: {
          device_code: string
          room: string | null
          seen_at: string
        }
        Insert: {
          device_code: string
          room?: string | null
          seen_at?: string
        }
        Update: {
          device_code?: string
          room?: string | null
          seen_at?: string
        }
        Relationships: []
      }
      face_images: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          image_data: string
          kind: string
          pose: string
          pose_label: string | null
          student_code: string | null
          student_id: string
          student_name: string
          user_id: string | null
          variant: number
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          image_data: string
          kind?: string
          pose: string
          pose_label?: string | null
          student_code?: string | null
          student_id: string
          student_name: string
          user_id?: string | null
          variant?: number
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          image_data?: string
          kind?: string
          pose?: string
          pose_label?: string | null
          student_code?: string | null
          student_id?: string
          student_name?: string
          user_id?: string | null
          variant?: number
        }
        Relationships: []
      }
      face_models: {
        Row: {
          class_map: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          model_path: string
          num_classes: number
          run_id: string
        }
        Insert: {
          class_map?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          model_path: string
          num_classes?: number
          run_id: string
        }
        Update: {
          class_map?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          model_path?: string
          num_classes?: number
          run_id?: string
        }
        Relationships: []
      }
      grade_items: {
        Row: {
          category: string
          course_id: string
          created_at: string
          id: string
          max_score: number
          name: string
          weight: number
        }
        Insert: {
          category: string
          course_id: string
          created_at?: string
          id?: string
          max_score?: number
          name: string
          weight?: number
        }
        Update: {
          category?: string
          course_id?: string
          created_at?: string
          id?: string
          max_score?: number
          name?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "grade_items_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          attachment_path: string | null
          course_id: string
          created_at: string
          id: string
          leave_date: string
          leave_type: string
          reason: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: string | null
          status: string
          student_id: string
        }
        Insert: {
          attachment_path?: string | null
          course_id: string
          created_at?: string
          id?: string
          leave_date: string
          leave_type: string
          reason: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string | null
          status?: string
          student_id: string
        }
        Update: {
          attachment_path?: string | null
          course_id?: string
          created_at?: string
          id?: string
          leave_date?: string
          leave_type?: string
          reason?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_required: boolean
          body: string | null
          created_at: string
          id: string
          related_id: string | null
          status: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_required?: boolean
          body?: string | null
          created_at?: string
          id?: string
          related_id?: string | null
          status?: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_required?: boolean
          body?: string | null
          created_at?: string
          id?: string
          related_id?: string | null
          status?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          email: string
          faculty: string | null
          name: string
          phone: string | null
          profile_completed_at: string | null
          student_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email: string
          faculty?: string | null
          name: string
          phone?: string | null
          profile_completed_at?: string | null
          student_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string
          faculty?: string | null
          name?: string
          phone?: string | null
          profile_completed_at?: string | null
          student_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      registration_statuses: {
        Row: {
          created_at: string
          failure_reason: string | null
          id: string
          status: string
          student_code: string | null
          student_name: string
          trained_at: string | null
          trained_run_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          status?: string
          student_code?: string | null
          student_name?: string
          trained_at?: string | null
          trained_run_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          status?: string
          student_code?: string | null
          student_name?: string
          trained_at?: string | null
          trained_run_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_requests: {
        Row: {
          created_at: string
          department: string | null
          id: string
          requested_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          id?: string
          requested_role: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          id?: string
          requested_role?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      student_courses: {
        Row: {
          code: string
          created_at: string
          credits: string | null
          id: string
          instructor: string | null
          name: string
          room: string | null
          schedule: string | null
          section: string | null
          source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          credits?: string | null
          id?: string
          instructor?: string | null
          name: string
          room?: string | null
          schedule?: string | null
          section?: string | null
          source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          credits?: string | null
          id?: string
          instructor?: string | null
          name?: string
          room?: string | null
          schedule?: string | null
          section?: string | null
          source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      student_grades: {
        Row: {
          grade_item_id: string
          id: string
          note: string | null
          score: number | null
          student_id: string
          updated_at: string
        }
        Insert: {
          grade_item_id: string
          id?: string
          note?: string | null
          score?: number | null
          student_id: string
          updated_at?: string
        }
        Update: {
          grade_item_id?: string
          id?: string
          note?: string | null
          score?: number | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_grades_grade_item_id_fkey"
            columns: ["grade_item_id"]
            isOneToOne: false
            referencedRelation: "grade_items"
            referencedColumns: ["id"]
          },
        ]
      }
      training_runs: {
        Row: {
          batch_size: number | null
          created_at: string
          dataset_size: number | null
          embedding_value: number | null
          epochs: number | null
          final_acc: number | null
          final_loss: number | null
          final_val_acc: number | null
          finished_at: string | null
          id: string
          learning_rate: number | null
          metrics: Json
          name: string
          started_at: string
          status: string
          student_code: string | null
          student_id: string | null
          student_name: string | null
          trigger: string | null
        }
        Insert: {
          batch_size?: number | null
          created_at?: string
          dataset_size?: number | null
          embedding_value?: number | null
          epochs?: number | null
          final_acc?: number | null
          final_loss?: number | null
          final_val_acc?: number | null
          finished_at?: string | null
          id: string
          learning_rate?: number | null
          metrics?: Json
          name: string
          started_at?: string
          status?: string
          student_code?: string | null
          student_id?: string | null
          student_name?: string | null
          trigger?: string | null
        }
        Update: {
          batch_size?: number | null
          created_at?: string
          dataset_size?: number | null
          embedding_value?: number | null
          epochs?: number | null
          final_acc?: number | null
          final_loss?: number | null
          final_val_acc?: number | null
          finished_at?: string | null
          id?: string
          learning_rate?: number | null
          metrics?: Json
          name?: string
          started_at?: string
          status?: string
          student_code?: string | null
          student_id?: string | null
          student_name?: string | null
          trigger?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_attendance_summary: {
        Row: {
          absent_count: number | null
          attendance_rate: number | null
          course_code: string | null
          course_id: string | null
          course_name: string | null
          late_count: number | null
          on_time_count: number | null
          student_id: string | null
          total_sessions: number | null
        }
        Relationships: [
          {
            foreignKeyName: "class_sessions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_use_face_model: { Args: { _user_id: string }; Returns: boolean }
      cancel_class_announcement: {
        Args: { _course_id: string; _reason?: string }
        Returns: number
      }
      resolve_login_email: { Args: { _input: string }; Returns: string }
      check_in_attendance: {
        Args: {
          _confidence: number
          _photo_data_url: string
          _session_id: string
        }
        Returns: string
      }
      is_course_instructor: {
        Args: { _course_id: string; _user_id: string }
        Returns: boolean
      }
      is_enrolled_student: {
        Args: { _course_id: string; _user_id: string }
        Returns: boolean
      }
      log_audit_event: {
        Args: {
          _action: string
          _after?: Json
          _before?: Json
          _detail?: string
          _reason?: string
          _target?: string
          _target_id?: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "instructor" | "student"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "instructor", "student"],
    },
  },
} as const
