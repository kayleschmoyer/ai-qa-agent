import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';

const SESSION_FILE = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

setup('authenticate via Google', async ({ page }) => {
  if (fs.existsSync(SESSION_FILE) && process.env.FORCE_AUTH_SETUP !== 'true') {
    return;
  }

  const email = process.env.GOOGLE_EMAIL;
  const password = process.env.GOOGLE_PASSWORD;

  if (!email || !password) {
    throw new Error('GOOGLE_EMAIL and GOOGLE_PASSWORD must be set in .env to run authenticated tests.');
  }

  await fsp.mkdir(path.dirname(SESSION_FILE), { recursive: true });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Click Sign In — this opens a Google OAuth popup
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('button', { name: /sign in/i }).first().click(),
  ]);

  await popup.waitForLoadState('domcontentloaded');

  // --- Google email step ---
  await popup.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15_000 });
  await popup.locator('input[type="email"]').fill(email);
  await popup.locator('#identifierNext').click();

  // --- Google password step ---
  try {
    await popup.locator('input[name="Passwd"]').waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const googleBlockedMessage = popup.isClosed()
      ? true
      : await popup.getByText(/couldn't sign you in|this browser or app may not be secure/i).isVisible().catch(() => false);

    if (googleBlockedMessage) {
      throw new Error(
        'Google blocked the automated OAuth flow after the email step. Save a session from a manually signed-in Chrome instance with `npm run auth:save-session`, then rerun the tests. Delete playwright/.auth/session.json or set FORCE_AUTH_SETUP=true if you need to regenerate it.'
      );
    }

    throw error;
  }

  await popup.locator('input[name="Passwd"]').fill(password);
  await popup.locator('#passwordNext').click();

  // Wait for the popup to redirect back to the app (closes or navigates away from Google)
  await popup
    .waitForURL(url => !url.includes('accounts.google.com'), { timeout: 30_000 })
    .catch(() => {
      // Popup may have already closed; that's fine
    });

  // Give the main page time to receive the auth signal and settle
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  await page.context().storageState({ path: SESSION_FILE });
});
