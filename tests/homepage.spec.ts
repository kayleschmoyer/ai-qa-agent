import { expect, test, type Locator, type Page } from '@playwright/test';

const featureCards = [
  {
    title: 'Live Stats',
    description: 'Real-time player statistics, projections, and performance trends updated as the game unfolds.',
  },
  {
    title: 'Draft Tools',
    description: 'Snake and auction drafts with smart rankings, position analysis, and mock draft simulations.',
  },
  {
    title: 'Instant Updates',
    description: 'WebSocket-powered live scoring and lineup lock notifications so you never miss a move.',
  },
  {
    title: 'Secure Leagues',
    description: 'Private invite codes, commissioner controls, and fair waiver rules for your perfect league.',
  },
];

const primaryActions = [
  {
    label: 'Sign In',
    accessibleName: /sign in/i,
    locator: (page: Page) => page.getByRole('button', { name: /sign in/i }),
  },
  {
    label: 'Continue with Google',
    accessibleName: /get started with google/i,
    locator: (page: Page) => page.locator('button').filter({ hasText: 'Continue with Google' }).first(),
  },
  {
    label: 'Get Started Free',
    accessibleName: /^get started$/i,
    locator: (page: Page) => page.locator('button').filter({ hasText: 'Get Started Free' }).first(),
  },
];

async function gotoHomepage(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

async function expectGoogleAuthPopup(page: Page, button: Locator) {
  const popupPromise = page.waitForEvent('popup');
  await button.click();

  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain('accounts.google.com');
  await popup.close();

  await expect(page).toHaveURL(/legacy-fantasy\.com\/?$/);
}

test.describe('Legacy Sports homepage', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHomepage(page);
  });

  test('renders core hero copy and metadata', async ({ page }) => {
    await expect(page).toHaveTitle('Fantasy Baseball League Manager | Legacy Sports');

    const description = await page.locator('meta[name="description"]').first().getAttribute('content');
    expect(description).toContain('fantasy baseball league manager built for serious fans');

    await expect(page.getByText('Legacy Sports', { exact: true })).toBeVisible();
    await expect(page.getByText('Fantasy Baseball · Season 2026', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Build Your Dynasty\.\s*Dominate Your League\./i })).toBeVisible();
    await expect(page.getByText(/powered by real MLB history/i)).toBeVisible();
    await expect(page.getByText(/Free to play/i)).toBeVisible();
  });

  test('shows all primary CTA buttons with accessible names', async ({ page }) => {
    for (const action of primaryActions) {
      const button = action.locator(page);

      await expect(button, `${action.label} should be visible`).toBeVisible();
      await expect(button, `${action.label} should expose an accessible name`).toHaveAccessibleName(action.accessibleName);
    }
  });

  test('lists the main feature cards', async ({ page }) => {
    await expect(page.getByText('Everything you need to win', { exact: true })).toBeVisible();
    await expect(page.getByText('Powerful tools that give you an edge every single week.', { exact: true })).toBeVisible();

    for (const feature of featureCards) {
      await expect(page.getByText(feature.title, { exact: true }).last()).toBeVisible();
      await expect(page.locator('body').getByText(feature.description, { exact: true })).toBeVisible();
    }
  });

  test('shows current and upcoming sports states', async ({ page }) => {
    await expect(page.getByText('Pick your sport', { exact: true })).toBeVisible();
    await expect(page.getByText('Baseball is live now. Football is coming soon.', { exact: true })).toBeVisible();
    await expect(page.getByText('Baseball', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Live Now', { exact: true })).toBeVisible();
    await expect(page.getByText('Football', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Coming Soon', { exact: true })).toBeVisible();
  });

  test('keeps the conversion section visible near the footer', async ({ page }) => {
    await expect(page.getByText('Ready to play?', { exact: true })).toBeVisible();
    await expect(page.getByText('Join your league, draft your team, and start competing today.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Legacy Sports .*All rights reserved/i)).toBeVisible();
  });

  test('sign in opens Google authentication', async ({ page }) => {
    await expectGoogleAuthPopup(page, primaryActions[0].locator(page));
  });

  test('continue with Google opens Google authentication', async ({ page }) => {
    await expectGoogleAuthPopup(page, primaryActions[1].locator(page));
  });

  test('get started keeps the primary CTA available on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHomepage(page);

    const button = primaryActions[2].locator(page);
    await expect(button).toBeVisible();
    await expect(button).toHaveAccessibleName(primaryActions[2].accessibleName);
  });

  test('get started opens Google authentication', async ({ page }) => {
    await expectGoogleAuthPopup(page, primaryActions[2].locator(page));
  });
});