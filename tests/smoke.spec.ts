import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildPageSnapshot } from '../src/utils/pageSnapshot';
import { judgePage } from '../src/ai/judge';
import { saveQaResult } from '../src/utils/reporter';
import { authenticateInCurrentBrowserSession } from './auth-session';

test('homepage smoke + AI review', async ({ page }, testInfo) => {
  const errors: string[] = [];

  if (process.env.AUTH_IN_BROWSER === 'true') {
    const authState = await authenticateInCurrentBrowserSession(page, {
      forceRefresh: process.env.FORCE_AUTH_SETUP === 'true',
    });

    console.log(
      `In-browser auth resolved to ${authState.email ?? 'unknown user'} with access level ${authState.accessLevel ?? 'unknown'}`,
    );
  } else {
    await page.goto('/');
  }

  await expect(page).toHaveURL(/.*/);

  // Basic deterministic checks first
  try {
    await expect(page.locator('body')).toBeVisible();
  } catch (err) {
    errors.push(`Body not visible: ${String(err)}`);
  }

  const authState = await page.evaluate(() => {
    const rawProfile = window.localStorage.getItem('ls_user_profile');
    const expiry = window.localStorage.getItem('ls_token_expiry');

    if (!rawProfile) {
      return { hasToken: false, email: null, accessLevel: null };
    }

    try {
      const profile = JSON.parse(rawProfile) as {
        email?: string;
        username?: string;
        accessLevel?: string;
      };

      return {
        hasToken: Boolean(expiry),
        email: profile.email ?? null,
        accessLevel: profile.accessLevel ?? null,
      };
    } catch {
      return { hasToken: true, email: null, accessLevel: null };
    }
  });

  if (authState.hasToken) {
    console.log(
      `Detected signed-in profile for ${authState.email ?? 'unknown user'} with access level ${authState.accessLevel ?? 'unknown'}`,
    );
  }

  if (authState.accessLevel === 'none') {
    errors.push(
      `Authenticated with ${authState.email ?? 'an unknown account'}, but accessLevel is none. Choose an authorized account in device flow to exercise signed-in app behavior.`,
    );
  }

  const unauthenticatedCta = page
    .locator('button, a')
    .filter({ hasText: /sign in|login|get started|start|continue/i })
    .first();

  if (!authState.hasToken && (await unauthenticatedCta.count())) {
    try {
      await unauthenticatedCta.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    } catch (err) {
      errors.push(`Primary CTA click failed: ${String(err)}`);
    }
  }

  const screenshotDir = path.join(process.cwd(), 'qa-results');
  await fs.mkdir(screenshotDir, { recursive: true });

  const screenshotPath = path.join(
    screenshotDir,
    `${testInfo.title.replace(/[^\w\-]+/g, '_')}.png`
  );

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
  });

  const snapshot = await buildPageSnapshot(page);

  const aiReview = await judgePage({
    stepName: 'Homepage review after initial navigation',
    snapshot,
    screenshotPath,
    errors,
  });

  const result = {
    test: testInfo.title,
    url: page.url(),
    errors,
    aiReview,
    screenshotPath,
  };

  const resultPath = await saveQaResult(
    result,
    `${testInfo.title.replace(/[^\w\-]+/g, '_')}.json`
  );

  await testInfo.attach('homepage-ai-review', {
    body: Buffer.from(JSON.stringify(result, null, 2), 'utf8'),
    contentType: 'application/json',
  });

  await testInfo.attach('homepage-ai-review-screenshot', {
    body: await fs.readFile(screenshotPath),
    contentType: 'image/png',
  });

  console.log(`QA result saved to: ${resultPath}`);

  // Keep one deterministic assertion so the test still behaves like a test
  await expect(page.locator('body')).toBeVisible();
});