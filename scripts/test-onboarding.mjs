import test from 'node:test';
import assert from 'node:assert/strict';
import { ONBOARDING_QUESTIONS, canContinueOnboarding, hasSevenQuestionAnswers } from '../src/lib/onboarding-questions.ts';

const empty = { q1: null, q2: null, q3: null, q4: null, q5: null, q6: null, q7: null, otherAnswers: {}, businessName: '' };

test('onboarding has exactly seven questions and four choices ending in Other', () => {
  assert.equal(ONBOARDING_QUESTIONS.length, 7);
  for (const question of ONBOARDING_QUESTIONS) {
    assert.equal(question.options.length, 4, question.title);
    assert.equal(question.options[3].label, 'Other', question.title);
  }
});

test('Other requires a non-empty custom answer and business name remains separate', () => {
  const q1 = ONBOARDING_QUESTIONS[0];
  assert.equal(canContinueOnboarding({ ...empty, q1: 'other' }, q1), false);
  assert.equal(canContinueOnboarding({ ...empty, q1: 'other', otherAnswers: { q1: '  ' } }, q1), false);
  assert.equal(canContinueOnboarding({ ...empty, q1: 'other', otherAnswers: { q1: 'Consultant' } }, q1), true);
  const q2 = ONBOARDING_QUESTIONS[1];
  assert.equal(canContinueOnboarding({ ...empty, q2: 'technology_saas' }, q2), false);
  assert.equal(canContinueOnboarding({ ...empty, q2: 'other', businessName: 'Acme', otherAnswers: { q2: 'Climate software' } }, q2), true);
});

test('the empty answers_v2 default does not hide answers from the old questionnaire', () => {
  assert.equal(hasSevenQuestionAnswers({}), false);
  assert.equal(hasSevenQuestionAnswers({ otherAnswers: {}, businessName: '' }), false);
  assert.equal(hasSevenQuestionAnswers(null), false);
  assert.equal(hasSevenQuestionAnswers([]), false);
  assert.equal(hasSevenQuestionAnswers({ q1: 'small_business' }), true);
});
