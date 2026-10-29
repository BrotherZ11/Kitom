import { ANALYSIS_COLUMNS } from '@/features/ai-analysis/ai-analysis-model';
import { DAILY_LOG_COLUMNS } from '@/features/daily-logs/daily-log-history';
import { fetchAllPages, type ExportInput } from '@/features/data-export/data-export';
import { PET_COLUMNS } from '@/features/pets/api/pets-remote';
import { REMINDER_COLUMNS } from '@/features/reminders/reminder-model';
import { supabase } from '@/lib/supabase';

/**
 * Lee todo lo que el usuario puede ver de sí mismo y de sus mascotas (RLS decide qué). Solo columnas
 * con GRANT SELECT para `authenticated`; los catálogos van como ids. Lanza el error de supabase-js tal
 * cual. Contrato: `docs/FRONTEND_ARCHITECTURE.md` §4 «DataExportScreen».
 */

const PROFILE_COLUMNS =
  'full_name, locale, timezone, disclaimer_accepted_at, disclaimer_version, onboarding_completed_at, marketing_opt_in, created_at, updated_at';
const PREFERENCE_COLUMNS =
  'daily_reminder_enabled, daily_reminder_time, alert_notifications_enabled, marketing_notifications_enabled, updated_at';

type ExportData = Omit<ExportInput, 'exportedAt' | 'appVersion' | 'account'>;

export async function fetchExportData(userId: string): Promise<ExportData> {
  const [profile, preferences, subscription, pets] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
    supabase.from('notification_preferences').select(PREFERENCE_COLUMNS).eq('user_id', userId).maybeSingle(),
    supabase.from('subscriptions').select('plan, status, created_at').eq('user_id', userId).maybeSingle(),
    fetchAllPages((from, to) => supabase.from('pets').select(PET_COLUMNS).order('created_at').range(from, to)),
  ]);
  for (const result of [profile, preferences, subscription]) if (result.error) throw result.error;

  const petIds = pets.map((pet) => pet.id);
  if (petIds.length === 0) {
    return {
      profile: profile.data,
      notificationPreferences: preferences.data,
      subscription: subscription.data,
      pets: [],
      dailyLogs: [],
      reminders: [],
      aiAnalyses: [],
      aiAnalysisSymptoms: [],
      achievements: [],
      streaks: [],
      members: [],
    };
  }

  const [dailyLogs, reminders, aiAnalyses, achievements, streaks, members] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase.from('daily_logs').select(DAILY_LOG_COLUMNS).in('pet_id', petIds).order('log_date').order('id').range(from, to)
    ),
    fetchAllPages((from, to) =>
      supabase.from('reminders').select(REMINDER_COLUMNS).in('pet_id', petIds).order('due_at').order('id').range(from, to)
    ),
    fetchAllPages((from, to) =>
      supabase.from('ai_analysis_requests').select(ANALYSIS_COLUMNS).in('pet_id', petIds).order('created_at').range(from, to)
    ),
    fetchAllPages((from, to) =>
      supabase.from('pet_achievements').select('pet_id, achievement_id, earned_at').in('pet_id', petIds).order('earned_at').range(from, to)
    ),
    fetchAllPages((from, to) =>
      supabase.from('pet_streaks').select('pet_id, current_streak, longest_streak, last_log_date').in('pet_id', petIds).range(from, to)
    ),
    fetchAllPages((from, to) =>
      supabase
        .from('pet_co_owners')
        .select('pet_id, user_id, role, status, invited_at, accepted_at')
        .in('pet_id', petIds)
        .order('invited_at')
        .range(from, to)
    ),
  ]);

  const analysisIds = aiAnalyses.map((analysis) => analysis.id);
  const aiAnalysisSymptoms =
    analysisIds.length === 0
      ? []
      : await fetchAllPages((from, to) =>
          supabase.from('ai_analysis_symptoms').select('analysis_id, symptom_id').in('analysis_id', analysisIds).range(from, to)
        );

  return {
    profile: profile.data,
    notificationPreferences: preferences.data,
    subscription: subscription.data,
    pets,
    dailyLogs,
    reminders,
    aiAnalyses,
    aiAnalysisSymptoms,
    achievements,
    streaks,
    members,
  };
}
