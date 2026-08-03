export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          id: number
          organization_id: string
          payload: Json
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          id?: never
          organization_id: string
          payload?: Json
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: never
          organization_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calculation_lines: {
        Row: {
          calculation_revision_id: string
          camp_id: string
          camp_recipe_copy_id: string | null
          canonical_key: string | null
          created_at: string
          exact_amount: number
          id: string
          ingredient_key: string
          ingredient_name: string
          line_key: string
          meal_id: string
          organization_id: string
          trace: Json
          unit: string
        }
        Insert: {
          calculation_revision_id: string
          camp_id: string
          camp_recipe_copy_id?: string | null
          canonical_key?: string | null
          created_at?: string
          exact_amount: number
          id?: string
          ingredient_key: string
          ingredient_name: string
          line_key: string
          meal_id: string
          organization_id: string
          trace: Json
          unit: string
        }
        Update: {
          calculation_revision_id?: string
          camp_id?: string
          camp_recipe_copy_id?: string | null
          canonical_key?: string | null
          created_at?: string
          exact_amount?: number
          id?: string
          ingredient_key?: string
          ingredient_name?: string
          line_key?: string
          meal_id?: string
          organization_id?: string
          trace?: Json
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "calculation_lines_copy_fk"
            columns: ["organization_id", "camp_id", "camp_recipe_copy_id"]
            isOneToOne: false
            referencedRelation: "camp_recipe_copies"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "calculation_lines_meal_fk"
            columns: ["organization_id", "camp_id", "meal_id"]
            isOneToOne: false
            referencedRelation: "meals"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "calculation_lines_revision_fk"
            columns: ["organization_id", "camp_id", "calculation_revision_id"]
            isOneToOne: false
            referencedRelation: "calculation_revisions"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      calculation_revisions: {
        Row: {
          calculated_by: string
          camp_id: string
          created_at: string
          id: string
          input_digest: string
          organization_id: string
          problem_summary: Json
          revision_number: number
          status: Database["public"]["Enums"]["calculation_status"]
        }
        Insert: {
          calculated_by: string
          camp_id: string
          created_at?: string
          id?: string
          input_digest: string
          organization_id: string
          problem_summary?: Json
          revision_number: number
          status?: Database["public"]["Enums"]["calculation_status"]
        }
        Update: {
          calculated_by?: string
          camp_id?: string
          created_at?: string
          id?: string
          input_digest?: string
          organization_id?: string
          problem_summary?: Json
          revision_number?: number
          status?: Database["public"]["Enums"]["calculation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "calculation_revisions_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      camp_groups: {
        Row: {
          camp_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["group_kind"]
          name: string
          organization_id: string
          parent_group_id: string | null
          scoutnet_source_reference: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          camp_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["group_kind"]
          name: string
          organization_id: string
          parent_group_id?: string | null
          scoutnet_source_reference?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          camp_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["group_kind"]
          name?: string
          organization_id?: string
          parent_group_id?: string | null
          scoutnet_source_reference?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "camp_groups_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "camp_groups_parent_fk"
            columns: ["organization_id", "camp_id", "parent_group_id"]
            isOneToOne: false
            referencedRelation: "camp_groups"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      camp_meal_slots: {
        Row: {
          camp_id: string
          created_at: string
          id: string
          label: string | null
          meal_type: string
          organization_id: string
          service_date: string
          service_status: string
          slot_key: string
          sort_order: number
          source: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          camp_id: string
          created_at?: string
          id?: string
          label?: string | null
          meal_type: string
          organization_id: string
          service_date: string
          service_status?: string
          slot_key: string
          sort_order?: number
          source?: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          camp_id?: string
          created_at?: string
          id?: string
          label?: string | null
          meal_type?: string
          organization_id?: string
          service_date?: string
          service_status?: string
          slot_key?: string
          sort_order?: number
          source?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "camp_meal_slots_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      camp_recipe_copies: {
        Row: {
          camp_id: string
          copied_by: string
          created_at: string
          frozen_snapshot: Json
          id: string
          name: string
          organization_id: string
          source_recipe_version_id: string
          version_key: string
        }
        Insert: {
          camp_id: string
          copied_by: string
          created_at?: string
          frozen_snapshot: Json
          id?: string
          name: string
          organization_id: string
          source_recipe_version_id: string
          version_key: string
        }
        Update: {
          camp_id?: string
          copied_by?: string
          created_at?: string
          frozen_snapshot?: Json
          id?: string
          name?: string
          organization_id?: string
          source_recipe_version_id?: string
          version_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "camp_recipe_copies_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "camp_recipe_copies_version_fk"
            columns: ["organization_id", "source_recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      camps: {
        Row: {
          created_at: string
          created_by: string
          ends_on: string
          id: string
          meal_plan_confirmed_at: string | null
          meal_plan_confirmed_by: string | null
          name: string
          organization_id: string
          starts_on: string
          status: Database["public"]["Enums"]["camp_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ends_on: string
          id?: string
          meal_plan_confirmed_at?: string | null
          meal_plan_confirmed_by?: string | null
          name: string
          organization_id: string
          starts_on: string
          status?: Database["public"]["Enums"]["camp_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_on?: string
          id?: string
          meal_plan_confirmed_at?: string | null
          meal_plan_confirmed_by?: string | null
          name?: string
          organization_id?: string
          starts_on?: string
          status?: Database["public"]["Enums"]["camp_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "camps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_ingredients: {
        Row: {
          canonical_key: string
          created_at: string
          display_name: string
          organization_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          canonical_key: string
          created_at?: string
          display_name: string
          organization_id: string
          unit: string
          updated_at?: string
        }
        Update: {
          canonical_key?: string
          created_at?: string
          display_name?: string
          organization_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "canonical_ingredients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dietary_need_tags: {
        Row: {
          active: boolean
          camp_id: string
          created_at: string
          dietary_need_id: string
          dietary_tag_id: string
          organization_id: string
          superseded_at: string | null
        }
        Insert: {
          active?: boolean
          camp_id: string
          created_at?: string
          dietary_need_id: string
          dietary_tag_id: string
          organization_id: string
          superseded_at?: string | null
        }
        Update: {
          active?: boolean
          camp_id?: string
          created_at?: string
          dietary_need_id?: string
          dietary_tag_id?: string
          organization_id?: string
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dietary_need_tags_need_fk"
            columns: ["organization_id", "camp_id", "dietary_need_id"]
            isOneToOne: false
            referencedRelation: "participant_dietary_needs"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "dietary_need_tags_tag_fk"
            columns: ["organization_id", "camp_id", "dietary_tag_id"]
            isOneToOne: false
            referencedRelation: "dietary_tags"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      dietary_tags: {
        Row: {
          camp_id: string
          created_at: string
          description: string | null
          id: string
          label: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          camp_id: string
          created_at?: string
          description?: string | null
          id?: string
          label: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          camp_id?: string
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dietary_tags_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      import_batches: {
        Row: {
          camp_id: string
          column_mapping: Json
          completed_at: string | null
          created_at: string
          id: string
          imported_by: string
          organization_id: string
          source_filename: string
          source_kind: string
          status: Database["public"]["Enums"]["import_status"]
          validation_summary: Json
        }
        Insert: {
          camp_id: string
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          id?: string
          imported_by: string
          organization_id: string
          source_filename: string
          source_kind: string
          status?: Database["public"]["Enums"]["import_status"]
          validation_summary?: Json
        }
        Update: {
          camp_id?: string
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          id?: string
          imported_by?: string
          organization_id?: string
          source_filename?: string
          source_kind?: string
          status?: Database["public"]["Enums"]["import_status"]
          validation_summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ingredient_supplier_matches: {
        Row: {
          amount_per_purchase_unit: number
          approved_at: string | null
          approved_by: string | null
          approved_product_fingerprint: string | null
          canonical_key: string
          created_at: string
          id: string
          organization_id: string
          required_unit: string
          supplier_account_id: string
          supplier_product_id: string
          updated_at: string
        }
        Insert: {
          amount_per_purchase_unit: number
          approved_at?: string | null
          approved_by?: string | null
          approved_product_fingerprint?: string | null
          canonical_key: string
          created_at?: string
          id?: string
          organization_id: string
          required_unit: string
          supplier_account_id: string
          supplier_product_id: string
          updated_at?: string
        }
        Update: {
          amount_per_purchase_unit?: number
          approved_at?: string | null
          approved_by?: string | null
          approved_product_fingerprint?: string | null
          canonical_key?: string
          created_at?: string
          id?: string
          organization_id?: string
          required_unit?: string
          supplier_account_id?: string
          supplier_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_supplier_matches_account_product_fk"
            columns: [
              "organization_id",
              "supplier_account_id",
              "supplier_product_id",
            ]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
          {
            foreignKeyName: "ingredient_supplier_matches_canonical_fk"
            columns: ["organization_id", "canonical_key"]
            isOneToOne: false
            referencedRelation: "canonical_ingredients"
            referencedColumns: ["organization_id", "canonical_key"]
          },
          {
            foreignKeyName: "ingredient_supplier_matches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_supplier_matches_product_fk"
            columns: ["organization_id", "supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      meal_reserves: {
        Row: {
          camp_id: string
          created_at: string
          dietary_label: string
          id: string
          meal_id: string
          organization_id: string
          portions: number
          updated_at: string
        }
        Insert: {
          camp_id: string
          created_at?: string
          dietary_label: string
          id?: string
          meal_id: string
          organization_id: string
          portions: number
          updated_at?: string
        }
        Update: {
          camp_id?: string
          created_at?: string
          dietary_label?: string
          id?: string
          meal_id?: string
          organization_id?: string
          portions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_reserves_meal_fk"
            columns: ["organization_id", "camp_id", "meal_id"]
            isOneToOne: false
            referencedRelation: "meals"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      meals: {
        Row: {
          camp_id: string
          camp_recipe_copy_id: string | null
          created_at: string
          id: string
          meal_slot_id: string
          meal_type: string
          organization_id: string
          starts_at: string
          status: Database["public"]["Enums"]["meal_status"]
          title: string
          updated_at: string
        }
        Insert: {
          camp_id: string
          camp_recipe_copy_id?: string | null
          created_at?: string
          id?: string
          meal_slot_id: string
          meal_type: string
          organization_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["meal_status"]
          title: string
          updated_at?: string
        }
        Update: {
          camp_id?: string
          camp_recipe_copy_id?: string | null
          created_at?: string
          id?: string
          meal_slot_id?: string
          meal_type?: string
          organization_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["meal_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meals_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "meals_recipe_copy_fk"
            columns: ["organization_id", "camp_id", "camp_recipe_copy_id"]
            isOneToOne: false
            referencedRelation: "camp_recipe_copies"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "meals_slot_fk"
            columns: ["organization_id", "camp_id", "meal_slot_id"]
            isOneToOne: true
            referencedRelation: "camp_meal_slots"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          token_hash: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_role"]
          token_hash?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      participant_attendance: {
        Row: {
          active: boolean
          camp_id: string
          created_at: string
          ends_at: string
          id: string
          organization_id: string
          participant_id: string
          source: Database["public"]["Enums"]["participant_data_source"]
          starts_at: string
          superseded_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          camp_id: string
          created_at?: string
          ends_at: string
          id?: string
          organization_id: string
          participant_id: string
          source?: Database["public"]["Enums"]["participant_data_source"]
          starts_at: string
          superseded_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          camp_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          organization_id?: string
          participant_id?: string
          source?: Database["public"]["Enums"]["participant_data_source"]
          starts_at?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_attendance_participant_fk"
            columns: ["organization_id", "camp_id", "participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      participant_dietary_needs: {
        Row: {
          camp_id: string
          created_at: string
          id: string
          organization_id: string
          participant_id: string
          raw_food_note: string | null
          review_status: Database["public"]["Enums"]["dietary_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          scoutnet_managed: boolean
          updated_at: string
        }
        Insert: {
          camp_id: string
          created_at?: string
          id?: string
          organization_id: string
          participant_id: string
          raw_food_note?: string | null
          review_status?: Database["public"]["Enums"]["dietary_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          scoutnet_managed?: boolean
          updated_at?: string
        }
        Update: {
          camp_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          participant_id?: string
          raw_food_note?: string | null
          review_status?: Database["public"]["Enums"]["dietary_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          scoutnet_managed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_dietary_needs_participant_fk"
            columns: ["organization_id", "camp_id", "participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      participants: {
        Row: {
          camp_id: string
          created_at: string
          display_name: string
          division_id: string | null
          food_factor: number
          id: string
          import_batch_id: string | null
          lifecycle_status: Database["public"]["Enums"]["participant_lifecycle_status"]
          meal_group_id: string | null
          organization_id: string
          patrol_id: string | null
          pre_scoutnet_display_name: string | null
          pre_scoutnet_division_id: string | null
          pre_scoutnet_patrol_id: string | null
          scoutnet_registration_status:
            | Database["public"]["Enums"]["scoutnet_registration_status"]
            | null
          scoutnet_source_reference: string | null
          scoutnet_synced_at: string | null
          source_reference: string | null
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          camp_id: string
          created_at?: string
          display_name: string
          division_id?: string | null
          food_factor?: number
          id?: string
          import_batch_id?: string | null
          lifecycle_status?: Database["public"]["Enums"]["participant_lifecycle_status"]
          meal_group_id?: string | null
          organization_id: string
          patrol_id?: string | null
          pre_scoutnet_display_name?: string | null
          pre_scoutnet_division_id?: string | null
          pre_scoutnet_patrol_id?: string | null
          scoutnet_registration_status?:
            | Database["public"]["Enums"]["scoutnet_registration_status"]
            | null
          scoutnet_source_reference?: string | null
          scoutnet_synced_at?: string | null
          source_reference?: string | null
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          camp_id?: string
          created_at?: string
          display_name?: string
          division_id?: string | null
          food_factor?: number
          id?: string
          import_batch_id?: string | null
          lifecycle_status?: Database["public"]["Enums"]["participant_lifecycle_status"]
          meal_group_id?: string | null
          organization_id?: string
          patrol_id?: string | null
          pre_scoutnet_display_name?: string | null
          pre_scoutnet_division_id?: string | null
          pre_scoutnet_patrol_id?: string | null
          scoutnet_registration_status?:
            | Database["public"]["Enums"]["scoutnet_registration_status"]
            | null
          scoutnet_source_reference?: string | null
          scoutnet_synced_at?: string | null
          source_reference?: string | null
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participants_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "participants_division_fk"
            columns: ["organization_id", "camp_id", "division_id"]
            isOneToOne: false
            referencedRelation: "camp_groups"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "participants_import_batch_fk"
            columns: ["organization_id", "camp_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "participants_meal_group_fk"
            columns: ["organization_id", "camp_id", "meal_group_id"]
            isOneToOne: false
            referencedRelation: "camp_groups"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "participants_patrol_fk"
            columns: ["organization_id", "camp_id", "patrol_id"]
            isOneToOne: false
            referencedRelation: "camp_groups"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "participants_pre_scoutnet_division_fk"
            columns: ["organization_id", "camp_id", "pre_scoutnet_division_id"]
            isOneToOne: false
            referencedRelation: "camp_groups"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "participants_pre_scoutnet_patrol_fk"
            columns: ["organization_id", "camp_id", "pre_scoutnet_patrol_id"]
            isOneToOne: false
            referencedRelation: "camp_groups"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      preferred_supplier_matches: {
        Row: {
          canonical_key: string
          ingredient_supplier_match_id: string
          organization_id: string
          selected_at: string
          selected_by: string
          supplier_account_id: string
          supplier_product_id: string
          updated_at: string
        }
        Insert: {
          canonical_key: string
          ingredient_supplier_match_id: string
          organization_id: string
          selected_at: string
          selected_by: string
          supplier_account_id: string
          supplier_product_id: string
          updated_at?: string
        }
        Update: {
          canonical_key?: string
          ingredient_supplier_match_id?: string
          organization_id?: string
          selected_at?: string
          selected_by?: string
          supplier_account_id?: string
          supplier_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preferred_supplier_matches_account_fk"
            columns: ["organization_id", "supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "preferred_supplier_matches_canonical_fk"
            columns: ["organization_id", "canonical_key"]
            isOneToOne: false
            referencedRelation: "canonical_ingredients"
            referencedColumns: ["organization_id", "canonical_key"]
          },
          {
            foreignKeyName: "preferred_supplier_matches_match_fk"
            columns: ["organization_id", "canonical_key", "supplier_product_id"]
            isOneToOne: false
            referencedRelation: "ingredient_supplier_matches"
            referencedColumns: [
              "organization_id",
              "canonical_key",
              "supplier_product_id",
            ]
          },
          {
            foreignKeyName: "preferred_supplier_matches_match_id_fk"
            columns: ["organization_id", "ingredient_supplier_match_id"]
            isOneToOne: false
            referencedRelation: "ingredient_supplier_matches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "preferred_supplier_matches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preferred_supplier_matches_product_fk"
            columns: [
              "organization_id",
              "supplier_account_id",
              "supplier_product_id",
            ]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          amount: number
          canonical_key: string | null
          comment: string | null
          created_at: string
          dietary_rule: Database["public"]["Enums"]["dietary_rule"]
          dietary_tag_label: string | null
          id: string
          mode: Database["public"]["Enums"]["ingredient_mode"]
          name: string
          organization_id: string
          recipe_version_id: string
          sort_order: number
          source_row: number | null
          unit: string
        }
        Insert: {
          amount: number
          canonical_key?: string | null
          comment?: string | null
          created_at?: string
          dietary_rule?: Database["public"]["Enums"]["dietary_rule"]
          dietary_tag_label?: string | null
          id?: string
          mode: Database["public"]["Enums"]["ingredient_mode"]
          name: string
          organization_id: string
          recipe_version_id: string
          sort_order?: number
          source_row?: number | null
          unit: string
        }
        Update: {
          amount?: number
          canonical_key?: string | null
          comment?: string | null
          created_at?: string
          dietary_rule?: Database["public"]["Enums"]["dietary_rule"]
          dietary_tag_label?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["ingredient_mode"]
          name?: string
          organization_id?: string
          recipe_version_id?: string
          sort_order?: number
          source_row?: number | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_version_fk"
            columns: ["organization_id", "recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      recipe_versions: {
        Row: {
          content_digest: string
          created_at: string
          created_by: string
          id: string
          instructions: string | null
          organization_id: string
          portion_size: number | null
          published_at: string | null
          recipe_id: string
          status: Database["public"]["Enums"]["recipe_status"]
          version_number: number
        }
        Insert: {
          content_digest: string
          created_at?: string
          created_by: string
          id?: string
          instructions?: string | null
          organization_id: string
          portion_size?: number | null
          published_at?: string | null
          recipe_id: string
          status?: Database["public"]["Enums"]["recipe_status"]
          version_number: number
        }
        Update: {
          content_digest?: string
          created_at?: string
          created_by?: string
          id?: string
          instructions?: string | null
          organization_id?: string
          portion_size?: number | null
          published_at?: string | null
          recipe_id?: string
          status?: Database["public"]["Enums"]["recipe_status"]
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_versions_recipe_fk"
            columns: ["organization_id", "recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_accounts: {
        Row: {
          account_key: string
          active: boolean
          created_at: string
          created_by: string
          customer_number: string | null
          display_name: string
          id: string
          organization_id: string
          provider_key: string
          provider_location_id: string | null
          updated_at: string
        }
        Insert: {
          account_key?: string
          active?: boolean
          created_at?: string
          created_by: string
          customer_number?: string | null
          display_name: string
          id?: string
          organization_id: string
          provider_key: string
          provider_location_id?: string | null
          updated_at?: string
        }
        Update: {
          account_key?: string
          active?: boolean
          created_at?: string
          created_by?: string
          customer_number?: string | null
          display_name?: string
          id?: string
          organization_id?: string
          provider_key?: string
          provider_location_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_catalogue_search_states: {
        Row: {
          camp_id: string
          canonical_key: string
          completed_at: string | null
          created_at: string
          last_attempted_at: string | null
          last_error: string | null
          organization_id: string
          retry_at: string | null
          search_date: string
          search_query: string
          status: string
          supplier_account_id: string
          updated_at: string
        }
        Insert: {
          camp_id: string
          canonical_key: string
          completed_at?: string | null
          created_at?: string
          last_attempted_at?: string | null
          last_error?: string | null
          organization_id: string
          retry_at?: string | null
          search_date: string
          search_query: string
          status: string
          supplier_account_id: string
          updated_at?: string
        }
        Update: {
          camp_id?: string
          canonical_key?: string
          completed_at?: string | null
          created_at?: string
          last_attempted_at?: string | null
          last_error?: string | null
          organization_id?: string
          retry_at?: string | null
          search_date?: string
          search_query?: string
          status?: string
          supplier_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_catalogue_search_states_account_fk"
            columns: ["organization_id", "supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_catalogue_search_states_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      supplier_import_column_profiles: {
        Row: {
          column_mapping: Json
          created_at: string
          created_by: string
          id: string
          organization_id: string
          profile_name: string
          source_kind: string
          supplier_account_id: string
          updated_at: string
        }
        Insert: {
          column_mapping: Json
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          profile_name: string
          source_kind: string
          supplier_account_id: string
          updated_at?: string
        }
        Update: {
          column_mapping?: Json
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          profile_name?: string
          source_kind?: string
          supplier_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_import_column_profiles_account_fk"
            columns: ["organization_id", "supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_import_column_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_import_rows: {
        Row: {
          id: string
          import_run_id: string
          imported_at: string | null
          normalized_data: Json
          organization_id: string
          raw_data: Json
          row_fingerprint: string
          source_row: number
          staged_at: string
          staged_by: string
          supplier_account_id: string
          supplier_product_id: string | null
          validation_errors: Json
        }
        Insert: {
          id?: string
          import_run_id: string
          imported_at?: string | null
          normalized_data: Json
          organization_id: string
          raw_data: Json
          row_fingerprint: string
          source_row: number
          staged_at?: string
          staged_by: string
          supplier_account_id: string
          supplier_product_id?: string | null
          validation_errors?: Json
        }
        Update: {
          id?: string
          import_run_id?: string
          imported_at?: string | null
          normalized_data?: Json
          organization_id?: string
          raw_data?: Json
          row_fingerprint?: string
          source_row?: number
          staged_at?: string
          staged_by?: string
          supplier_account_id?: string
          supplier_product_id?: string | null
          validation_errors?: Json
        }
        Relationships: [
          {
            foreignKeyName: "supplier_import_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_import_rows_product_fk"
            columns: [
              "organization_id",
              "supplier_account_id",
              "supplier_product_id",
            ]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
          {
            foreignKeyName: "supplier_import_rows_run_fk"
            columns: ["organization_id", "supplier_account_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "supplier_import_runs"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
        ]
      }
      supplier_import_runs: {
        Row: {
          column_profile_id: string | null
          error_summary: Json
          finalized_at: string | null
          finalized_by: string | null
          id: string
          invalid_row_count: number
          organization_id: string
          source_fingerprint: string
          source_kind: string
          source_name: string
          staged_row_count: number
          started_at: string
          started_by: string
          status: string
          supplier_account_id: string
          valid_row_count: number
        }
        Insert: {
          column_profile_id?: string | null
          error_summary?: Json
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          invalid_row_count?: number
          organization_id: string
          source_fingerprint: string
          source_kind: string
          source_name: string
          staged_row_count?: number
          started_at?: string
          started_by: string
          status?: string
          supplier_account_id: string
          valid_row_count?: number
        }
        Update: {
          column_profile_id?: string | null
          error_summary?: Json
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          invalid_row_count?: number
          organization_id?: string
          source_fingerprint?: string
          source_kind?: string
          source_name?: string
          staged_row_count?: number
          started_at?: string
          started_by?: string
          status?: string
          supplier_account_id?: string
          valid_row_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_import_runs_account_fk"
            columns: ["organization_id", "supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_import_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_import_runs_profile_fk"
            columns: [
              "organization_id",
              "supplier_account_id",
              "column_profile_id",
            ]
            isOneToOne: false
            referencedRelation: "supplier_import_column_profiles"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
        ]
      }
      supplier_match_candidates: {
        Row: {
          amount_per_purchase_unit: number
          canonical_key: string
          decided_at: string | null
          decided_by: string | null
          decision_source: string | null
          generated_at: string
          generated_by: string
          id: string
          import_run_id: string | null
          matcher_version: string
          organization_id: string
          product_fingerprint: string
          required_unit: string
          score: number
          signals: Json
          status: string
          supplier_account_id: string
          supplier_product_id: string
          updated_at: string
        }
        Insert: {
          amount_per_purchase_unit: number
          canonical_key: string
          decided_at?: string | null
          decided_by?: string | null
          decision_source?: string | null
          generated_at?: string
          generated_by: string
          id?: string
          import_run_id?: string | null
          matcher_version: string
          organization_id: string
          product_fingerprint: string
          required_unit: string
          score: number
          signals: Json
          status: string
          supplier_account_id: string
          supplier_product_id: string
          updated_at?: string
        }
        Update: {
          amount_per_purchase_unit?: number
          canonical_key?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_source?: string | null
          generated_at?: string
          generated_by?: string
          id?: string
          import_run_id?: string | null
          matcher_version?: string
          organization_id?: string
          product_fingerprint?: string
          required_unit?: string
          score?: number
          signals?: Json
          status?: string
          supplier_account_id?: string
          supplier_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_match_candidates_account_fk"
            columns: ["organization_id", "supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_match_candidates_canonical_fk"
            columns: ["organization_id", "canonical_key"]
            isOneToOne: false
            referencedRelation: "canonical_ingredients"
            referencedColumns: ["organization_id", "canonical_key"]
          },
          {
            foreignKeyName: "supplier_match_candidates_import_run_fk"
            columns: ["organization_id", "supplier_account_id", "import_run_id"]
            isOneToOne: false
            referencedRelation: "supplier_import_runs"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
          {
            foreignKeyName: "supplier_match_candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_match_candidates_product_fk"
            columns: [
              "organization_id",
              "supplier_account_id",
              "supplier_product_id",
            ]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
        ]
      }
      supplier_offers: {
        Row: {
          availability_status: string
          created_at: string
          currency: string
          fetched_at: string
          id: string
          organization_id: string
          price: number | null
          supplier_product_id: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          availability_status?: string
          created_at?: string
          currency?: string
          fetched_at: string
          id?: string
          organization_id: string
          price?: number | null
          supplier_product_id: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          availability_status?: string
          created_at?: string
          currency?: string
          fetched_at?: string
          id?: string
          organization_id?: string
          price?: number | null
          supplier_product_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_offers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_offers_product_fk"
            columns: ["organization_id", "supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          active: boolean
          brand: string | null
          catch_weight: boolean
          category: string | null
          created_at: string
          created_by: string
          display_name: string
          gtin: string | null
          id: string
          latest_import_run_id: string | null
          minimum_order_units: number
          normalized_search_name: string | null
          organization_id: string
          package_amount: number
          package_unit: string
          packaging_metadata: Json
          product_data_source: string
          product_fingerprint: string
          purchase_unit: string
          source_metadata: Json
          source_updated_at: string
          supplier_account_id: string
          supplier_article_number: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          catch_weight?: boolean
          category?: string | null
          created_at?: string
          created_by: string
          display_name: string
          gtin?: string | null
          id?: string
          latest_import_run_id?: string | null
          minimum_order_units?: number
          normalized_search_name?: string | null
          organization_id: string
          package_amount: number
          package_unit: string
          packaging_metadata?: Json
          product_data_source: string
          product_fingerprint: string
          purchase_unit: string
          source_metadata?: Json
          source_updated_at: string
          supplier_account_id: string
          supplier_article_number: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          catch_weight?: boolean
          category?: string | null
          created_at?: string
          created_by?: string
          display_name?: string
          gtin?: string | null
          id?: string
          latest_import_run_id?: string | null
          minimum_order_units?: number
          normalized_search_name?: string | null
          organization_id?: string
          package_amount?: number
          package_unit?: string
          packaging_metadata?: Json
          product_data_source?: string
          product_fingerprint?: string
          purchase_unit?: string
          source_metadata?: Json
          source_updated_at?: string
          supplier_account_id?: string
          supplier_article_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_account_fk"
            columns: ["organization_id", "supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_products_latest_import_fk"
            columns: [
              "organization_id",
              "supplier_account_id",
              "latest_import_run_id",
            ]
            isOneToOne: false
            referencedRelation: "supplier_import_runs"
            referencedColumns: ["organization_id", "supplier_account_id", "id"]
          },
          {
            foreignKeyName: "supplier_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_semantic_match_cache: {
        Row: {
          adapter: string
          candidate_set_fingerprint: string
          canonical_key: string
          context_fingerprint: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          model: string
          organization_id: string
          prompt_version: string
          result: Json
          supplier_account_id: string
          updated_at: string
        }
        Insert: {
          adapter: string
          candidate_set_fingerprint: string
          canonical_key: string
          context_fingerprint: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          model: string
          organization_id: string
          prompt_version: string
          result: Json
          supplier_account_id: string
          updated_at?: string
        }
        Update: {
          adapter?: string
          candidate_set_fingerprint?: string
          canonical_key?: string
          context_fingerprint?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          model?: string
          organization_id?: string
          prompt_version?: string
          result?: Json
          supplier_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_semantic_match_cache_account_fk"
            columns: ["organization_id", "supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supplier_semantic_match_cache_ingredient_fk"
            columns: ["organization_id", "canonical_key"]
            isOneToOne: false
            referencedRelation: "canonical_ingredients"
            referencedColumns: ["organization_id", "canonical_key"]
          },
          {
            foreignKeyName: "supplier_semantic_match_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_item_mutations: {
        Row: {
          actor_user_id: string
          base_values: Json
          base_version: number
          camp_id: string
          changes: Json
          client_mutation_id: string
          created_at: string
          item_id: string
          organization_id: string
          request_digest: string
          result: Json
          status: Database["public"]["Enums"]["supply_mutation_status"]
        }
        Insert: {
          actor_user_id: string
          base_values: Json
          base_version: number
          camp_id: string
          changes: Json
          client_mutation_id: string
          created_at?: string
          item_id: string
          organization_id: string
          request_digest: string
          result: Json
          status: Database["public"]["Enums"]["supply_mutation_status"]
        }
        Update: {
          actor_user_id?: string
          base_values?: Json
          base_version?: number
          camp_id?: string
          changes?: Json
          client_mutation_id?: string
          created_at?: string
          item_id?: string
          organization_id?: string
          request_digest?: string
          result?: Json
          status?: Database["public"]["Enums"]["supply_mutation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "supply_item_mutations_camp_fk"
            columns: ["organization_id", "camp_id"]
            isOneToOne: false
            referencedRelation: "camps"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "supply_item_mutations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "supply_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_item_mutations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_list_items: {
        Row: {
          camp_id: string
          canonical_key: string | null
          category: string
          comment: string | null
          completed: boolean
          created_at: string
          id: string
          item_key: string
          item_name: string
          manual_order_source_item_id: string | null
          manual_order_total_amount: number | null
          manual_order_unit: string | null
          manually_moved: boolean
          order_package_note: string | null
          order_source_kind: string | null
          ordered_amount: number | null
          ordered_unit: string | null
          organization_id: string
          package_note: string | null
          required_amount: number
          required_unit: string
          row_version: number
          source_line_keys: Json
          source_present: boolean
          supplier_order_account_id: string | null
          supplier_order_product_fingerprint: string | null
          supplier_order_product_id: string | null
          supplier_order_source_item_id: string | null
          supplier_order_synthetic_fixture: boolean
          supplier_order_total_units: number | null
          supply_list_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          camp_id: string
          canonical_key?: string | null
          category: string
          comment?: string | null
          completed?: boolean
          created_at?: string
          id?: string
          item_key: string
          item_name: string
          manual_order_source_item_id?: string | null
          manual_order_total_amount?: number | null
          manual_order_unit?: string | null
          manually_moved?: boolean
          order_package_note?: string | null
          order_source_kind?: string | null
          ordered_amount?: number | null
          ordered_unit?: string | null
          organization_id: string
          package_note?: string | null
          required_amount: number
          required_unit: string
          row_version?: number
          source_line_keys?: Json
          source_present?: boolean
          supplier_order_account_id?: string | null
          supplier_order_product_fingerprint?: string | null
          supplier_order_product_id?: string | null
          supplier_order_source_item_id?: string | null
          supplier_order_synthetic_fixture?: boolean
          supplier_order_total_units?: number | null
          supply_list_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          camp_id?: string
          canonical_key?: string | null
          category?: string
          comment?: string | null
          completed?: boolean
          created_at?: string
          id?: string
          item_key?: string
          item_name?: string
          manual_order_source_item_id?: string | null
          manual_order_total_amount?: number | null
          manual_order_unit?: string | null
          manually_moved?: boolean
          order_package_note?: string | null
          order_source_kind?: string | null
          ordered_amount?: number | null
          ordered_unit?: string | null
          organization_id?: string
          package_note?: string | null
          required_amount?: number
          required_unit?: string
          row_version?: number
          source_line_keys?: Json
          source_present?: boolean
          supplier_order_account_id?: string | null
          supplier_order_product_fingerprint?: string | null
          supplier_order_product_id?: string | null
          supplier_order_source_item_id?: string | null
          supplier_order_synthetic_fixture?: boolean
          supplier_order_total_units?: number | null
          supply_list_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_list_items_list_fk"
            columns: ["organization_id", "camp_id", "supply_list_id"]
            isOneToOne: false
            referencedRelation: "supply_lists"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
      supply_lists: {
        Row: {
          calculation_revision_id: string
          camp_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["supply_list_kind"]
          list_key: string
          meal_group_id: string | null
          organization_id: string
          range_end: string | null
          range_start: string | null
          source_present: boolean
          status: Database["public"]["Enums"]["supply_list_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          calculation_revision_id: string
          camp_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["supply_list_kind"]
          list_key: string
          meal_group_id?: string | null
          organization_id: string
          range_end?: string | null
          range_start?: string | null
          source_present?: boolean
          status?: Database["public"]["Enums"]["supply_list_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          calculation_revision_id?: string
          camp_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["supply_list_kind"]
          list_key?: string
          meal_group_id?: string | null
          organization_id?: string
          range_end?: string | null
          range_start?: string | null
          source_present?: boolean
          status?: Database["public"]["Enums"]["supply_list_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "supply_lists_meal_group_fk"
            columns: ["organization_id", "camp_id", "meal_group_id"]
            isOneToOne: false
            referencedRelation: "camp_groups"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
          {
            foreignKeyName: "supply_lists_revision_fk"
            columns: ["organization_id", "camp_id", "calculation_revision_id"]
            isOneToOne: false
            referencedRelation: "calculation_revisions"
            referencedColumns: ["organization_id", "camp_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_organization_invitation: {
        Args: { invitation_id: string }
        Returns: {
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
        }[]
      }
      apply_scoutnet_reconciliation: {
        Args: {
          p_actor_user_id: string
          p_camp_id: string
          p_decisions: Json
          p_expected_state_digest: string
          p_idempotency_key: string
          p_snapshot: Json
        }
        Returns: Json
      }
      apply_supplier_candidate_approval: {
        Args: {
          p_actor_user_id: string
          p_candidate_id: string
          p_decision_source: string
          p_organization_id: string
        }
        Returns: string
      }
      apply_supply_item_mutation: {
        Args: {
          p_base_values: Json
          p_base_version: number
          p_camp_id: string
          p_changes: Json
          p_client_mutation_id: string
          p_item_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      approve_safe_supplier_match_candidates: {
        Args: {
          p_candidate_ids: string[]
          p_matcher_version: string
          p_organization_id: string
          p_supplier_account_id: string
        }
        Returns: Json
      }
      bootstrap_first_organization: {
        Args: {
          p_admin_user_id: string
          p_camp_name: string
          p_ends_on: string
          p_organization_name: string
          p_organization_slug: string
          p_starts_on: string
          p_timezone: string
        }
        Returns: {
          camp_id: string
          organization_id: string
        }[]
      }
      calculate_camp: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: string
      }
      calculate_camp_legacy: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: string
      }
      calculate_camp_pre_meal_readiness: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: string
      }
      calculate_camp_pre_zero_attendance: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: string
      }
      camp_input_digest: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: string
      }
      camp_input_digest_pre_slots: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: string
      }
      canonical_ingredient_key: {
        Args: { p_name: string; p_unit: string }
        Returns: string
      }
      change_member_role: {
        Args: {
          p_member_user_id: string
          p_organization_id: string
          p_role: Database["public"]["Enums"]["organization_role"]
        }
        Returns: undefined
      }
      confirm_default_meal_plan: {
        Args: { p_camp_id: string }
        Returns: number
      }
      connect_scoutnet_project: {
        Args: {
          p_actor_aal: string
          p_actor_user_id: string
          p_camp_id: string
          p_participants_api_key: string
          p_project_id: string
          p_questions_api_key: string
        }
        Returns: Json
      }
      create_camp: {
        Args: {
          p_ends_on: string
          p_name: string
          p_organization_id: string
          p_starts_on: string
          p_timezone: string
        }
        Returns: string
      }
      create_participant: {
        Args: {
          p_attendance_end: string
          p_attendance_start: string
          p_camp_id: string
          p_dietary_note: string
          p_display_name: string
          p_division: string
          p_food_factor: number
          p_meal_group: string
          p_organization_id: string
          p_patrol: string
        }
        Returns: string
      }
      current_authentication_assurance_level: { Args: never; Returns: string }
      decide_supplier_match_candidate: {
        Args: {
          p_candidate_id: string
          p_decision: string
          p_organization_id: string
        }
        Returns: Json
      }
      delete_participant_for_privacy: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      disconnect_scoutnet_project: {
        Args: {
          p_actor_aal: string
          p_actor_user_id: string
          p_camp_id: string
        }
        Returns: Json
      }
      ensure_ica_sickla_supplier_account: {
        Args: { p_organization_id: string }
        Returns: string
      }
      export_participant_privacy_data: {
        Args: { p_participant_id: string }
        Returns: Json
      }
      finalize_supplier_import: {
        Args: {
          p_import_run_id: string
          p_organization_id: string
          p_supplier_account_id: string
        }
        Returns: Json
      }
      freeze_recipe_version: {
        Args: { p_camp_id: string; p_recipe_version_id: string }
        Returns: string
      }
      generate_supply_lists: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: Json
      }
      generate_supply_lists_legacy: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: Json
      }
      get_camp_readiness: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: {
          calculation_stale: boolean
          can_finalize: boolean
          meal_plan_confirmed: boolean
          meals_without_recipe: number
          no_service_slots: number
          planned_slots: number
          procurement_ready: boolean
          required_slots: number
          supplier_items_total: number
          supplier_no_match: number
          supplier_order_incomplete: number
          supplier_pending_items: number
          supplier_ready_items: number
          supplier_review_suggestions: number
          supplier_safe_suggestions: number
          supplier_unresolved_items: number
          unplanned_slots: number
          unresolved_dietary_needs: number
          zero_attendance_slots: number
        }[]
      }
      get_demo_session_status: {
        Args: never
        Returns: {
          camp_id: string
          expires_at: string
          organization_id: string
          state: string
        }[]
      }
      get_scoutnet_connection_credentials: {
        Args: { p_actor_user_id: string; p_camp_id: string }
        Returns: {
          camp_id: string
          connection_id: string
          ends_on: string
          organization_id: string
          participants_api_key: string
          project_id: string
          question_mapping: Json
          questions_api_key: string
          starts_on: string
          timezone: string
        }[]
      }
      get_scoutnet_connection_status: {
        Args: { p_actor_user_id: string; p_camp_id: string }
        Returns: Json
      }
      get_scoutnet_reconciliation_context: {
        Args: { p_actor_user_id: string; p_camp_id: string }
        Returns: Json
      }
      get_supplier_procurement_readiness: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: {
          procurement_ready: boolean
          supplier_items_total: number
          supplier_no_match: number
          supplier_order_incomplete: number
          supplier_pending_items: number
          supplier_ready_items: number
          supplier_review_suggestions: number
          supplier_safe_suggestions: number
          supplier_unresolved_items: number
        }[]
      }
      get_supplier_semantic_match_cache: {
        Args: {
          p_candidate_set_fingerprint: string
          p_canonical_key: string
          p_context_fingerprint: string
          p_organization_id: string
          p_prompt_version: string
          p_supplier_account_id: string
        }
        Returns: Json
      }
      get_supplier_semantic_match_context: {
        Args: {
          p_camp_id: string
          p_canonical_keys: string[]
          p_organization_id: string
        }
        Returns: Json
      }
      get_zero_attendance_meals: {
        Args: { p_camp_id: string; p_organization_id: string }
        Returns: {
          meal_id: string
          meal_slot_id: string
        }[]
      }
      ica_supplier_product_has_allowed_provenance: {
        Args: { p_source_metadata: Json; p_store_id: string }
        Returns: boolean
      }
      import_participant_batch: {
        Args: {
          p_camp_id: string
          p_column_mapping: Json
          p_discarded_columns: string[]
          p_error_count: number
          p_excluded_count: number
          p_organization_id: string
          p_rows: Json
          p_sheet_name: string
          p_source_filename: string
          p_source_kind: string
        }
        Returns: string
      }
      is_org_admin: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      is_supplier_candidate_current: {
        Args: {
          p_candidate_id: string
          p_organization_id: string
          p_require_safe: boolean
        }
        Returns: boolean
      }
      list_organization_members: {
        Args: { target_organization_id: string }
        Returns: {
          display_name: string
          email: string
          role: Database["public"]["Enums"]["organization_role"]
          status: Database["public"]["Enums"]["membership_status"]
          user_id: string
        }[]
      }
      manual_purchase_unit_dimension: {
        Args: { p_unit: string }
        Returns: string
      }
      manual_purchase_unit_factor: { Args: { p_unit: string }; Returns: number }
      manual_purchase_unit_family: { Args: { p_unit: string }; Returns: string }
      move_delivery_item:
        | {
            Args: {
              p_expected_version: number
              p_item_id: string
              p_target_list_id: string
            }
            Returns: number
          }
        | {
            Args: {
              p_comment: string
              p_completed: boolean
              p_expected_version: number
              p_item_id: string
              p_ordered_amount: number
              p_ordered_unit: string
              p_package_note: string
              p_target_list_id: string
            }
            Returns: number
          }
      normalized_supplier_match_name:
        | { Args: { p_display_name: string }; Returns: string }
        | { Args: { p_brand: string; p_display_name: string }; Returns: string }
      normalized_supplier_search_name: {
        Args: { p_display_name: string }
        Returns: string
      }
      normalized_supplier_unit: { Args: { p_unit: string }; Returns: string }
      provision_demo_instance: {
        Args: { p_reset?: boolean; p_user_id: string }
        Returns: {
          camp_id: string
          created_at: string
          expires_at: string
          organization_id: string
          reused: boolean
          template_digest: string
          template_version: number
          user_id: string
        }[]
      }
      publish_ica_catalogue_rows_service: {
        Args: {
          p_actor_user_id: string
          p_completed_queries: Json
          p_organization_id: string
          p_refresh_date: string
          p_rows: Json
          p_source: string
        }
        Returns: Json
      }
      record_supplier_catalogue_search_states: {
        Args: {
          p_camp_id: string
          p_organization_id: string
          p_states: Json
          p_supplier_account_id: string
        }
        Returns: Json
      }
      replace_supplier_match_candidates: {
        Args: {
          p_candidates: Json
          p_matcher_version: string
          p_organization_id: string
          p_supplier_account_id: string
        }
        Returns: Json
      }
      request_jwt_database_role: { Args: never; Returns: string }
      review_dietary_need: {
        Args: { p_dietary_need_id: string; p_tag_labels: string[] }
        Returns: undefined
      }
      rotate_scoutnet_connection: {
        Args: {
          p_actor_aal: string
          p_actor_user_id: string
          p_camp_id: string
          p_participants_api_key?: string
          p_project_id?: string
          p_questions_api_key?: string
        }
        Returns: Json
      }
      save_meal: {
        Args: {
          p_camp_id: string
          p_meal_id: string
          p_meal_type: string
          p_recipe_version_id: string
          p_reserves: Json
          p_starts_at: string
          p_title: string
        }
        Returns: string
      }
      save_meal_pre_slots: {
        Args: {
          p_camp_id: string
          p_meal_id: string
          p_meal_type: string
          p_recipe_version_id: string
          p_reserves: Json
          p_starts_at: string
          p_title: string
        }
        Returns: string
      }
      save_meal_to_slot: {
        Args: {
          p_camp_id: string
          p_meal_id: string
          p_meal_slot_id: string
          p_recipe_version_id: string
          p_reserves: Json
          p_title: string
        }
        Returns: string
      }
      save_repeating_extra_meals: {
        Args: {
          p_camp_id: string
          p_meal_type: string
          p_recipe_version_id: string
          p_reserves: Json
          p_service_dates: string[]
          p_start_time: string
          p_title: string
        }
        Returns: Json
      }
      save_supplier_account: {
        Args: {
          p_customer_number: string
          p_display_name: string
          p_organization_id: string
          p_provider_key: string
        }
        Returns: string
      }
      save_supplier_account_identity: {
        Args: {
          p_account_key: string
          p_customer_number: string
          p_display_name: string
          p_organization_id: string
          p_provider_key: string
          p_provider_location_id: string
        }
        Returns: string
      }
      save_supplier_import_column_profile: {
        Args: {
          p_column_mapping: Json
          p_organization_id: string
          p_profile_name: string
          p_source_kind: string
          p_supplier_account_id: string
        }
        Returns: string
      }
      save_supplier_product_match: {
        Args: {
          p_amount_per_purchase_unit: number
          p_availability_status?: string
          p_canonical_key: string
          p_currency?: string
          p_display_name: string
          p_gtin?: string
          p_minimum_order_units?: number
          p_organization_id: string
          p_package_amount: number
          p_package_unit: string
          p_price?: number
          p_price_valid_from?: string
          p_price_valid_to?: string
          p_purchase_unit: string
          p_required_unit: string
          p_supplier_account_id: string
          p_supplier_article_number: string
        }
        Returns: string
      }
      save_supplier_semantic_match_cache: {
        Args: {
          p_adapter: string
          p_candidate_set_fingerprint: string
          p_canonical_key: string
          p_context_fingerprint: string
          p_model: string
          p_organization_id: string
          p_prompt_version: string
          p_result: Json
          p_supplier_account_id: string
        }
        Returns: Json
      }
      set_meal_slot_service_status: {
        Args: { p_service_status: string; p_slot_id: string }
        Returns: undefined
      }
      set_supply_list_status: {
        Args: {
          p_expected_version: number
          p_list_id: string
          p_status: Database["public"]["Enums"]["supply_list_status"]
        }
        Returns: number
      }
      set_supply_list_status_legacy: {
        Args: {
          p_expected_version: number
          p_list_id: string
          p_status: Database["public"]["Enums"]["supply_list_status"]
        }
        Returns: number
      }
      set_supply_list_status_pre_completed_delivery_lock: {
        Args: {
          p_expected_version: number
          p_list_id: string
          p_status: Database["public"]["Enums"]["supply_list_status"]
        }
        Returns: number
      }
      set_supply_list_status_pre_meal_readiness: {
        Args: {
          p_expected_version: number
          p_list_id: string
          p_status: Database["public"]["Enums"]["supply_list_status"]
        }
        Returns: number
      }
      stage_supplier_import_rows: {
        Args: {
          p_import_run_id: string
          p_organization_id: string
          p_rows: Json
          p_supplier_account_id: string
        }
        Returns: Json
      }
      start_supplier_import: {
        Args: {
          p_column_profile_id: string
          p_organization_id: string
          p_source_fingerprint: string
          p_source_kind: string
          p_source_name: string
          p_supplier_account_id: string
        }
        Returns: string
      }
      supplier_delivery_override_purchase_units: {
        Args: {
          p_amount: number
          p_amount_per_purchase_unit: number
          p_purchase_unit: string
          p_required_unit: string
          p_unit: string
        }
        Returns: number
      }
      supplier_expected_amount: {
        Args: {
          p_package_amount: number
          p_package_unit: string
          p_required_unit: string
        }
        Returns: number
      }
      supplier_import_row_errors: {
        Args: { p_normalized_data: Json }
        Returns: Json
      }
      supplier_jsonb_integer: { Args: { p_value: Json }; Returns: number }
      supplier_jsonb_numeric: { Args: { p_value: Json }; Returns: number }
      supplier_order_unit_label: {
        Args: { p_amount: number; p_unit: string }
        Returns: string
      }
      supplier_product_expected_amount: {
        Args: {
          p_package_amount: number
          p_package_unit: string
          p_packaging_metadata: Json
          p_required_unit: string
        }
        Returns: number
      }
      supplier_product_fingerprint:
        | {
            Args: {
              p_catch_weight: boolean
              p_display_name: string
              p_gtin: string
              p_minimum_order_units: number
              p_package_amount: number
              p_package_unit: string
              p_purchase_unit: string
              p_supplier_article_number: string
            }
            Returns: string
          }
        | {
            Args: {
              p_catch_weight: boolean
              p_display_name: string
              p_gtin: string
              p_minimum_order_units: number
              p_package_amount: number
              p_package_unit: string
              p_packaging_metadata: Json
              p_purchase_unit: string
              p_supplier_article_number: string
            }
            Returns: string
          }
      supplier_safe_match_score: {
        Args: {
          p_canonical_key: string
          p_organization_id: string
          p_required_unit: string
          p_supplier_account_id: string
          p_supplier_product_id: string
        }
        Returns: number
      }
      supplier_unit_base_factor: { Args: { p_unit: string }; Returns: number }
      supplier_unit_dimension: { Args: { p_unit: string }; Returns: string }
      supplier_verified_inner_unit_count: {
        Args: { p_packaging_metadata: Json }
        Returns: number
      }
      switch_meal_recipe_version: {
        Args: { p_meal_id: string; p_recipe_version_id: string }
        Returns: string
      }
      sync_manual_purchase_delivery_allocations: {
        Args: {
          p_camp_id: string
          p_canonical_key?: string
          p_organization_id: string
        }
        Returns: Json
      }
      sync_manual_purchase_delivery_allocations_proportional_legacy: {
        Args: {
          p_camp_id: string
          p_canonical_key?: string
          p_organization_id: string
        }
        Returns: Json
      }
      sync_supplier_order_delivery_allocations: {
        Args: {
          p_camp_id: string
          p_canonical_key?: string
          p_organization_id: string
        }
        Returns: Json
      }
      sync_supplier_order_delivery_allocations_proportional_legacy: {
        Args: {
          p_camp_id: string
          p_canonical_key?: string
          p_organization_id: string
        }
        Returns: Json
      }
      temporal_delivery_allocation_plan: {
        Args: {
          p_allocation_scale: number
          p_rows: Json
          p_total_amount: number
        }
        Returns: Json
      }
      update_participant_details: {
        Args: {
          p_attendance_end: string
          p_attendance_start: string
          p_display_name: string
          p_division: string
          p_food_factor: number
          p_meal_group: string
          p_participant_id: string
          p_patrol: string
        }
        Returns: undefined
      }
      update_scoutnet_question_mapping: {
        Args: {
          p_actor_aal: string
          p_actor_user_id: string
          p_camp_id: string
          p_question_mapping: Json
        }
        Returns: Json
      }
      update_supply_item: {
        Args: {
          p_comment: string
          p_completed: boolean
          p_expected_version: number
          p_item_id: string
          p_ordered_amount: number
          p_ordered_unit: string
          p_package_note: string
        }
        Returns: number
      }
    }
    Enums: {
      calculation_status: "current" | "stale" | "superseded"
      camp_status: "draft" | "active" | "archived"
      dietary_review_status: "unreviewed" | "reviewed" | "resolved"
      dietary_rule: "standard" | "exclude" | "only"
      group_kind: "division" | "patrol" | "meal_group"
      import_status: "draft" | "validated" | "imported" | "rejected"
      ingredient_mode: "weighted_portion" | "head" | "fixed_once_per_camp"
      meal_status: "draft" | "ready" | "blocked"
      membership_status: "active" | "suspended"
      organization_role: "admin" | "planner"
      participant_data_source: "local" | "scoutnet"
      participant_lifecycle_status: "active" | "withdrawn"
      recipe_status: "draft" | "published" | "retired"
      scoutnet_registration_status: "confirmed" | "unconfirmed" | "cancelled"
      supply_list_kind: "purchase" | "distribution" | "delivery"
      supply_list_status: "draft" | "active" | "complete"
      supply_mutation_status: "applied" | "conflict"
    }
    CompositeTypes: {
      generated_supply_row: {
        kind: Database["public"]["Enums"]["supply_list_kind"] | null
        list_key: string | null
        list_title: string | null
        meal_group_id: string | null
        range_start: string | null
        range_end: string | null
        item_key: string | null
        category: string | null
        item_name: string | null
        required_amount: number | null
        required_unit: string | null
        source_line_keys: Json | null
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      calculation_status: ["current", "stale", "superseded"],
      camp_status: ["draft", "active", "archived"],
      dietary_review_status: ["unreviewed", "reviewed", "resolved"],
      dietary_rule: ["standard", "exclude", "only"],
      group_kind: ["division", "patrol", "meal_group"],
      import_status: ["draft", "validated", "imported", "rejected"],
      ingredient_mode: ["weighted_portion", "head", "fixed_once_per_camp"],
      meal_status: ["draft", "ready", "blocked"],
      membership_status: ["active", "suspended"],
      organization_role: ["admin", "planner"],
      participant_data_source: ["local", "scoutnet"],
      participant_lifecycle_status: ["active", "withdrawn"],
      recipe_status: ["draft", "published", "retired"],
      scoutnet_registration_status: ["confirmed", "unconfirmed", "cancelled"],
      supply_list_kind: ["purchase", "distribution", "delivery"],
      supply_list_status: ["draft", "active", "complete"],
      supply_mutation_status: ["applied", "conflict"],
    },
  },
} as const
