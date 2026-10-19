import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AccentColors, Radius } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import {
  completeOnboarding,
  EMPTY_ONBOARDING_ANSWERS,
  isOnboardingComplete,
  loadOnboarding,
  recordOnboardingEvent,
  saveOnboardingDraft,
  type OnboardingAnswers,
} from '@/lib/onboarding';

type Question = {
  key: keyof OnboardingAnswers;
  title: string;
  options?: { id: string; label: string }[];
  multi?: boolean;
  max?: number;
  optional?: boolean;
  placeholder?: string;
};

const QUESTIONS: Question[] = [
  { key: 'q1_role', title: 'Which best describes you?', options: options('founder_owner|Founder / business owner', 'professional|Working professional', 'student_aspiring_entrepreneur|Student / aspiring entrepreneur', 'agency_freelancer|Agency / freelancer', 'company_employee|Employee at a company', 'other|Other') },
  { key: 'q2_business', title: 'What best describes your business?', options: options('exploring_idea|Just exploring an idea', 'planning_launch|Planning to launch', 'recently_launched|Recently launched', 'growing_business|Growing an existing business', 'established_business|Established business') },
  { key: 'q3_industry', title: 'What industry are you in?', options: options('technology_saas|Technology / SaaS', 'ecommerce_retail|E-commerce / retail', 'marketing_agency|Marketing / agency', 'professional_services|Professional services', 'education|Education', 'food_hospitality|Food / hospitality', 'other|Other') },
  { key: 'q4_team_size', title: 'How big is your team?', options: options('just_me|Just me', '2_5|2–5 people', '6_20|6–20 people', '21_100|21–100 people', '100_plus|100+ people') },
  { key: 'q5_challenges', title: "What's the biggest challenge you're trying to solve?", options: options('finding_converting_customers|Finding and converting customers', 'marketing_content|Creating marketing content', 'repetitive_work|Managing repetitive work', 'customer_support|Customer support', 'market_competitor_research|Researching markets and competitors', 'business_operations|Managing business operations', 'business_planning_launch|Planning and launching a business', 'saving_time_costs|Saving time and reducing costs'), multi: true, max: 3 },
  { key: 'q6_first_goal', title: 'What do you want Synq to help you achieve first?', options: options('find_customers|Find new customers', 'generate_sales|Generate more sales', 'grow_audience|Grow my audience', 'automate_tasks|Automate repetitive tasks', 'launch_business|Launch my business', 'run_efficiently|Run my business more efficiently', 'explore_ai|Explore what AI can do') },
  { key: 'q7_departments', title: 'Which departments would you like help with?', options: options('sales|Sales', 'marketing|Marketing', 'research|Research', 'operations|Operations', 'customer_support|Customer support', 'finance|Finance', 'hr|HR'), multi: true },
  { key: 'q8_ai_familiarity', title: 'How familiar are you with AI tools?', options: options('beginner|Beginner, guide me through everything', 'intermediate|Intermediate, I know the basics', 'advanced|Advanced, let me customize things') },
  { key: 'q9_work_style', title: 'How should Synq work with you?', options: options('minimal_input|Do things for me with minimal input', 'suggest_ask_approval|Suggest actions and ask for approval', 'step_by_step|Guide me step by step', 'full_control|Let me control everything') },
  { key: 'q10_response_style', title: 'What kind of responses do you prefer?', options: options('short_direct|Short and direct', 'detailed|Detailed explanations', 'step_by_step|Step-by-step instructions', 'pros_cons|Recommendations with pros and cons') },
  { key: 'q11_priority', title: "What's your biggest priority right now?", options: options('grow_revenue|Growing revenue', 'save_time|Saving time', 'reduce_costs|Reducing costs', 'build_business|Building a new business', 'improve_productivity|Improving productivity', 'learn_ai|Learning how to use AI') },
  { key: 'q12_business_context', title: 'Is there anything Synq should know about your business?', optional: true, placeholder: 'Tell us about your business, product, target customers, or goals...' },
  { key: 'q13_discovery_source', title: 'Where did you first hear about Synq?', options: options('instagram|Instagram', 'youtube|YouTube', 'linkedin|LinkedIn', 'x|X (Twitter)', 'google_search|Google search', 'reddit_communities|Reddit / online communities', 'friend_colleague|A friend or colleague', 'influencer_creator|An influencer / creator', 'blog_newsletter|A blog, article, or newsletter', 'other|Other') },
  { key: 'q14_trial_reason', title: 'What convinced you to try Synq?', options: options('ai_employees|AI employees doing real work', 'sales_acquisition|Sales and customer acquisition', 'marketing_automation|Marketing automation', 'fewer_manual_tasks|Running a business with fewer manual tasks', 'ai_curiosity|Curiosity about AI', 'recommendation|A recommendation from someone') },
  { key: 'q15_indispensable_outcome', title: 'What would make Synq indispensable to you?', optional: true, placeholder: "Tell us what outcome would make Synq essential to your work..." },
];

function options(...items: string[]) {
  return items.map((item) => {
    const [id, label] = item.split('|');
    return { id, label };
  });
}

export default function OnboardingScreen() {
  const { session, isLoading: sessionLoading } = useSession();
  const theme = useTheme();
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ONBOARDING_ANSWERS);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyAccount, setLegacyAccount] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggedStarted = useRef(false);

  useEffect(() => {
    if (!session?.user.id) return;
    let active = true;
    loadOnboarding(session.user.id).then(async (row) => {
      if (!active) return;
      if (!row || !row.required) {
        setLegacyAccount(true);
        setLoading(false);
        return;
      }
      if (row.status === 'completed') {
        router.replace('/(app)');
        return;
      }
      const loaded: OnboardingAnswers = { ...EMPTY_ONBOARDING_ANSWERS, ...row };
      setAnswers(loaded);
      // Apply the same rules used by Continue, including the conditional text
      // fields shown when a user picks “Other”. This brings older/incomplete
      // drafts back to the field the database requires before completion.
      const firstUnanswered = QUESTIONS.findIndex((question) => !canContinue(loaded, question));
      setStep(firstUnanswered < 0 ? QUESTIONS.length - 1 : firstUnanswered);
      setLoading(false);
      if (!loggedStarted.current) {
        loggedStarted.current = true;
        await recordOnboardingEvent(session.user.id, 'started', null).catch(() => undefined);
      }
    }).catch((e: unknown) => {
      if (active) {
        setError(e instanceof Error ? e.message : 'Could not load onboarding. Check your connection and retry.');
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id || loading || legacyAccount) return;
    recordOnboardingEvent(session.user.id, 'step_viewed', step + 1).catch(() => undefined);
  }, [step, session?.user.id, loading, legacyAccount]);

  const question = QUESTIONS[step];
  const ready = useMemo(() => canContinue(answers, question), [answers, question]);

  if (sessionLoading || loading) return <ThemedView style={styles.center}><ActivityIndicator color={AccentColors.primary} /></ThemedView>;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (legacyAccount) return <Redirect href="/(app)" />;

  function persist(next: OnboardingAnswers, textDebounce = false) {
    if (!session?.user.id) return;
    setSaving(true);
    setError(null);
    if (debounce.current) clearTimeout(debounce.current);
    const write = () => {
      queue.current = queue.current
        .then(() => saveOnboardingDraft(session.user.id, next))
        .then(() => setSaving(false))
        .catch(() => {
          setSaving(false);
          setError('Could not sync right now. Your draft is saved on this device and will sync when you are online.');
        });
    };
    if (textDebounce) debounce.current = setTimeout(write, 450);
    else write();
  }

  function update(key: keyof OnboardingAnswers, value: string | string[]) {
    const next = { ...answers, [key]: value } as OnboardingAnswers;
    setAnswers(next);
    persist(next, typeof value === 'string' && key.includes('context') || key === 'q15_indispensable_outcome' || key === 'q3_industry_other' || key === 'q13_discovery_source_other');
  }

  function toggleOption(key: keyof OnboardingAnswers, id: string, multi: boolean, max?: number) {
    if (!multi) {
      update(key, id);
      return;
    }
    const selected = (answers[key] as string[]) ?? [];
    const next = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : max && selected.length >= max ? selected : [...selected, id];
    update(key, next);
  }

  async function next() {
    if (!ready || !session?.user.id) return;
    if (debounce.current) {
      clearTimeout(debounce.current);
      debounce.current = null;
      queue.current = queue.current.catch(() => undefined)
        .then(() => saveOnboardingDraft(session.user.id, answers))
        .then(() => setSaving(false))
        .catch(() => {
          setSaving(false);
          setError('Could not sync right now. Your draft is saved on this device and will sync when you are online.');
        });
    }
    await queue.current;
    await recordOnboardingEvent(session.user.id, 'answer_saved', step + 1).catch(() => undefined);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    if (!isOnboardingComplete(answers)) {
      const missingStep = QUESTIONS.findIndex((item) => !canContinue(answers, item));
      if (missingStep >= 0) setStep(missingStep);
      setError(missingStep >= 0
        ? 'Please complete this required answer before finishing setup.'
        : 'Some required answers are missing. Review your answers and try again.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await completeOnboarding(session.user.id, answers);
      await recordOnboardingEvent(session.user.id, 'completed', 15).catch(() => undefined);
      router.replace('/(app)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish setup. Your answers are saved; please retry.');
    } finally {
      setSaving(false);
    }
  }

  const isOtherField = question.key === 'q3_industry' && answers.q3_industry === 'other'
    ? 'q3_industry_other'
    : question.key === 'q13_discovery_source' && answers.q13_discovery_source === 'other'
      ? 'q13_discovery_source_other'
      : null;
  const textValue = answers[question.key];

  return (
    <ThemedView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.topline}>
          <ThemedText style={styles.brand}>Synq</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">Your setup · {step + 1} of {QUESTIONS.length}</ThemedText>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
          <View style={[styles.progressFill, { width: `${((step + 1) / QUESTIONS.length) * 100}%` }]} />
        </View>

        <View style={styles.intro}>
          {step === 0 ? <ThemedText type="caption" themeColor="textSecondary">Tell us about your business</ThemedText> : null}
          {step < 4 ? <ThemedText type="caption" themeColor="textSecondary">Essential context for the Company Brain</ThemedText> : null}
          {step >= 4 && step <= 6 ? <ThemedText type="caption" themeColor="textSecondary">Understand what you want from Synq</ThemedText> : null}
          {step >= 7 && step <= 11 ? <ThemedText type="caption" themeColor="textSecondary">Personalize the AI experience</ThemedText> : null}
          {step >= 12 ? <ThemedText type="caption" themeColor="textSecondary">Help us understand how you found Synq</ThemedText> : null}
          <ThemedText type="pageTitle" style={styles.title}>{question.title}</ThemedText>
          {question.multi ? <ThemedText type="caption" themeColor="textSecondary">Select all that apply{question.max ? ` · up to ${question.max}` : ''}</ThemedText> : null}
          {question.optional ? <ThemedText type="caption" themeColor="textSecondary">Optional</ThemedText> : null}
        </View>

        {question.options ? (
          <View style={styles.options}>
            {question.options.map((option) => {
              const value = answers[question.key];
              const selected = Array.isArray(value) ? value.includes(option.id) : value === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => toggleOption(question.key, option.id, Boolean(question.multi), question.max)}
                  accessibilityRole={question.multi ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: selected }}
                  style={[styles.option, { backgroundColor: selected ? `${AccentColors.primary}20` : theme.surface, borderColor: selected ? AccentColors.primary : theme.border }]}
                >
                  <ThemedText style={[styles.optionLabel, selected && styles.selectedLabel]}>{option.label}</ThemedText>
                  <View style={[styles.indicator, { borderColor: selected ? AccentColors.primary : theme.borderStrong, backgroundColor: selected ? AccentColors.primary : 'transparent' }]}>
                    {selected ? <ThemedText style={styles.check}>✓</ThemedText> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <TextInput
            multiline
            maxLength={question.key === 'q12_business_context' ? 1000 : 500}
            value={typeof textValue === 'string' ? textValue : ''}
            onChangeText={(value) => update(question.key, value)}
            placeholder={question.placeholder}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
            textAlignVertical="top"
          />
        )}

        {isOtherField ? (
          <TextInput
            maxLength={120}
            value={answers[isOtherField]}
            onChangeText={(value) => update(isOtherField, value)}
            placeholder="Tell us which one"
            placeholderTextColor={theme.textSecondary}
            style={[styles.otherInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
          />
        ) : null}

        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
        <View style={styles.footer}>
          {step > 0 ? (
            <Pressable onPress={() => setStep(step - 1)} style={[styles.backButton, { borderColor: theme.border }]} accessibilityRole="button">
              <ThemedText>Back</ThemedText>
            </Pressable>
          ) : <View />}
          <View style={styles.footerRight}>
            <ThemedText type="caption" themeColor="textSecondary">{saving ? 'Saving…' : 'Your answers are saved'}</ThemedText>
            <Pressable onPress={next} disabled={!ready || saving} style={[styles.nextButton, (!ready || saving) && styles.disabled]} accessibilityRole="button">
              {saving ? <ActivityIndicator color="#111" /> : <ThemedText style={styles.nextText}>{step === QUESTIONS.length - 1 ? 'Finish setup' : 'Continue'}</ThemedText>}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function canContinue(answers: OnboardingAnswers, question: Question) {
  const value = answers[question.key];
  if (question.optional) return true;
  if (Array.isArray(value)) return value.length > 0 && (!question.max || value.length <= question.max);
  if (!value) return false;
  if (question.key === 'q3_industry') return value !== 'other' || Boolean((answers.q3_industry_other ?? '').trim());
  if (question.key === 'q13_discovery_source') return value !== 'other' || Boolean((answers.q13_discovery_source_other ?? '').trim());
  return true;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 780, alignSelf: 'center', padding: 28, paddingTop: 34, paddingBottom: 48 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  brand: { fontSize: 20, fontWeight: '800', color: AccentColors.primaryLight },
  progressTrack: { height: 5, borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: AccentColors.primary, borderRadius: 5 },
  intro: { gap: 10, marginTop: 38, marginBottom: 26 },
  title: { fontSize: 27, lineHeight: 34 },
  options: { gap: 10 },
  option: { minHeight: 58, borderWidth: 1, borderRadius: Radius.card, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  optionLabel: { flex: 1, fontSize: 15, lineHeight: 21 },
  selectedLabel: { fontWeight: '600' },
  indicator: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  check: { color: '#111', fontSize: 13, lineHeight: 17, fontWeight: '800' },
  input: { minHeight: 150, borderWidth: 1, borderRadius: Radius.card, padding: 16, fontSize: 15, lineHeight: 22 },
  otherInput: { minHeight: 48, borderWidth: 1, borderRadius: Radius.card, paddingHorizontal: 14, marginTop: 12, fontSize: 15 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 30, gap: 12 },
  footerRight: { alignItems: 'flex-end', gap: 10 },
  backButton: { minHeight: 46, minWidth: 92, paddingHorizontal: 18, borderWidth: 1, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center' },
  nextButton: { minHeight: 48, minWidth: 146, paddingHorizontal: 22, borderRadius: Radius.control, backgroundColor: AccentColors.primary, alignItems: 'center', justifyContent: 'center' },
  nextText: { color: '#151515', fontWeight: '700' },
  disabled: { opacity: 0.45 },
  error: { color: AccentColors.error, marginTop: 14 },
});
