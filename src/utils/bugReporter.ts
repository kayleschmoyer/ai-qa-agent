import type { Locator, Page } from '@playwright/test';

export type BugReportAttempt = {
  enabled: boolean;
  issuesFound: boolean;
  attempted: boolean;
  submitted: boolean;
  triggerFound: boolean;
  inputFound: boolean;
  submitFound: boolean;
  reason: string;
};

type BugReportInput = {
  page: Page;
  summary: string;
};

const configuredTriggerSelector = process.env.BUG_REPORT_TRIGGER_SELECTOR ||
  'span[role="button"][aria-label="Report a bug"][aria-haspopup="dialog"], [aria-label="Report a bug"]';

const configuredTextareaSelector = process.env.BUG_REPORT_TEXTAREA_SELECTOR ||
  '[id^="Dialog--"][id$="-content"] textarea, #Dialog--_r_21_-content textarea';

const configuredSubmitSelector = process.env.BUG_REPORT_SUBMIT_SELECTOR ||
  '[id^="Dialog--"][id$="-content"] button:has-text("Submit Report"), #Dialog--_r_21_-content button:has-text("Submit Report")';

const configuredDialogSelector = process.env.BUG_REPORT_DIALOG_SELECTOR ||
  '[id^="Dialog--"][id$="-content"], #Dialog--_r_21_-content';

function isEnabled() {
  return /^true$/i.test(process.env.REPORT_BUGS_ON_FAILURE || '');
}

function candidateLocators(page: Page): Locator[] {
  return [
    page.locator(configuredTriggerSelector),
    page.getByRole('button', { name: /bug|report bug|report issue|feedback|send feedback/i }),
    page.getByRole('link', { name: /bug|report bug|report issue|feedback|send feedback/i }),
    page.locator('[aria-label*="bug" i], [aria-label*="feedback" i], [aria-label*="report" i]'),
    page.locator('[title*="bug" i], [title*="feedback" i], [title*="report" i]'),
    page.locator('[data-testid*="bug" i], [data-testid*="feedback" i], [data-testid*="report" i]'),
    page.locator('[id*="bug" i], [id*="feedback" i], [id*="report" i]'),
    page.locator('[class*="bug" i], [class*="feedback" i], [class*="report" i]'),
  ];
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);

    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return null;
}

async function findTrigger(page: Page) {
  for (const locator of candidateLocators(page)) {
    const visible = await firstVisible(locator);

    if (visible) {
      const actionableAncestor = visible.locator('xpath=ancestor-or-self::*[self::button or self::a or @role="button"][1]');

      if (await actionableAncestor.count().catch(() => 0)) {
        const actionableVisible = await firstVisible(actionableAncestor);

        if (actionableVisible) {
          return actionableVisible;
        }
      }

      return visible;
    }
  }

  return null;
}

async function findInput(page: Page) {
  const candidates = [
    page.locator(configuredTextareaSelector),
    page.locator(configuredDialogSelector).locator('textarea'),
    page.locator('textarea'),
    page.getByRole('textbox'),
    page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])'),
    page.locator('[contenteditable="true"]'),
  ];

  for (const locator of candidates) {
    const visible = await firstVisible(locator);

    if (visible) {
      return visible;
    }
  }

  return null;
}

async function findSubmit(page: Page) {
  const candidates = [
    page.locator(configuredSubmitSelector),
    page.locator(configuredDialogSelector).getByRole('button', { name: /submit report/i }),
    page.getByRole('button', { name: /send report|submit|send|report/i }),
    page.locator('button, [role="button"]').filter({ hasText: /send report|submit|send|report/i }),
    page.locator('input[type="submit"], button[type="submit"]'),
  ];

  for (const locator of candidates) {
    const visible = await firstVisible(locator);

    if (visible) {
      return visible;
    }
  }

  return null;
}

export async function reportDetectedIssuesIfPossible(input: BugReportInput): Promise<BugReportAttempt> {
  if (!input.summary.trim()) {
    return {
      enabled: isEnabled(),
      issuesFound: false,
      attempted: false,
      submitted: false,
      triggerFound: false,
      inputFound: false,
      submitFound: false,
      reason: 'No issues detected',
    };
  }

  if (!isEnabled()) {
    return {
      enabled: false,
      issuesFound: true,
      attempted: false,
      submitted: false,
      triggerFound: false,
      inputFound: false,
      submitFound: false,
      reason: 'Bug auto-reporting disabled. Set REPORT_BUGS_ON_FAILURE=true to enable it.',
    };
  }

  const trigger = await findTrigger(input.page);

  if (!trigger) {
    return {
      enabled: true,
      issuesFound: true,
      attempted: true,
      submitted: false,
      triggerFound: false,
      inputFound: false,
      submitFound: false,
      reason: 'Bug report trigger not found on the page.',
    };
  }

  await trigger.click({ force: true });
  await input.page.waitForTimeout(500);

  const formInput = await findInput(input.page);

  if (!formInput) {
    return {
      enabled: true,
      issuesFound: true,
      attempted: true,
      submitted: false,
      triggerFound: true,
      inputFound: false,
      submitFound: false,
      reason: 'Bug report form input was not found after opening the report UI.',
    };
  }

  await formInput.fill(input.summary);
  await input.page.waitForTimeout(150);

  const submit = await findSubmit(input.page);

  if (!submit) {
    return {
      enabled: true,
      issuesFound: true,
      attempted: true,
      submitted: false,
      triggerFound: true,
      inputFound: true,
      submitFound: false,
      reason: 'Bug report submit button was not found after entering the report.',
    };
  }

  await submit.click();

  return {
    enabled: true,
    issuesFound: true,
    attempted: true,
    submitted: true,
    triggerFound: true,
    inputFound: true,
    submitFound: true,
    reason: 'Bug report submitted successfully.',
  };
}