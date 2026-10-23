import type { OnboardingAnswers } from '@/lib/onboarding';

export type OnboardingQuestion = {
  key: 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6' | 'q7';
  title: string;
  options: { id: string; label: string }[];
  important?: boolean;
  otherPlaceholder: string;
};

const options = (...items: string[]) => items.map((item) => {
  const [id, label] = item.split('|');
  return { id, label };
});

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  { key: 'q1', title: 'What best describes you?', important: true, options: options('starting_business|I\'m starting a business', 'small_business|I run a small business', 'existing_company|I work in an existing company', 'other|Other'), otherPlaceholder: 'Tell us what best describes you' },
  { key: 'q2', title: 'What is your business name and industry?', important: true, options: options('technology_saas|Technology / SaaS', 'ecommerce_retail|E-commerce / Retail', 'services_agency|Services / Agency', 'other|Other'), otherPlaceholder: 'Enter your industry' },
  { key: 'q3', title: 'What stage is your business at?', options: options('idea|Just an idea', 'building|Building my product', 'first_customers|Getting my first customers', 'other|Other'), otherPlaceholder: 'Tell us your business stage' },
  { key: 'q4', title: 'Who are your ideal customers?', options: options('b2c|Consumers (B2C)', 'b2b|Businesses (B2B)', 'both|Both', 'other|Other'), otherPlaceholder: 'Describe your ideal customers' },
  { key: 'q5', title: 'What is your biggest goal right now?', important: true, options: options('sales|Find leads and sales', 'brand_content|Grow brand and content', 'automate|Automate business tasks', 'other|Other'), otherPlaceholder: 'Describe your goal' },
  { key: 'q6', title: 'Which tasks take up most of your time?', options: options('sales_followups|Sales and follow-ups', 'marketing_content|Marketing and content', 'team_admin|Team management and administration', 'other|Other'), otherPlaceholder: 'Describe the tasks' },
  { key: 'q7', title: 'How would you like Synq to help you?', important: true, options: options('do_tasks|Do tasks for me, where authorized', 'guide|Guide me step by step', 'recommend|Recommend what to do', 'other|Other'), otherPlaceholder: 'Tell us how Synq can help' },
];

/** `answers_v2` defaults to '{}', so a row finished on the old questionnaire
 * has an empty object. Only a populated object counts as seven-question answers. */
export function hasSevenQuestionAnswers(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ONBOARDING_QUESTIONS.some((question) => typeof row[question.key] === 'string');
}

export function canContinueOnboarding(answers: OnboardingAnswers, question: OnboardingQuestion) {
  const value = answers[question.key];
  if (!value || (value === 'other' && !(answers.otherAnswers[question.key] ?? '').trim())) return false;
  if (question.key === 'q2' && !answers.businessName.trim()) return false;
  return true;
}
