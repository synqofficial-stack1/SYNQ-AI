import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AIUsageNotice } from '@/components/ai-usage-notice';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type FeatureState = 'yes' | 'no' | 'limited';
type Feature = { label: string; state: FeatureState };

type Plan = {
  id: string;
  name: string;
  tagline: string;
  price: string;
  cadence: string;
  departments: string;
  departmentNote: string;
  features: Feature[];
  cta: string;
  popular?: boolean;
  current?: boolean;
};

// The free tier's "2 departments" is the real limit enforced in app-shell.tsx —
// keep the two in step if either changes.
const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Get started with Synq',
    price: '₹0',
    cadence: '50 credits every 24 hours',
    departments: '2 departments',
    departmentNote: 'Explore two AI departments',
    features: [
      { label: 'Chat prompt: 1 credit', state: 'yes' },
      { label: 'Image or poster: 2 credits', state: 'yes' },
      { label: 'Basic integrations', state: 'yes' },
      { label: 'Company brain (basic)', state: 'yes' },
      { label: 'Standard workflows', state: 'yes' },
      { label: 'Cross-department workflows', state: 'no' },
      { label: 'Advanced analytics', state: 'no' },
      { label: 'Custom workflows', state: 'no' },
      { label: 'Custom integrations', state: 'no' },
      { label: 'Priority support', state: 'no' },
    ],
    cta: 'Current plan',
    current: true,
  },
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Build your AI foundation',
    price: '₹2,499',
    cadence: 'per month',
    departments: '4 departments',
    departmentNote: 'Run up to four departments',
    features: [
      { label: 'Basic integrations', state: 'yes' },
      { label: 'Company brain', state: 'yes' },
      { label: 'Standard workflows', state: 'yes' },
      { label: 'Cross-department workflows', state: 'limited' },
      { label: 'Advanced analytics', state: 'no' },
      { label: 'Custom workflows', state: 'no' },
      { label: 'Custom integrations', state: 'no' },
      { label: 'Priority support', state: 'no' },
    ],
    cta: 'View upgrade availability',
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'Run your business with AI',
    price: '₹9,999',
    cadence: 'per month',
    departments: '6 departments',
    departmentNote: 'Run up to six departments',
    features: [
      { label: 'Basic integrations', state: 'yes' },
      { label: 'Company brain', state: 'yes' },
      { label: 'Standard workflows', state: 'yes' },
      { label: 'Cross-department workflows', state: 'yes' },
      { label: 'Advanced analytics', state: 'yes' },
      { label: 'Custom workflows', state: 'yes' },
      { label: 'Custom integrations', state: 'no' },
      { label: 'Priority support', state: 'yes' },
    ],
    cta: 'View upgrade availability',
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Scale without limits',
    price: 'Custom',
    cadence: 'Contact sales',
    departments: 'Unlimited departments',
    departmentNote: 'As many as you need',
    features: [
      { label: 'All integrations', state: 'yes' },
      { label: 'Company brain', state: 'yes' },
      { label: 'Standard workflows', state: 'yes' },
      { label: 'Cross-department workflows', state: 'yes' },
      { label: 'Advanced analytics', state: 'yes' },
      { label: 'Custom workflows', state: 'yes' },
      { label: 'Custom integrations', state: 'yes' },
      { label: 'Dedicated support', state: 'yes' },
    ],
    cta: 'Talk to sales',
  },
];

function FeatureRow({ feature }: { feature: Feature }) {
  const theme = useTheme();
  const mark = feature.state === 'yes' ? '✓' : feature.state === 'limited' ? '–' : '✗';
  const markColor =
    feature.state === 'yes'
      ? AccentColors.success
      : feature.state === 'limited'
        ? AccentColors.warning
        : theme.borderStrong;

  return (
    <View style={styles.featureRow}>
      <ThemedText type="caption" style={[styles.mark, { color: markColor }]}>
        {mark}
      </ThemedText>
      {/* The word carries the meaning as well as the colour, so this still reads
          without seeing the difference between green and grey. */}
      <ThemedText
        type="caption"
        themeColor={feature.state === 'no' ? 'textSecondary' : 'text'}
        style={styles.featureLabel}
      >
        {feature.label}
        {feature.state === 'limited' ? ' (limited)' : ''}
      </ThemedText>
    </View>
  );
}

export default function UpgradeScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [notice, setNotice] = useState<string | null>(null);

  // Four across on a laptop, two on a tablet, stacked on a phone.
  const columns = width >= 1180 ? 4 : width >= 760 ? 2 : 1;
  const cardBasis = `${100 / columns}%` as const;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Plans</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Your free allowance includes 50 credits shared across departments every 24 hours.
          Chat prompts use 1 credit; images and posters use 2. Explore planned upgrades for more
          credits and added benefits. Paid upgrades are not available yet.
        </ThemedText>
      </View>

      <AIUsageNotice showUpgrade={false} />
      <View style={styles.grid}>
        {PLANS.map((plan) => (
          <View key={plan.id} style={[styles.cardSlot, { flexBasis: cardBasis }]}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.surface,
                  borderColor: plan.popular ? AccentColors.primary : theme.border,
                  borderWidth: plan.popular ? 2 : 1,
                },
              ]}
            >
              {plan.popular ? (
                <View style={[styles.popularPill, { backgroundColor: AccentColors.primary }]}>
                  <ThemedText type="caption" style={styles.popularText}>
                    MOST POPULAR
                  </ThemedText>
                </View>
              ) : null}

              <ThemedText type="sectionTitle">{plan.name}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {plan.tagline}
              </ThemedText>

              <View style={styles.priceBlock}>
                <ThemedText type="metric">{plan.price}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {plan.cadence}
                </ThemedText>
              </View>

              <View style={[styles.departments, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">{plan.departments}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {plan.departmentNote}
                </ThemedText>
              </View>

              <View style={styles.features}>
                {plan.features.map((feature) => (
                  <FeatureRow key={feature.label} feature={feature} />
                ))}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: plan.current }}
                disabled={plan.current}
                onPress={() =>
                  setNotice(
                    plan.id === 'enterprise'
                      ? 'Enterprise upgrades are not available yet. Your current credit allowance will continue to reset every 24 hours.'
                      : `${plan.name} upgrades are not available yet. Your current credit allowance will continue to reset every 24 hours.`
                  )
                }
                style={({ hovered }) => [
                  styles.cta,
                  plan.current
                    ? { borderColor: theme.border, backgroundColor: 'transparent', opacity: 0.6 }
                    : plan.popular
                      ? { borderColor: AccentColors.primary, backgroundColor: AccentColors.primary }
                      : {
                          borderColor: theme.borderStrong,
                          backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
                        },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={{
                    color: plan.popular && !plan.current ? '#0d0d0d' : theme.text,
                    fontWeight: 600,
                  }}
                >
                  {plan.cta}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {notice ? (
        <View
          style={[styles.notice, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <ThemedText type="small">{notice}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => setNotice(null)}>
            <ThemedText type="caption" themeColor="accentText">
              Dismiss
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.notice, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          These prices are the intended plan, not a live product. Synq has no payment provider
          connected, so no plan can be bought and no card can be charged today. Everything you can
          reach right now is on the free tier.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    padding: Spacing.five,
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
  },
  header: { gap: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -Spacing.two },
  cardSlot: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.three },
  card: {
    flex: 1,
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.card,
  },
  popularPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    marginBottom: Spacing.one,
  },
  popularText: { color: '#0d0d0d', fontWeight: 700, letterSpacing: 0.6, fontSize: 10 },
  priceBlock: { gap: 2, paddingVertical: Spacing.two },
  departments: { gap: 2, paddingVertical: Spacing.three, borderTopWidth: 1, borderBottomWidth: 1 },
  features: { gap: Spacing.one + 2, paddingVertical: Spacing.two },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  mark: { width: 12, fontWeight: 700 },
  featureLabel: { flex: 1 },
  cta: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1,
    marginTop: 'auto',
  },
  notice: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
});
