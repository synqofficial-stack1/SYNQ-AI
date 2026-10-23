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
import { ONBOARDING_QUESTIONS as QUESTIONS, canContinueOnboarding } from '@/lib/onboarding-questions';

export default function OnboardingScreen() {
  const { session, isLoading: sessionLoading } = useSession();
  const theme = useTheme();
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ONBOARDING_ANSWERS);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The final "finish setup" write, kept apart from the per-answer draft save so
  // Continue stays pressable while a debounced draft save is still settling.
  const [submitting, setSubmitting] = useState(false);
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
      const firstUnanswered = QUESTIONS.findIndex((question) => !canContinueOnboarding(loaded, question));
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
  const ready = useMemo(() => canContinueOnboarding(answers, question), [answers, question]);

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

  function update(key: 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6' | 'q7', value: string | null) {
    const next = { ...answers, [key]: value } as OnboardingAnswers;
    setAnswers(next);
    persist(next);
  }

  function updateOther(key: string, value: string) {
    const next = { ...answers, otherAnswers: { ...answers.otherAnswers, [key]: value } };
    setAnswers(next);
    persist(next, true);
  }

  async function next() {
    if (!ready || submitting || !session?.user.id) return;
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
      const missingStep = QUESTIONS.findIndex((item) => !canContinueOnboarding(answers, item));
      if (missingStep >= 0) setStep(missingStep);
      setError(missingStep >= 0
        ? 'Please complete this required answer before finishing setup.'
        : 'Some required answers are missing. Review your answers and try again.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await completeOnboarding(session.user.id, answers);
      await recordOnboardingEvent(session.user.id, 'completed', QUESTIONS.length).catch(() => undefined);
      router.replace('/(app)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish setup. Your answers are saved; please retry.');
    } finally {
      setSubmitting(false);
    }
  }

  const isOtherField = answers[question.key] === 'other';

  // When Continue is disabled, say exactly what is still needed. Without this,
  // q2 (which also requires a business name) silently traps people who picked
  // an industry but did not fill the name field.
  const missingReason = !answers[question.key]
    ? 'Pick an option to continue.'
    : question.key === 'q2' && !answers.businessName.trim()
      ? 'Enter your business name above to continue.'
      : isOtherField && !(answers.otherAnswers[question.key] ?? '').trim()
        ? 'Type your answer above to continue.'
        : null;

  return (
    <ThemedView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.topline}>
          <ThemedText style={styles.brand} themeColor="accentText">Synq</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">Question {step + 1} of {QUESTIONS.length}</ThemedText>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
          <View style={[styles.progressFill, { width: `${((step + 1) / QUESTIONS.length) * 100}%` }]} />
        </View>

        <View style={styles.intro}>
          <ThemedText type="caption" themeColor="textSecondary">A little context helps Synq tailor its recommendations</ThemedText>
          <ThemedText type="pageTitle" style={styles.title}>{question.title}{question.important ? <ThemedText accessibilityLabel="Important question"> ★</ThemedText> : null}</ThemedText>
          {question.important ? <ThemedText accessibilityLabel="Important question" type="caption" themeColor="textSecondary">★ Important question</ThemedText> : null}
        </View>

        {question.key === 'q2' ? (
          <View style={styles.nameField}>
            <ThemedText type="smallBold">
              Business name <ThemedText style={{ color: AccentColors.primary }}>*</ThemedText>
            </ThemedText>
            <TextInput
              maxLength={120}
              value={answers.businessName}
              onChangeText={(value) => {
                const nextAnswers = { ...answers, businessName: value };
                setAnswers(nextAnswers);
                persist(nextAnswers, true);
              }}
              placeholder="e.g. Kaapi House"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Business name"
              style={[styles.otherInput, { marginTop: 8, color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
            />
            <ThemedText type="caption" themeColor="textSecondary" style={styles.nameHelp}>
              Then choose your industry below.
            </ThemedText>
          </View>
        ) : null}

        {(
          <View style={styles.options}>
            {question.options.map((option) => {
              const selected = answers[question.key] === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => update(question.key, option.id)}
                  accessibilityRole="radio"
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
        )}

        {isOtherField ? (
          <TextInput
            multiline
            maxLength={120}
            value={answers.otherAnswers[question.key] ?? ''}
            onChangeText={(value) => updateOther(question.key, value)}
            placeholder={question.otherPlaceholder}
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
            <ThemedText type="caption" themeColor="textSecondary">
              {submitting ? 'Finishing setup…' : saving ? 'Saving…' : !ready && missingReason ? missingReason : 'Your answers are saved'}
            </ThemedText>
            <Pressable onPress={next} disabled={!ready || submitting} style={[styles.nextButton, (!ready || submitting) && styles.disabled]} accessibilityRole="button"
              accessibilityHint={!ready && missingReason ? missingReason : undefined}
            >
              {submitting ? <ActivityIndicator color="#111" /> : <ThemedText style={styles.nextText}>{step === QUESTIONS.length - 1 ? 'Finish setup' : 'Continue'}</ThemedText>}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 780, alignSelf: 'center', padding: 28, paddingTop: 34, paddingBottom: 48 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  brand: { fontSize: 20, fontWeight: '800' },
  progressTrack: { height: 5, borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: AccentColors.primary, borderRadius: 5 },
  intro: { gap: 10, marginTop: 38, marginBottom: 26 },
  title: { fontSize: 27, lineHeight: 34 },
  nameField: { marginBottom: 20 },
  nameHelp: { marginTop: 8 },
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
