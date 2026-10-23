import { test, expect } from '@playwright/test';

test('renders Synq sign-in without contacting a real Supabase project', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'commit' });

  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
});
