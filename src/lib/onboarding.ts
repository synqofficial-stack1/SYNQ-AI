import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type OnboardingAnswers = {
  q1_role: string | null;
  q2_business: string | null;
  q3_industry: string | null;
  q3_industry_other: string;
  q4_team_size: string | null;
  q5_challenges: string[];
  q6_first_goal: string | null;
  q7_departments: string[];
  q8_ai_familiarity: string | null;
  q9_work_style: string | null;
  q10_response_style: string | null;
  q11_priority: string | null;
  q12_business_context: string;
  q13_discovery_source: string | null;
  q13_discovery_source_other: string;
  q14_trial_reason: string | null;
  q15_indispensable_outcome: string;
};

export type OnboardingRow = OnboardingAnswers & {
  user_id: string;
  required: boolean;
  status: 'draft' | 'completed';
  schema_version: number;
  completed_at: string | null;
  updated_at: string;
};

export const EMPTY_ONBOARDING_ANSWERS: OnboardingAnswers = {
  q1_role: null,
  q2_business: null,
  q3_industry: null,
  q3_industry_other: '',
  q4_team_size: null,
  q5_challenges: [],
  q6_first_goal: null,
  q7_departments: [],
  q8_ai_familiarity: null,
  q9_work_style: null,
  q10_response_style: null,
  q11_priority: null,
  q12_business_context: '',
  q13_discovery_source: null,
  q13_discovery_source_other: '',
  q14_trial_reason: null,
  q15_indispensable_outcome: '',
};

export async function loadOnboarding(userId: string): Promise<OnboardingRow | null> {
  const { data, error } = await supabase
    .from('user_onboarding_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    const local = await loadLocalDraft(userId);
    if (local) return local;
    throw new Error(error.message);
  }
  if (!data) {
    const local = await loadLocalDraft(userId);
    if (local) return local;
  }
  if (data?.status === 'draft') {
    const local = await loadLocalDraft(userId);
    if (local && local.updated_at > data.updated_at) return local;
  }
  return data as OnboardingRow | null;
}

export async function saveOnboardingDraft(userId: string, answers: OnboardingAnswers) {
  await saveLocalDraft(userId, answers);
  const { error } = await supabase.from('user_onboarding_profiles').upsert(
    { user_id: userId, ...answers, status: 'draft', completed_at: null, schema_version: 1 },
    { onConflict: 'user_id' }
  );
  if (error) throw new Error(error.message);
}

export async function completeOnboarding(userId: string, answers: OnboardingAnswers) {
  const { error } = await supabase
    .from('user_onboarding_profiles')
    .update({
      ...answers,
      status: 'completed',
      schema_version: 1,
    })
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  await removeLocalDraft(userId);
}

export async function recordOnboardingEvent(
  userId: string,
  eventName: 'started' | 'step_viewed' | 'answer_saved' | 'completed',
  step: number | null
) {
  const { error } = await supabase.from('onboarding_events').insert({
    user_id: userId,
    event_name: eventName,
    step,
  });
  if (error) throw new Error(error.message);
}

export function isOnboardingComplete(answers: OnboardingAnswers) {
  return Boolean(
    answers.q1_role && answers.q2_business && answers.q3_industry && answers.q4_team_size &&
    answers.q5_challenges.length >= 1 && answers.q5_challenges.length <= 3 && answers.q6_first_goal &&
    answers.q7_departments.length >= 1 && answers.q8_ai_familiarity && answers.q9_work_style &&
    answers.q10_response_style && answers.q11_priority && answers.q13_discovery_source && answers.q14_trial_reason
  );
}

function draftKey(userId: string) {
  return `synq:onboarding-draft:${userId}`;
}

async function getLocal(key: string) {
  if (Platform.OS === 'web') {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return AsyncStorage.getItem(key);
}

async function setLocal(key: string, value: string) {
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* server rendering or storage disabled */ }
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function removeLocal(key: string) {
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.removeItem(key); } catch { /* server rendering or storage disabled */ }
    return;
  }
  await AsyncStorage.removeItem(key);
}

async function saveLocalDraft(userId: string, answers: OnboardingAnswers) {
  await setLocal(draftKey(userId), JSON.stringify({ answers, saved_at: new Date().toISOString() }));
}

async function loadLocalDraft(userId: string): Promise<OnboardingRow | null> {
  try {
    const raw = await getLocal(draftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const answers = { ...EMPTY_ONBOARDING_ANSWERS, ...(parsed.answers ?? parsed) } as OnboardingAnswers;
    return {
      ...answers,
      user_id: userId,
      required: true,
      status: 'draft',
      schema_version: 1,
      completed_at: null,
      updated_at: parsed.saved_at ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function removeLocalDraft(userId: string) {
  await removeLocal(draftKey(userId));
}
