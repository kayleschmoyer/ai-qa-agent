require('dotenv/config');

const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const STORAGE_STATE_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
const OUTPUT_PATH = path.join(process.cwd(), 'qa-results', 'authenticated_dashboard_exploration.json');

const actions = [
  {
    name: 'retry-button',
    description: 'Retry leagues load',
    run: async (page) => {
      await page.getByRole('button', { name: /^retry$/i }).click();
    },
  },
  {
    name: 'sports-nav',
    description: 'Open Sports menu',
    run: async (page) => {
      await page.getByRole('button', { name: /^sports$/i }).click();
    },
  },
  {
    name: 'players-nav',
    description: 'Open Players menu',
    run: async (page) => {
      await page.getByRole('button', { name: /^players$/i }).click();
    },
  },
  {
    name: 'my-leagues-nav',
    description: 'Open My Leagues menu',
    run: async (page) => {
      await page.getByRole('button', { name: /^my leagues$/i }).click();
    },
  },
  {
    name: 'games-link',
    description: 'Open Games route',
    run: async (page) => {
      await page.getByRole('link', { name: /^games$/i }).click();
    },
  },
  {
    name: 'help-nav',
    description: 'Open Help menu',
    run: async (page) => {
      await page.getByRole('button', { name: /^help$/i }).click();
    },
  },
  {
    name: 'report-bug',
    description: 'Open Report a bug dialog',
    run: async (page) => {
      await page.getByRole('button', { name: /report a bug/i }).click();
    },
  },
  {
    name: 'notifications',
    description: 'Open notifications panel',
    run: async (page) => {
      await page.getByRole('button', { name: /notifications/i }).click();
    },
  },
  {
    name: 'profile-menu',
    description: 'Open user profile menu',
    run: async (page) => {
      await page.getByRole('button', { name: /user profile menu/i }).click();
    },
  },
  {
    name: 'scoreboard-link',
    description: 'Open first scoreboard link',
    run: async (page) => {
      await page.locator('a[href="/scoreboard"]').first().click();
    },
  },
];

async function capturePageState(page) {
  const headings = await page.locator('h1, h2, h3').allTextContents().catch(() => []);
  const visibleDialogs = await page.locator('[role="dialog"], [data-state="open"]').evaluateAll(nodes =>
    nodes
      .map(node => (node.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 5)
  ).catch(() => []);
  const bodyText = await page.locator('body').innerText().catch(() => '');

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    headings,
    visibleDialogs,
    excerpt: bodyText.slice(0, 1200),
  };
}

async function runAction(browser, action) {
  const context = await browser.newContext({
    baseURL: process.env.BASE_URL,
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const badResponses = [];

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      badResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const before = await capturePageState(page);

  let actionError = null;
  try {
    await action.run(page);
    await page.waitForTimeout(1500);
    await page.waitForLoadState('networkidle').catch(() => {});
  } catch (error) {
    actionError = String(error);
  }

  const after = await capturePageState(page);

  const screenshotPath = path.join(process.cwd(), 'qa-results', `authenticated_${action.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await context.close();

  return {
    name: action.name,
    description: action.description,
    before,
    after,
    actionError,
    consoleErrors: consoleMessages,
    badResponses,
    screenshotPath,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    const results = [];
    for (const action of actions) {
      results.push(await runAction(browser, action));
    }

    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf8');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});