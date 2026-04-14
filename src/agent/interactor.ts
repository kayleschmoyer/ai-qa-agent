import type { Page } from '@playwright/test';

export interface InteractionResult {
  action: string;
  target: string;
  before: { url: string; title: string; bodyExcerpt: string };
  after: { url: string; title: string; bodyExcerpt: string };
  error: string | null;
  networkErrors: { url: string; status: number }[];
  consoleErrors: string[];
  screenshotPath: string;
  durationMs: number;
}

interface InteractionTarget {
  type: 'button' | 'link' | 'form' | 'menu' | 'input';
  selector: string;
  label: string;
}

/**
 * Discover all interactive elements on the current page.
 */
export async function discoverInteractiveElements(page: Page): Promise<InteractionTarget[]> {
  const targets: InteractionTarget[] = [];

  // Buttons (including role="button")
  const buttons = await page.locator('button:visible, [role="button"]:visible').evaluateAll(els =>
    els.map((el, i) => ({
      text: (el.textContent || '').trim().slice(0, 80),
      tag: el.tagName.toLowerCase(),
      disabled: (el as HTMLButtonElement).disabled,
      index: i,
    }))
  ).catch(() => []);

  for (const btn of buttons) {
    if (!btn.disabled && btn.text && !isSkipTarget(btn.text)) {
      targets.push({
        type: 'button',
        selector: `(button:visible, [role="button"]:visible) >> nth=${btn.index}`,
        label: btn.text,
      });
    }
  }

  // Links that go to in-app routes
  const links = await page.locator('a[href]:visible').evaluateAll(els =>
    els.map((el, i) => ({
      text: (el.textContent || '').trim().slice(0, 80),
      href: (el as HTMLAnchorElement).getAttribute('href') || '',
      index: i,
    }))
  ).catch(() => []);

  for (const link of links) {
    if (link.text && !isSkipTarget(link.text) && isInternalHref(link.href)) {
      targets.push({
        type: 'link',
        selector: `a[href]:visible >> nth=${link.index}`,
        label: `${link.text} -> ${link.href}`,
      });
    }
  }

  // Forms
  const forms = await page.locator('form:visible').evaluateAll(els =>
    els.map((el, i) => ({
      action: el.getAttribute('action') || '',
      fields: el.querySelectorAll('input, textarea, select').length,
      index: i,
    }))
  ).catch(() => []);

  for (const form of forms) {
    if (form.fields > 0) {
      targets.push({
        type: 'form',
        selector: `form:visible >> nth=${form.index}`,
        label: `Form(${form.fields} fields, action=${form.action || 'none'})`,
      });
    }
  }

  return targets;
}

/**
 * Execute one interaction and capture before/after state.
 */
export async function executeInteraction(
  page: Page,
  target: InteractionTarget,
  screenshotDir: string,
  index: number,
): Promise<InteractionResult> {
  const fs = await import('node:fs/promises');
  const pathMod = await import('node:path');
  const startUrl = page.url();
  const startTitle = await page.title().catch(() => '');
  const startBody = await page.locator('body').innerText().catch(() => '');

  const networkErrors: { url: string; status: number }[] = [];
  const consoleErrors: string[] = [];

  const onResponse = (r: any) => {
    if (r.status() >= 400) {
      networkErrors.push({ url: r.url(), status: r.status() });
    }
  };
  const onConsole = (msg: any) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  };

  page.on('response', onResponse);
  page.on('console', onConsole);

  const start = Date.now();
  let error: string | null = null;

  try {
    switch (target.type) {
      case 'button':
      case 'link':
      case 'menu': {
        const loc = page.locator(target.selector).first();
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 8000 });
        break;
      }
      case 'form':
        await fillAndSubmitForm(page, target.selector);
        break;
      case 'input':
        break;
    }

    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle').catch(() => {});
  } catch (err) {
    error = String(err).slice(0, 500);
  }

  const durationMs = Date.now() - start;
  const afterUrl = page.url();
  const afterTitle = await page.title().catch(() => '');
  const afterBody = await page.locator('body').innerText().catch(() => '');

  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPath = pathMod.join(screenshotDir, `interaction_${index}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  page.off('response', onResponse);
  page.off('console', onConsole);

  return {
    action: target.type,
    target: target.label,
    before: { url: startUrl, title: startTitle, bodyExcerpt: startBody.replace(/\s+/g, ' ').trim().slice(0, 2000) },
    after: { url: afterUrl, title: afterTitle, bodyExcerpt: afterBody.replace(/\s+/g, ' ').trim().slice(0, 2000) },
    error,
    networkErrors,
    consoleErrors,
    screenshotPath,
    durationMs,
  };
}

/**
 * Fill a form with plausible test data and submit it.
 */
async function fillAndSubmitForm(page: Page, formSelector: string): Promise<void> {
  const form = page.locator(formSelector).first();
  const fields = form.locator('input:visible, textarea:visible, select:visible');
  const count = await fields.count();

  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    const tagName = await field.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
    const type = await field.getAttribute('type') || '';
    const name = await field.getAttribute('name') || '';
    const disabled = await field.isDisabled().catch(() => false);

    if (disabled) continue;

    if (tagName === 'select') {
      const options = await field.locator('option').allTextContents().catch(() => []);
      if (options.length > 1) {
        await field.selectOption({ index: 1 }).catch(() => {});
      }
    } else if (tagName === 'textarea') {
      await field.fill('QA test automated entry ' + Date.now()).catch(() => {});
    } else if (type === 'checkbox' || type === 'radio') {
      await field.check().catch(() => {});
    } else if (type === 'email') {
      await field.fill('qa-test@legacysports.test').catch(() => {});
    } else if (type === 'number') {
      await field.fill('8').catch(() => {});
    } else if (type === 'url') {
      await field.fill('https://example.com/test').catch(() => {});
    } else if (type === 'tel') {
      await field.fill('555-0123').catch(() => {});
    } else if (type === 'password') {
      await field.fill('QaT3st!Secure').catch(() => {});
    } else if (type === 'date') {
      await field.fill('2026-01-15').catch(() => {});
    } else if (type !== 'hidden' && type !== 'file' && type !== 'submit' && type !== 'button') {
      const placeholder = await field.getAttribute('placeholder') || '';
      const label = name || placeholder || 'test';
      await field.fill(`QA ${label} ${Date.now().toString().slice(-4)}`).catch(() => {});
    }
  }

  // Find and click submit
  const submitButton = form.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Create"), button:has-text("Save"), button:has-text("Join"), button:has-text("Send")').first();

  if (await submitButton.isVisible().catch(() => false)) {
    await submitButton.click({ timeout: 5000 }).catch(() => {});
  }

  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle').catch(() => {});
}

function isSkipTarget(text: string): boolean {
  const skip = /^(skip to|sign out|sign in|log out|delete account|remove|cancel subscription)/i;
  return skip.test(text);
}

function isInternalHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  if (href.startsWith('#')) return false;
  try {
    const u = new URL(href, 'https://legacy-fantasy.com');
    return u.hostname === 'legacy-fantasy.com';
  } catch {
    return false;
  }
}
