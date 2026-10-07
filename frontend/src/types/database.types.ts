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
      achievements_catalog: {
        Row: {
          code: string
          criteria: Json
          icon: string | null
          id: string
          sort_order: number
        }
        Insert: {
          code: string
          criteria: Json
          icon?: string | null
          id?: string
          sort_order?: number
        }
        Update: {
          code?: string
          criteria?: Json
          icon?: string | null
          id?: string
          sort_order?: number
        }
        Relationships: []
      }
      ai_analysis_requests: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          cost_usd: number | null
          created_at: string
          error_message: string | null
          feedback: Database["public"]["Enums"]["feedback_value"] | null
          feedback_comment: string | null
          id: string
          latency_ms: number | null
          pet_id: string
          photo_path: string | null
          possible_causes: string[] | null
          prompt_version: string | null
          recommendations: string[] | null
          requested_by: string | null
          response_raw: Json | null
          status: Database["public"]["Enums"]["ai_request_status"]
          urgency_level: Database["public"]["Enums"]["urgency_level"] | null
          used_full_history: boolean
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          feedback?: Database["public"]["Enums"]["feedback_value"] | null
          feedback_comment?: string | null
          id?: string
          latency_ms?: number | null
          pet_id: string
          photo_path?: string | null
          possible_causes?: string[] | null
          prompt_version?: string | null
          recommendations?: string[] | null
          requested_by?: string | null
          response_raw?: Json | null
          status?: Database["public"]["Enums"]["ai_request_status"]
          urgency_level?: Database["public"]["Enums"]["urgency_level"] | null
          used_full_history?: boolean
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          feedback?: Database["public"]["Enums"]["feedback_value"] | null
          feedback_comment?: string | null
          id?: string
          latency_ms?: number | null
          pet_id?: string
          photo_path?: string | null
          possible_causes?: string[] | null
          prompt_version?: string | null
          recommendations?: string[] | null
          requested_by?: string | null
          response_raw?: Json | null
          status?: Database["public"]["Enums"]["ai_request_status"]
          urgency_level?: Database["public"]["Enums"]["urgency_level"] | null
          used_full_history?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_analysis_requests_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_analysis_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_analysis_symptoms: {
        Row: {
          analysis_id: string
          symptom_id: string
        }
        Insert: {
          analysis_id: string
          symptom_id: string
        }
        Update: {
          analysis_id?: string
          symptom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_analysis_symptoms_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "ai_analysis_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_analysis_symptoms_symptom_id_fkey"
            columns: ["symptom_id"]
            isOneToOne: false
            referencedRelation: "symptoms_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          properties: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          properties?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          properties?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      breeds: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          species_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          species_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          species_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "breeds_species_id_fkey"
            columns: ["species_id"]
            isOneToOne: false
            referencedRelation: "species"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_translations: {
        Row: {
          entity_id: string
          entity_type: string
          field: string
          id: string
          locale: string
          value: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          field: string
          id?: string
          locale: string
          value: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          field?: string
          id?: string
          locale?: string
          value?: string
        }
        Relationships: []
      }
      clinic_referrals: {
        Row: {
          campaign: string | null
          clinic_id: string
          id: string
          referred_at: string
          source: string | null
          user_id: string
        }
        Insert: {
          campaign?: string | null
          clinic_id: string
          id?: string
          referred_at?: string
          source?: string | null
          user_id: string
        }
        Update: {
          campaign?: string | null
          clinic_id?: string
          id?: string
          referred_at?: string
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_referrals_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "vet_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_referrals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          activity_level: number | null
          appetite_level: number | null
          created_at: string
          energy_level: number | null
          id: string
          last_edited_by: string | null
          log_date: string
          logged_by: string | null
          mood_level: number | null
          notes: string | null
          pet_id: string
          sleep_quality: number | null
          social_interaction_level: number | null
          tags: string[] | null
          unusual_behavior: boolean
          unusual_behavior_notes: string | null
          updated_at: string
          vocalization_level: number | null
        }
        Insert: {
          activity_level?: number | null
          appetite_level?: number | null
          created_at?: string
          energy_level?: number | null
          id?: string
          last_edited_by?: string | null
          log_date: string
          logged_by?: string | null
          mood_level?: number | null
          notes?: string | null
          pet_id: string
          sleep_quality?: number | null
          social_interaction_level?: number | null
          tags?: string[] | null
          unusual_behavior?: boolean
          unusual_behavior_notes?: string | null
          updated_at?: string
          vocalization_level?: number | null
        }
        Update: {
          activity_level?: number | null
          appetite_level?: number | null
          created_at?: string
          energy_level?: number | null
          id?: string
          last_edited_by?: string | null
          log_date?: string
          logged_by?: string | null
          mood_level?: number | null
          notes?: string | null
          pet_id?: string
          sleep_quality?: number | null
          social_interaction_level?: number | null
          tags?: string[] | null
          unusual_behavior?: boolean
          unusual_behavior_notes?: string | null
          updated_at?: string
          vocalization_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          alert_notifications_enabled: boolean
          daily_reminder_enabled: boolean
          daily_reminder_time: string
          marketing_notifications_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_notifications_enabled?: boolean
          daily_reminder_enabled?: boolean
          daily_reminder_time?: string
          marketing_notifications_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_notifications_enabled?: boolean
          daily_reminder_enabled?: boolean
          daily_reminder_time?: string
          marketing_notifications_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          id: string
          pet_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          id?: string
          pet_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_achievements_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_co_owners: {
        Row: {
          accepted_at: string | null
          id: string
          invited_at: string
          invited_by: string | null
          pet_id: string
          role: Database["public"]["Enums"]["co_owner_role"]
          status: Database["public"]["Enums"]["co_owner_status"]
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          pet_id: string
          role?: Database["public"]["Enums"]["co_owner_role"]
          status?: Database["public"]["Enums"]["co_owner_status"]
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          pet_id?: string
          role?: Database["public"]["Enums"]["co_owner_role"]
          status?: Database["public"]["Enums"]["co_owner_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_co_owners_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_co_owners_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_co_owners_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_shared_reports: {
        Row: {
          created_at: string
          date_range_end: string
          date_range_start: string
          file_path: string
          generated_by: string | null
          id: string
          pet_id: string
        }
        Insert: {
          created_at?: string
          date_range_end: string
          date_range_start: string
          file_path: string
          generated_by?: string | null
          id?: string
          pet_id: string
        }
        Update: {
          created_at?: string
          date_range_end?: string
          date_range_start?: string
          file_path?: string
          generated_by?: string | null
          id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_shared_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_shared_reports_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_streaks: {
        Row: {
          current_streak: number
          last_log_date: string | null
          longest_streak: number
          pet_id: string
          updated_at: string
        }
        Insert: {
          current_streak?: number
          last_log_date?: string | null
          longest_streak?: number
          pet_id: string
          updated_at?: string
        }
        Update: {
          current_streak?: number
          last_log_date?: string | null
          longest_streak?: number
          pet_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_streaks_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: true
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          allergies: string[] | null
          birth_date: string | null
          breed: string | null
          breed_id: string | null
          breed_status: Database["public"]["Enums"]["breed_status"] | null
          created_at: string
          id: string
          is_active: boolean
          known_conditions: string[] | null
          name: string
          owner_id: string
          photo_path: string | null
          sex: Database["public"]["Enums"]["pet_sex"] | null
          species_id: string
          sterilized: boolean | null
          temperament_notes: string | null
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          allergies?: string[] | null
          birth_date?: string | null
          breed?: string | null
          breed_id?: string | null
          breed_status?: Database["public"]["Enums"]["breed_status"] | null
          created_at?: string
          id?: string
          is_active?: boolean
          known_conditions?: string[] | null
          name: string
          owner_id: string
          photo_path?: string | null
          sex?: Database["public"]["Enums"]["pet_sex"] | null
          species_id: string
          sterilized?: boolean | null
          temperament_notes?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          allergies?: string[] | null
          birth_date?: string | null
          breed?: string | null
          breed_id?: string | null
          breed_status?: Database["public"]["Enums"]["breed_status"] | null
          created_at?: string
          id?: string
          is_active?: boolean
          known_conditions?: string[] | null
          name?: string
          owner_id?: string
          photo_path?: string | null
          sex?: Database["public"]["Enums"]["pet_sex"] | null
          species_id?: string
          sterilized?: boolean | null
          temperament_notes?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pets_breed_species_fkey"
            columns: ["breed_id", "species_id"]
            isOneToOne: false
            referencedRelation: "breeds"
            referencedColumns: ["id", "species_id"]
          },
          {
            foreignKeyName: "pets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pets_species_id_fkey"
            columns: ["species_id"]
            isOneToOne: false
            referencedRelation: "species"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          disclaimer_accepted_at: string | null
          disclaimer_version: string | null
          external_avatar_url: string | null
          full_name: string | null
          id: string
          locale: string
          marketing_opt_in: boolean
          onboarding_completed_at: string | null
          phone: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          disclaimer_accepted_at?: string | null
          disclaimer_version?: string | null
          external_avatar_url?: string | null
          full_name?: string | null
          id: string
          locale?: string
          marketing_opt_in?: boolean
          onboarding_completed_at?: string | null
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          disclaimer_accepted_at?: string | null
          disclaimer_version?: string | null
          external_avatar_url?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          marketing_opt_in?: boolean
          onboarding_completed_at?: string | null
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string | null
          id: string
          is_active: boolean
          last_seen_at: string
          os_version: string | null
          platform: Database["public"]["Enums"]["push_platform"]
          token: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          os_version?: string | null
          platform: Database["public"]["Enums"]["push_platform"]
          token: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          os_version?: string | null
          platform?: Database["public"]["Enums"]["push_platform"]
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          attachment_path: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string
          id: string
          pet_id: string
          recurrence_rule: string | null
          snooze_until: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          title: string
          type: Database["public"]["Enums"]["reminder_type"]
          updated_at: string
        }
        Insert: {
          attachment_path?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at: string
          id?: string
          pet_id: string
          recurrence_rule?: string | null
          snooze_until?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          title: string
          type: Database["public"]["Enums"]["reminder_type"]
          updated_at?: string
        }
        Update: {
          attachment_path?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string
          id?: string
          pet_id?: string
          recurrence_rule?: string | null
          snooze_until?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          title?: string
          type?: Database["public"]["Enums"]["reminder_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      species: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          parent_species_id: string | null
          scientific_name: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          parent_species_id?: string | null
          scientific_name?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          parent_species_id?: string | null
          scientific_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "species_parent_species_id_fkey"
            columns: ["parent_species_id"]
            isOneToOne: false
            referencedRelation: "species"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          event_type: string
          id: string
          new_plan: Database["public"]["Enums"]["subscription_plan"] | null
          new_status: Database["public"]["Enums"]["subscription_status"] | null
          occurred_at: string
          previous_plan: Database["public"]["Enums"]["subscription_plan"] | null
          previous_status:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          provider_event_id: string
          raw_payload: Json | null
          subscription_id: string
        }
        Insert: {
          event_type: string
          id?: string
          new_plan?: Database["public"]["Enums"]["subscription_plan"] | null
          new_status?: Database["public"]["Enums"]["subscription_status"] | null
          occurred_at?: string
          previous_plan?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          previous_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          provider_event_id: string
          raw_payload?: Json | null
          subscription_id: string
        }
        Update: {
          event_type?: string
          id?: string
          new_plan?: Database["public"]["Enums"]["subscription_plan"] | null
          new_status?: Database["public"]["Enums"]["subscription_status"] | null
          occurred_at?: string
          previous_plan?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          previous_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          provider_event_id?: string
          raw_payload?: Json | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          provider: string | null
          provider_subscription_id: string | null
          raw_provider_payload: Json | null
          status: Database["public"]["Enums"]["subscription_status"]
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          provider?: string | null
          provider_subscription_id?: string | null
          raw_provider_payload?: Json | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          provider?: string | null
          provider_subscription_id?: string | null
          raw_provider_payload?: Json | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      symptom_species: {
        Row: {
          species_id: string
          symptom_id: string
        }
        Insert: {
          species_id: string
          symptom_id: string
        }
        Update: {
          species_id?: string
          symptom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "symptom_species_species_id_fkey"
            columns: ["species_id"]
            isOneToOne: false
            referencedRelation: "species"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "symptom_species_symptom_id_fkey"
            columns: ["symptom_id"]
            isOneToOne: false
            referencedRelation: "symptoms_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      symptoms_catalog: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      vet_clinics: {
        Row: {
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          id: string
          name: string
          referral_code: string
        }
        Insert: {
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name: string
          referral_code: string
        }
        Update: {
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          referral_code?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_pet_invitation: {
        Args: { invitation_id: string }
        Returns: undefined
      }
      award_pet_achievement: {
        Args: { achievement_code: string; target_pet_id: string }
        Returns: undefined
      }
      can_edit_pet: { Args: { target_pet_id: string }; Returns: boolean }
      change_pet_member_role: {
        Args: {
          invitation_id: string
          new_role: Database["public"]["Enums"]["co_owner_role"]
        }
        Returns: undefined
      }
      claim_ai_analysis_for_processing: {
        Args: { target_analysis_id: string }
        Returns: boolean
      }
      create_clinic_referral: {
        Args: {
          clinic_referral_code: string
          ref_campaign?: string
          ref_source?: string
        }
        Returns: undefined
      }
      decline_pet_invitation: {
        Args: { invitation_id: string }
        Returns: undefined
      }
      get_ai_analysis_entitlement: {
        Args: never
        Returns: {
          can_request: boolean
          monthly_limit: number
          monthly_used: number
          would_use_full_history: boolean
        }[]
      }
      invite_pet_member: {
        Args: {
          initial_role?: Database["public"]["Enums"]["co_owner_role"]
          invitee_user_id: string
          target_pet_id: string
        }
        Returns: undefined
      }
      is_pet_member: { Args: { target_pet_id: string }; Returns: boolean }
      owner_has_pets: { Args: never; Returns: boolean }
      process_revenuecat_event: {
        Args: {
          p_cancel_at_period_end: boolean
          p_current_period_end: string
          p_current_period_start: string
          p_event_type: string
          p_new_plan: Database["public"]["Enums"]["subscription_plan"]
          p_new_status: Database["public"]["Enums"]["subscription_status"]
          p_provider: string
          p_provider_event_id: string
          p_provider_subscription_id: string
          p_raw_payload: Json
          p_trial_end: string
          p_user_id: string
        }
        Returns: undefined
      }
      recompute_pet_streak: {
        Args: { target_pet_id: string }
        Returns: undefined
      }
      register_push_token: {
        Args: {
          p_app_version?: string
          p_device_id?: string
          p_os_version?: string
          p_platform: Database["public"]["Enums"]["push_platform"]
          p_token: string
        }
        Returns: undefined
      }
      request_ai_analysis: {
        Args: {
          p_photo_path: string
          symptom_ids?: string[]
          target_pet_id: string
        }
        Returns: string
      }
      request_generate_report: {
        Args: { range_end: string; range_start: string; target_pet_id: string }
        Returns: undefined
      }
      revoke_pet_invitation: {
        Args: { invitation_id: string }
        Returns: undefined
      }
      safe_pet_id_from_path: { Args: { object_name: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_ai_feedback: {
        Args: {
          new_feedback: Database["public"]["Enums"]["feedback_value"]
          new_feedback_comment?: string
          target_analysis_id: string
        }
        Returns: undefined
      }
      transfer_pet_ownership: {
        Args: { new_owner_id: string; target_pet_id: string }
        Returns: undefined
      }
    }
    Enums: {
      ai_request_status: "pending" | "processing" | "completed" | "failed"
      breed_status: "known" | "mixed" | "unknown"
      co_owner_role: "editor" | "viewer"
      co_owner_status: "pending" | "accepted" | "declined" | "revoked"
      feedback_value: "useful" | "not_useful"
      org_member_role: "owner" | "admin" | "member"
      org_type:
        | "individual"
        | "shelter"
        | "breeder"
        | "veterinary_clinic"
        | "zoo"
      pet_sex: "male" | "female" | "unknown"
      push_platform: "ios" | "android"
      reminder_status: "pending" | "completed" | "skipped"
      reminder_type:
        | "vaccine"
        | "medication"
        | "appointment"
        | "bath"
        | "deworming"
        | "other"
      subscription_plan: "free" | "premium"
      subscription_status:
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "expired"
      urgency_level: "observe" | "routine_change" | "consult_soon" | "urgent"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      ai_request_status: ["pending", "processing", "completed", "failed"],
      breed_status: ["known", "mixed", "unknown"],
      co_owner_role: ["editor", "viewer"],
      co_owner_status: ["pending", "accepted", "declined", "revoked"],
      feedback_value: ["useful", "not_useful"],
      org_member_role: ["owner", "admin", "member"],
      org_type: [
        "individual",
        "shelter",
        "breeder",
        "veterinary_clinic",
        "zoo",
      ],
      pet_sex: ["male", "female", "unknown"],
      push_platform: ["ios", "android"],
      reminder_status: ["pending", "completed", "skipped"],
      reminder_type: [
        "vaccine",
        "medication",
        "appointment",
        "bath",
        "deworming",
        "other",
      ],
      subscription_plan: ["free", "premium"],
      subscription_status: [
        "active",
        "trialing",
        "past_due",
        "canceled",
        "expired",
      ],
      urgency_level: ["observe", "routine_change", "consult_soon", "urgent"],
    },
  },
} as const
