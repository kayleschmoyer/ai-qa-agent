import type { Page } from '@playwright/test';

export async function buildPageSnapshot(page: Page) {
  const url = page.url();
  const title = await page.title();

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const trimmedText = bodyText.replace(/\s+/g, ' ').trim().slice(0, 12000);

  const links = await page.locator('a').evaluateAll((els) =>
    els.slice(0, 40).map((el) => ({
      text: (el.textContent || '').trim(),
      href: (el as HTMLAnchorElement).href || '',
    }))
  );

  const buttons = await page.locator('button, input[type="button"], input[type="submit"]').evaluateAll((els) =>
    els.slice(0, 40).map((el) => ({
      text: (el.textContent || (el as HTMLInputElement).value || '').trim(),
      disabled: (el as HTMLButtonElement).disabled ?? false,
    }))
  );

  const formFields = await page.locator('input, textarea, select').evaluateAll((els) =>
    els.slice(0, 60).map((el) => ({
      tag: el.tagName.toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.getAttribute('id') || '',
      type: el.getAttribute('type') || '',
      placeholder: el.getAttribute('placeholder') || '',
      disabled: (el as HTMLInputElement).disabled ?? false,
    }))
  );

  return {
    url,
    title,
    visibleText: trimmedText,
    links,
    buttons,
    formFields,
  };
}