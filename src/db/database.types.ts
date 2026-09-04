export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      candidate_cvs: {
        Row: {
          candidate_id: number;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: number;
          mime_type: string;
          object_deleted_at: string | null;
          original_filename: string;
          size_bytes: number;
          status: string;
          storage_path: string;
          updated_at: string;
          uploaded_at: string;
        };
        Insert: {
          candidate_id: number;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: never;
          mime_type: string;
          object_deleted_at?: string | null;
          original_filename: string;
          size_bytes: number;
          status?: string;
          storage_path: string;
          updated_at?: string;
          uploaded_at?: string;
        };
        Update: {
          candidate_id?: number;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: never;
          mime_type?: string;
          object_deleted_at?: string | null;
          original_filename?: string;
          size_bytes?: number;
          status?: string;
          storage_path?: string;
          updated_at?: string;
          uploaded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_cvs_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_recruitment_status_history: {
        Row: {
          candidate_recruitment_id: number;
          changed_at: string;
          changed_by: string | null;
          from_stage_id: number | null;
          id: number;
          to_stage_id: number;
        };
        Insert: {
          candidate_recruitment_id: number;
          changed_at?: string;
          changed_by?: string | null;
          from_stage_id?: number | null;
          id?: never;
          to_stage_id: number;
        };
        Update: {
          candidate_recruitment_id?: number;
          changed_at?: string;
          changed_by?: string | null;
          from_stage_id?: number | null;
          id?: never;
          to_stage_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_recruitment_status_hist_candidate_recruitment_id_fkey";
            columns: ["candidate_recruitment_id"];
            isOneToOne: false;
            referencedRelation: "candidate_recruitments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_recruitment_status_history_from_stage_id_fkey";
            columns: ["from_stage_id"];
            isOneToOne: false;
            referencedRelation: "kanban_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_recruitment_status_history_to_stage_id_fkey";
            columns: ["to_stage_id"];
            isOneToOne: false;
            referencedRelation: "kanban_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_recruitments: {
        Row: {
          added_at: string;
          candidate_id: number;
          current_stage_id: number;
          id: number;
          recruitment_id: number;
        };
        Insert: {
          added_at?: string;
          candidate_id: number;
          current_stage_id: number;
          id?: never;
          recruitment_id: number;
        };
        Update: {
          added_at?: string;
          candidate_id?: number;
          current_stage_id?: number;
          id?: never;
          recruitment_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_recruitments_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_recruitments_current_stage_id_fkey";
            columns: ["current_stage_id"];
            isOneToOne: false;
            referencedRelation: "kanban_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_recruitments_recruitment_id_fkey";
            columns: ["recruitment_id"];
            isOneToOne: false;
            referencedRelation: "recruitments";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_stage_notes: {
        Row: {
          body: string;
          candidate_recruitment_id: number;
          created_at: string;
          created_by: string | null;
          id: number;
          stage_id: number;
          updated_at: string;
        };
        Insert: {
          body: string;
          candidate_recruitment_id: number;
          created_at?: string;
          created_by?: string | null;
          id?: never;
          stage_id: number;
          updated_at?: string;
        };
        Update: {
          body?: string;
          candidate_recruitment_id?: number;
          created_at?: string;
          created_by?: string | null;
          id?: never;
          stage_id?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_stage_notes_candidate_recruitment_id_fkey";
            columns: ["candidate_recruitment_id"];
            isOneToOne: false;
            referencedRelation: "candidate_recruitments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_stage_notes_stage_id_fkey";
            columns: ["stage_id"];
            isOneToOne: false;
            referencedRelation: "kanban_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      candidates: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: number;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name: string;
          id?: never;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: never;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      group_memberships: {
        Row: {
          created_at: string;
          group_id: number;
          id: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          group_id: number;
          id?: never;
          user_id: string;
        };
        Update: {
          created_at?: string;
          group_id?: number;
          id?: never;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "security_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      group_operations: {
        Row: {
          created_at: string;
          group_id: number;
          id: number;
          operation: Database["public"]["Enums"]["operation"];
        };
        Insert: {
          created_at?: string;
          group_id: number;
          id?: never;
          operation: Database["public"]["Enums"]["operation"];
        };
        Update: {
          created_at?: string;
          group_id?: number;
          id?: never;
          operation?: Database["public"]["Enums"]["operation"];
        };
        Relationships: [
          {
            foreignKeyName: "group_operations_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "security_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      kanban_stages: {
        Row: {
          created_at: string;
          id: number;
          name: string;
          recruitment_id: number | null;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          id?: never;
          name: string;
          recruitment_id?: number | null;
          sort_order: number;
        };
        Update: {
          created_at?: string;
          id?: never;
          name?: string;
          recruitment_id?: number | null;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "kanban_stages_recruitment_id_fkey";
            columns: ["recruitment_id"];
            isOneToOne: false;
            referencedRelation: "recruitments";
            referencedColumns: ["id"];
          },
        ];
      };
      recruitment_security_groups: {
        Row: {
          created_at: string;
          group_id: number;
          id: number;
          recruitment_id: number;
        };
        Insert: {
          created_at?: string;
          group_id: number;
          id?: never;
          recruitment_id: number;
        };
        Update: {
          created_at?: string;
          group_id?: number;
          id?: never;
          recruitment_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "recruitment_security_groups_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "security_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recruitment_security_groups_recruitment_id_fkey";
            columns: ["recruitment_id"];
            isOneToOne: false;
            referencedRelation: "recruitments";
            referencedColumns: ["id"];
          },
        ];
      };
      recruitments: {
        Row: {
          created_at: string;
          department: string | null;
          employment_type: string | null;
          id: number;
          location: string | null;
          opened_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          department?: string | null;
          employment_type?: string | null;
          id?: never;
          location?: string | null;
          opened_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          department?: string | null;
          employment_type?: string | null;
          id?: never;
          location?: string | null;
          opened_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      security_groups: {
        Row: {
          created_at: string;
          id: number;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_candidate_to_recruitment: {
        Args: {
          email: string;
          full_name: string;
          phone?: string;
          target_recruitment_id: number;
        };
        Returns: {
          added_at: string;
          candidate_id: number;
          current_stage_id: number;
          id: number;
          recruitment_id: number;
        };
        SetofOptions: {
          from: "*";
          to: "candidate_recruitments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      confirm_candidate_cv: {
        Args: { target_cv_id: number };
        Returns: {
          candidate_id: number;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: number;
          mime_type: string;
          object_deleted_at: string | null;
          original_filename: string;
          size_bytes: number;
          status: string;
          storage_path: string;
          updated_at: string;
          uploaded_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "candidate_cvs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_recruitment: {
        Args: {
          p_department: string;
          p_employment_type: string;
          p_group_ids: number[];
          p_location: string;
          p_opened_at: string;
          p_title: string;
        };
        Returns: {
          created_at: string;
          department: string | null;
          employment_type: string | null;
          id: number;
          location: string | null;
          opened_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "recruitments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_group_member_emails: {
        Args: { target_group_id: number };
        Returns: {
          email: string;
          id: string;
        }[];
      };
      get_user_emails_for_candidate: {
        Args: { target_candidate_recruitment_id: number; user_ids: string[] };
        Returns: {
          email: string;
          id: string;
        }[];
      };
      list_purgeable_candidate_cvs: {
        Args: never;
        Returns: {
          candidate_id: number;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: number;
          mime_type: string;
          object_deleted_at: string | null;
          original_filename: string;
          size_bytes: number;
          status: string;
          storage_path: string;
          updated_at: string;
          uploaded_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "candidate_cvs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      mark_candidate_cv_object_deleted: {
        Args: { target_cv_id: number };
        Returns: {
          candidate_id: number;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: number;
          mime_type: string;
          object_deleted_at: string | null;
          original_filename: string;
          size_bytes: number;
          status: string;
          storage_path: string;
          updated_at: string;
          uploaded_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "candidate_cvs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      move_candidate_stage: {
        Args: {
          note?: string;
          target_candidate_recruitment_id: number;
          to_stage_id: number;
        };
        Returns: {
          added_at: string;
          candidate_id: number;
          current_stage_id: number;
          id: number;
          recruitment_id: number;
        };
        SetofOptions: {
          from: "*";
          to: "candidate_recruitments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      remove_group_member: {
        Args: { target_group_id: number; target_user_id: string };
        Returns: undefined;
      };
      replace_recruitment_stages: {
        Args: { stage_names: string[]; target_recruitment_id: number };
        Returns: {
          created_at: string;
          id: number;
          name: string;
          recruitment_id: number | null;
          sort_order: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "kanban_stages";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      reset_recruitment_stages: {
        Args: { target_recruitment_id: number };
        Returns: {
          created_at: string;
          id: number;
          name: string;
          recruitment_id: number | null;
          sort_order: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "kanban_stages";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      revoke_group_operation: {
        Args: {
          target_group_id: number;
          target_operation: Database["public"]["Enums"]["operation"];
        };
        Returns: undefined;
      };
      search_users_for_group_management: {
        Args: { search_term: string };
        Returns: {
          email: string;
          id: string;
        }[];
      };
      update_default_stages: {
        Args: { stages: Json };
        Returns: {
          created_at: string;
          id: number;
          name: string;
          recruitment_id: number | null;
          sort_order: number;
        }[];
        SetofOptions: {
          from: "*";
          to: "kanban_stages";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
    };
    Enums: {
      operation: "recruitment.read" | "recruitment.write" | "candidate.read" | "candidate.write" | "group.manage";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      operation: ["recruitment.read", "recruitment.write", "candidate.read", "candidate.write", "group.manage"],
    },
  },
} as const;
