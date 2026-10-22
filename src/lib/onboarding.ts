import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { hasSevenQuestionAnswers } from '@/lib/onboarding-questions';
import { supabase } from '@/lib/supabase';

export type OnboardingAnswers = {
  q1: string | null;
  q2: string | null;
  q3: string | null;
  q4: string | null;
  q5: string | null;
  q6: string | null;
  q7: string | null;
  otherAnswers: Record<string, string>;
  businessName: string;
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
  q1: null, q2: null, q3: null, q4: null, q5: null, q6: null, q7: null,
  otherAnswers: {}, businessName: '',
};

function parseAnswers(value: unknown): OnboardingAnswers | null {
  // An empty object means the row predates v2; returning null lets the legacy import run.
  if (!hasSevenQuestionAnswers(value)) return null;
  const row = value;
  return {
    ...EMPTY_ONBOARDING_ANSWERS,
    q1: typeof row.q1 === 'string' ? row.q1 : null,
    q2: typeof row.q2 === 'string' ? row.q2 : null,
    q3: typeof row.q3 === 'string' ? row.q3 : null,
    q4: typeof row.q4 === 'string' ? row.q4 : null,
    q5: typeof row.q5 === 'string' ? row.q5 : null,
    q6: typeof row.q6 === 'string' ? row.q6 : null,
    q7: typeof row.q7 === 'string' ? row.q7 : null,
    otherAnswers: row.otherAnswers && typeof row.otherAnswers === 'object' && !Array.isArray(row.otherAnswers)
      ? Object.fromEntries(Object.entries(row.otherAnswers as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      : {},
    businessName: typeof row.businessName === 'string' ? row.businessName : '',
  };
}

function importLegacyAnswers(value: Record<string, unknown>): OnboardingAnswers {
  const result = { ...EMPTY_ONBOARDING_ANSWERS };
  const custom = (key: string, text: unknown) => {
    if (typeof text === 'string' && text.trim()) result.otherAnswers[key] = text.trim().slice(0, 120);
  };
  const oldRole = String(value.q1_role ?? '');
  result.q1 = oldRole === 'founder_owner' ? 'starting_business'
    : oldRole === 'company_employee' ? 'existing_company'
      : oldRole === 'other' ? 'other' : oldRole ? 'other' : null;
  if (result.q1 === 'other' && oldRole !== 'other') custom('q1', oldRole.replace(/_/g, ' '));
  const oldIndustry = String(value.q3_industry ?? '');
  result.q2 = oldIndustry === 'technology_saas' ? 'technology_saas'
    : oldIndustry === 'ecommerce_retail' ? 'ecommerce_retail'
      : ['marketing_agency', 'professional_services'].includes(oldIndustry) ? 'services_agency'
        : oldIndustry ? 'other' : null;
  if (result.q2 === 'other') custom('q2', value.q3_industry_other || (oldIndustry === 'other' ? '' : oldIndustry.replace(/_/g, ' ')));
  const oldStage = String(value.q2_business ?? '');
  result.q3 = oldStage === 'exploring_idea' ? 'idea'
    : oldStage === 'planning_launch' ? 'building'
      : ['recently_launched', 'growing_business', 'established_business'].includes(oldStage) ? 'first_customers'
        : oldStage ? 'other' : null;
  if (result.q3 === 'other') custom('q3', oldStage.replace(/_/g, ' '));
  const challenges = Array.isArray(value.q5_challenges) ? value.q5_challenges.map(String) : [];
  const firstChallenge = challenges[0] ?? '';
  result.q5 = ['finding_converting_customers', 'sales_acquisition'].includes(firstChallenge) ? 'sales'
    : firstChallenge === 'marketing_content' ? 'brand_content'
      : ['repetitive_work', 'business_operations'].includes(firstChallenge) ? 'automate'
        : firstChallenge ? 'other' : null;
  if (result.q5 === 'other') custom('q5', firstChallenge.replace(/_/g, ' '));
  result.q6 = ['finding_converting_customers', 'sales_followups'].includes(firstChallenge) ? 'sales_followups'
    : firstChallenge === 'marketing_content' ? 'marketing_content'
      : firstChallenge ? 'other' : null;
  if (result.q6 === 'other') custom('q6', firstChallenge.replace(/_/g, ' '));
  const workStyle = String(value.q9_work_style ?? '');
  result.q7 = workStyle === 'minimal_input' ? 'do_tasks'
    : workStyle === 'step_by_step' ? 'guide'
      : workStyle ? 'recommend' : null;
  const oldGoal = String(value.q6_first_goal ?? '');
  result.q5 ??= oldGoal === 'find_customers' || oldGoal === 'generate_sales' ? 'sales'
    : oldGoal === 'grow_audience' ? 'brand_content' : oldGoal ? 'automate' : null;
  return result;
}

export async function loadOnboarding(userId: string): Promise<OnboardingRow | null> {
  const { data, error } = await supabase.from('user_onboarding_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    const local = await loadLocalDraft(userId);
    if (local) return local;
    throw new Error(error.message);
  }
  if (!data) return loadLocalDraft(userId);
  const saved = parseAnswers((data as Record<string, unknown>).answers_v2);
  const draft = await loadLocalDraft(userId);
  let legacy = saved ? null : importLegacyAnswers(data as Record<string, unknown>);
  if (legacy && !legacy.businessName) {
    const { data: profile } = await supabase.from('profiles').select('business_name').eq('id', userId).maybeSingle();
    legacy.businessName = profile?.business_name ?? '';
  }
  const answers = draft && draft.updated_at > data.updated_at
    ? draft
    : saved ?? legacy ?? EMPTY_ONBOARDING_ANSWERS;
  return { ...answers, user_id: userId, required: data.required, status: data.status,
    schema_version: saved ? 2 : data.schema_version, completed_at: data.completed_at, updated_at: data.updated_at };
}

export async function saveOnboardingDraft(userId: string, answers: OnboardingAnswers) {
  await saveLocalDraft(userId, answers);
  const { error } = await supabase.rpc('save_onboarding_answers_v2', { p_answers: answers, p_complete: false });
  if (error) throw new Error(error.message);
}

export async function completeOnboarding(userId: string, answers: OnboardingAnswers) {
  const { error } = await supabase.rpc('save_onboarding_answers_v2', { p_answers: answers, p_complete: true });
  if (error) throw new Error(error.message);
  await removeLocalDraft(userId);
}

export async function recordOnboardingEvent(userId: string, eventName: 'started' | 'step_viewed' | 'answer_saved' | 'completed', step: number | null) {
  const { error } = await supabase.from('onboarding_events').insert({ user_id: userId, event_name: eventName, step });
  if (error) throw new Error(error.message);
}

export function isOnboardingComplete(answers: OnboardingAnswers) {
  return (['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] as const).every((key) => {
    const selected = answers[key];
    return Boolean(selected && (selected !== 'other' || answers.otherAnswers[key]?.trim())
      && (key !== 'q2' || answers.businessName.trim()));
  });
}

function draftKey(userId: string) { return `synq:onboarding-draft:${userId}`; }
async function getLocal(key: string) {
  if (Platform.OS === 'web') { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }
  return AsyncStorage.getItem(key);
}
async function setLocal(key: string, value: string) {
  if (Platform.OS === 'web') { try { globalThis.localStorage?.setItem(key, value); } catch { /* storage unavailable */ } return; }
  await AsyncStorage.setItem(key, value);
}
async function removeLocal(key: string) {
  if (Platform.OS === 'web') { try { globalThis.localStorage?.removeItem(key); } catch { /* storage unavailable */ } return; }
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
    const parsedAnswers = parseAnswers(parsed.answers ?? parsed) ?? importLegacyAnswers((parsed.answers ?? parsed) as Record<string, unknown>);
    return { ...parsedAnswers, user_id: userId, required: true, status: 'draft', schema_version: 2,
      completed_at: null, updated_at: parsed.saved_at ?? new Date(0).toISOString() };
  } catch { return null; }
}
async function removeLocalDraft(userId: string) { await removeLocal(draftKey(userId)); }
