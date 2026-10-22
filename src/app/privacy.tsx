import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius } from '@/constants/theme';
import { LEGAL, legalDetailsComplete, legalValue } from '@/constants/legal';
import { useTheme } from '@/hooks/use-theme';

// The public privacy policy. It sits outside every route group so it opens
// without an account: Google Play links to it from the store listing, and its
// reviewers open it signed out.
//
// Keep it in step with the code. Every provider named here is one an Edge
// Function or screen actually calls; add one here before shipping a feature
// that sends data somewhere new.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: 8 }}>
    <ThemedText type="sectionTitle">{title}</ThemedText>
    {children}
  </View>;
}

function Body({ children }: { children: ReactNode }) {
  return <ThemedText type="small" style={{ lineHeight: 22 }}>{children}</ThemedText>;
}

export default function PrivacyPolicyScreen() {
  const theme = useTheme();
  return <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', padding: 24, gap: 22 }}>
    <ThemedText type="pageTitle">Synq AI privacy policy</ThemedText>
    <ThemedText type="caption" themeColor="textSecondary">Effective {legalValue(LEGAL.effectiveDate)}</ThemedText>

    {!legalDetailsComplete ? <View style={{ borderWidth: 1, borderColor: AccentColors.warning, borderRadius: Radius.card, padding: 14 }}>
      <ThemedText type="smallBold" style={{ color: AccentColors.warning }}>Draft: the operator details below have not been filled in yet.</ThemedText>
    </View> : null}

    <Section title="Who we are">
      <Body>Synq AI (&quot;Synq&quot;, &quot;we&quot;) is operated by {legalValue(LEGAL.operatorName)}. For anything about your data, email {legalValue(LEGAL.contactEmail)}.</Body>
    </Section>

    <Section title="What we collect">
      <Body>• Account details: your email address, your name, and a sign-in method (a password, or your Google account). Passwords are handled by our authentication provider and we never see them.</Body>
      <Body>• Setup answers: what you tell us about your business during onboarding, so the AI can tailor its suggestions.</Body>
      <Body>• Work you put into Synq: CRM contacts and notes you add or import, deals and targets, team chat messages, assigned tasks and meetings, and email duties you create.</Body>
      <Body>• AI chats: the messages you send to Synq&apos;s AI employees, any files you attach, and the replies.</Body>
      <Body>• Images and videos you generate, and files you upload for marketing posts.</Body>
      <Body>• Connected accounts: if you connect Gmail, YouTube, Instagram, X or LinkedIn, we store the access that account grants us, encrypted, so Synq can act when you ask it to.</Body>
      <Body>• Usage records: when you use a feature, how many daily AI credits you have used, and errors, so we can run limits and fix problems.</Body>
      <Body>We do not collect payment details, your location, your contacts list from your phone, or advertising identifiers, and Synq contains no advertising or tracking software.</Body>
    </Section>

    <Section title="How we use it">
      <Body>Only to run the features you use: to sign you in, show your workspace, answer your AI requests, generate media, and carry out actions you approve, such as sending an email duty or publishing a post. We also use it to keep the service secure and enforce usage limits. We do not sell your data, and we do not use it for advertising.</Body>
    </Section>

    <Section title="Who we share it with">
      <Body>• Supabase stores your account, workspace data and files, and runs our servers.</Body>
      <Body>• Google processes your AI chats and attachments (Gemini) and video requests (Veo). If you use business search, your search goes to Google Places.</Body>
      <Body>• Pollinations processes the text prompts for images you ask Synq to create.</Body>
      <Body>• Gmail sends the email duties you approve, from your own address. Synq then reads only the replies in those email threads, to show you who answered.</Body>
      <Body>• YouTube, Instagram, X and LinkedIn receive content only when you connect them and approve a post.</Body>
      <Body>• People in your company workspace can see the workspace&apos;s shared records, such as CRM contacts, team chat and meetings, according to their role.</Body>
      <Body>Each provider handles the data under its own terms. We share data with authorities only when the law requires it.</Body>
    </Section>

    <Section title="How long we keep it">
      <Body>We keep your data while your account exists. When you delete your account, we delete it straight away: your profile, chats, CRM contacts, files, generated media and connected-account access. If you own a company workspace and you are its only active member, the workspace and its shared records are deleted too.</Body>
    </Section>

    <Section title="Deleting your account">
      <Body>In the app, open Settings and choose Delete account. You can also delete it from the web without reinstalling the app:</Body>
      <Link href="/delete-account" asChild><Pressable accessibilityRole="link"><ThemedText type="linkPrimary">Delete your Synq account</ThemedText></Pressable></Link>
      <Body>Deleting Synq does not remove the access you granted at Google, Instagram, X or LinkedIn. You can revoke it in each account&apos;s security settings.</Body>
    </Section>

    <Section title="Security">
      <Body>Data travels over encrypted connections. Each account can read only its own records, or its workspace&apos;s shared records, and connected-account access is stored encrypted on our servers. No system is perfectly secure, and we will tell you if a breach affects your data.</Body>
    </Section>

    <Section title="Children">
      <Body>Synq is a business tool and is not meant for anyone under {legalValue(LEGAL.minimumAge)}. If you think a child has given us data, email us and we will delete it.</Body>
    </Section>

    <Section title="Changes">
      <Body>If we change this policy, we will publish the new version on this page and update the date at the top.</Body>
    </Section>
  </ScrollView>;
}
