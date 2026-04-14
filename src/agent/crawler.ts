import type { Page, BrowserContext } from '@playwright/test';

export interface RouteInfo {
  url: string;
  depth: number;
  source: 'navigation' | 'link-discovery' | 'sitemap' | 'manual';
}

export interface CrawlResult {
  route: RouteInfo;
  title: string;
  headings: string[];
  bodyExcerpt: string;
  links: { text: string; href: string }[];
  buttons: { text: string; disabled: boolean; tag: string; role: string | null }[];
  forms: { action: string; method: string; fields: FormField[] }[];
  images: { src: string; alt: string; naturalWidth: number; naturalHeight: number }[];
  badResponses: { url: string; status: number }[];
  consoleErrors: string[];
  accessibilityTree: string;
  screenshotPath: string;
  timestamp: number;
}

interface FormField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  value: string;
  label: string;
}

/**
 * Discovers all in-app routes reachable from the current page.
 */
export async function discoverRoutes(page: Page, baseUrl: string, maxDepth = 2): Promise<RouteInfo[]> {
  const seen = new Set<string>();
  const queue: RouteInfo[] = [{ url: '/', depth: 0, source: 'navigation' }];
  const routes: RouteInfo[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const normalizedPath = normalizePath(current.url);

    if (seen.has(normalizedPath) || current.depth > maxDepth) continue;
    seen.add(normalizedPath);
    routes.push(current);

    if (current.depth >= maxDepth) continue;

    try {
      await page.goto(current.url, { waitUntil: 'load', timeout: 15000 });
      await page.waitForLoadState('networkidle').catch(() => {});

      const links = await page.locator('a[href]').evaluateAll((els, base) => {
        return els
          .map(el => (el as HTMLAnchorElement).href)
          .filter(href => href.startsWith(base) || href.startsWith('/'))
          .map(href => {
            try {
              const u = new URL(href, base);
              return u.pathname + u.search;
            } catch {
              return null;
            }
          })
          .filter((h): h is string => h !== null);
      }, baseUrl);

      for (const link of [...new Set(links)]) {
        const norm = normalizePath(link);
        if (!seen.has(norm) && isInAppRoute(norm)) {
          queue.push({ url: link, depth: current.depth + 1, source: 'link-discovery' });
        }
      }
    } catch {
      // Route failed to load — will still be in the routes list for auditing
    }
  }

  return routes;
}

/**
 * Capture a full snapshot of the current page state for AI analysis.
 */
export async function capturePageState(page: Page, screenshotDir: string, label: string): Promise<Omit<CrawlResult, 'route'>> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const title = await page.title().catch(() => '');
  const headings = await page.locator('h1, h2, h3, h4').allTextContents().catch(() => []);
  const bodyText = await page.locator('body').innerText().catch(() => '');

  const links = await page.locator('a[href]').evaluateAll(els =>
    els.slice(0, 80).map(el => ({
      text: (el.textContent || '').trim().slice(0, 100),
      href: (el as HTMLAnchorElement).getAttribute('href') || '',
    }))
  ).catch(() => []);

  const buttons = await page.locator('button, [role="button"], input[type="submit"], input[type="button"]').evaluateAll(els =>
    els.slice(0, 60).map(el => ({
      text: (el.textContent || (el as HTMLInputElement).value || '').trim().slice(0, 100),
      disabled: (el as HTMLButtonElement).disabled ?? false,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
    }))
  ).catch(() => []);

  const forms = await page.locator('form').evaluateAll(els =>
    els.slice(0, 10).map(form => {
      const fields = Array.from(form.querySelectorAll('input, textarea, select')).slice(0, 20).map(el => {
        const labelEl = el.id ? form.querySelector(`label[for="${el.id}"]`) : null;
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          id: el.id || '',
          placeholder: el.getAttribute('placeholder') || '',
          required: (el as HTMLInputElement).required ?? false,
          disabled: (el as HTMLInputElement).disabled ?? false,
          value: (el as HTMLInputElement).value || '',
          label: labelEl?.textContent?.trim() || el.getAttribute('aria-label') || '',
        };
      });
      return {
        action: form.getAttribute('action') || '',
        method: form.getAttribute('method') || 'GET',
        fields,
      };
    })
  ).catch(() => []);

  const images = await page.locator('img').evaluateAll(els =>
    els.slice(0, 40).map(el => ({
      src: (el as HTMLImageElement).src || '',
      alt: (el as HTMLImageElement).alt || '',
      naturalWidth: (el as HTMLImageElement).naturalWidth,
      naturalHeight: (el as HTMLImageElement).naturalHeight,
    }))
  ).catch(() => []);

  // Get accessibility tree summary
  const accessibilityTree = await page.evaluate(() => {
    const issues: string[] = [];
    // Check interactive elements without accessible names
    document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"]').forEach(el => {
      const name = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent?.trim();
      if (!name || name.length === 0) {
        issues.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} has no accessible name`);
      }
    });
    // Check images without alt text
    document.querySelectorAll('img').forEach(el => {
      if (!(el as HTMLImageElement).alt && !el.getAttribute('role')) {
        issues.push(`img[src="${(el as HTMLImageElement).src.slice(-60)}"] missing alt text`);
      }
    });
    // Check form fields without labels
    document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(el => {
      const id = el.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!hasLabel && !hasAria) {
        issues.push(`${el.tagName.toLowerCase()}[name="${el.getAttribute('name') || ''}"] has no label`);
      }
    });
    // Check heading hierarchy
    const headingLevels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(el => parseInt(el.tagName[1]));
    for (let i = 1; i < headingLevels.length; i++) {
      if (headingLevels[i] > headingLevels[i - 1] + 1) {
        issues.push(`Heading level skips from h${headingLevels[i - 1]} to h${headingLevels[i]}`);
      }
    }
    // Check for landmark regions
    const hasMain = !!document.querySelector('main, [role="main"]');
    const hasNav = !!document.querySelector('nav, [role="navigation"]');
    if (!hasMain) issues.push('Page has no <main> landmark');
    if (!hasNav) issues.push('Page has no <nav> landmark');

    return issues.join('\n');
  }).catch(() => '');

  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, `${sanitizeFilename(label)}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  return {
    title,
    headings,
    bodyExcerpt: bodyText.replace(/\s+/g, ' ').trim().slice(0, 6000),
    links,
    buttons,
    forms,
    images,
    badResponses: [],
    consoleErrors: [],
    accessibilityTree,
    screenshotPath,
    timestamp: Date.now(),
  };
}

function normalizePath(url: string): string {
  try {
    const u = new URL(url, 'https://placeholder.com');
    return u.pathname.replace(/\/$/, '') || '/';
  } catch {
    return url.replace(/\/$/, '') || '/';
  }
}

function isInAppRoute(path: string): boolean {
  const skip = ['/api/', '/oauth/', '/_next/', '/static/', '.js', '.css', '.png', '.jpg', '.svg', '.ico', '.woff'];
  return !skip.some(s => path.includes(s));
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}
