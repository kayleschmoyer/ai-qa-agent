require('dotenv/config');

const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const STORAGE_STATE_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

const actionName = process.argv[2];

const actions = {
  retry: {
    description: 'Retry leagues load',
    run: page => page.getByRole('button', { name: /^retry$/i }).click(),
  },
  sports: {
    description: 'Open Sports menu',
    run: page => page.getByRole('button', { name: /^sports$/i }).click(),
  },
  players: {
    description: 'Open Players menu',
    run: page => page.getByRole('button', { name: /^players$/i }).click(),
  },
  allPlayers: {
    description: 'Open Players > All Players',
    run: async page => {
      await page.getByRole('button', { name: /^players$/i }).click();
      await page.getByText(/^all players$/i).click();
    },
  },
  playerStats: {
    description: 'Open Players > Player Stats',
    run: async page => {
      await page.getByRole('button', { name: /^players$/i }).click();
      await page.getByText(/^player stats$/i).click();
    },
  },
  comparePlayers: {
    description: 'Open Players > Compare Players',
    run: async page => {
      await page.getByRole('button', { name: /^players$/i }).click();
      await page.getByText(/^compare players$/i).click();
    },
  },
  myLeagues: {
    description: 'Open My Leagues menu',
    run: page => page.getByRole('button', { name: /^my leagues$/i }).click(),
  },
  browseLeagues: {
    description: 'Open My Leagues > Browse Leagues',
    run: async page => {
      await page.getByRole('button', { name: /^my leagues$/i }).click();
      await page.getByText(/^browse leagues$/i).click();
    },
  },
  createLeague: {
    description: 'Open My Leagues > Create a League',
    run: async page => {
      await page.getByRole('button', { name: /^my leagues$/i }).click();
      await page.getByText(/^create a league$/i).click();
    },
  },
  joinLeagueHub: {
    description: 'Open Baseball hub and click Join League',
    run: async page => {
      await page.goto('/baseball', { waitUntil: 'load' });
      await page.getByRole('button', { name: /^join league$/i }).click();
    },
  },
  mockDraftHub: {
    description: 'Open Baseball hub and click Mock Draft',
    run: async page => {
      await page.goto('/baseball', { waitUntil: 'load' });
      await page.getByRole('button', { name: /mock draft/i }).click();
    },
  },
  games: {
    description: 'Open Games route',
    run: page => page.getByRole('link', { name: /^games$/i }).click(),
  },
  help: {
    description: 'Open Help menu',
    run: page => page.getByRole('button', { name: /^help$/i }).click(),
  },
  about: {
    description: 'Open Help > About',
    run: async page => {
      await page.getByRole('button', { name: /^help$/i }).click();
      await page.getByText(/^about$/i).click();
    },
  },
  pricing: {
    description: 'Open Help > Pricing',
    run: async page => {
      await page.getByRole('button', { name: /^help$/i }).click();
      await page.getByText(/^pricing$/i).click();
    },
  },
  faq: {
    description: 'Open Help > FAQs & support',
    run: async page => {
      await page.getByRole('button', { name: /^help$/i }).click();
      await page.getByText(/^faqs & support$/i).click();
    },
  },
  tutorial: {
    description: 'Open Help page tutorial launch',
    run: async page => {
      await page.goto('/help', { waitUntil: 'load' });
      await page.getByRole('button', { name: /launch tutorial/i }).click();
    },
  },
  bug: {
    description: 'Open Report a bug dialog',
    run: page => page.getByRole('button', { name: /report a bug/i }).click(),
  },
  notifications: {
    description: 'Open notifications panel',
    run: page => page.getByRole('button', { name: /notifications/i }).click(),
  },
  profile: {
    description: 'Open user profile menu',
    run: page => page.getByRole('button', { name: /user profile menu/i }).click(),
  },
  profileSettings: {
    description: 'Open Profile Settings from user profile menu',
    run: async page => {
      await page.getByRole('button', { name: /user profile menu/i }).click();
      await page.getByText(/^profile settings$/i).click();
    },
  },
  signOut: {
    description: 'Open Sign Out from user profile menu',
    run: async page => {
      await page.getByRole('button', { name: /user profile menu/i }).click();
      await page.getByText(/^sign out$/i).click();
    },
  },
  scoreboard: {
    description: 'Open first scoreboard link',
    run: page => page.locator('a[href="/scoreboard"]').first().click(),
  },
};

async function capture(page) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const headings = await page.locator('h1, h2, h3').allTextContents().catch(() => []);
  const dialogs = await page.locator('[role="dialog"], [data-state="open"]').evaluateAll(nodes =>
    nodes.map(node => (node.textContent || '').trim()).filter(Boolean).slice(0, 5)
  ).catch(() => []);

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    headings,
    dialogs,
    excerpt: bodyText.slice(0, 1200),
  };
}

async function main() {
  const action = actions[actionName];
  if (!action) {
    throw new Error(`Unknown action ${actionName}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: process.env.BASE_URL,
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const badResponses = [];
  const consoleErrors = [];

  page.on('response', response => {
    if (response.status() >= 400) {
      badResponses.push({ url: response.url(), status: response.status() });
    }
  });

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push({ type: message.type(), text: message.text() });
    }
  });

  try {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});

    const before = await capture(page);
    let actionError = null;

    try {
      await action.run(page);
      await page.waitForTimeout(1500);
      await page.waitForLoadState('networkidle').catch(() => {});
    } catch (error) {
      actionError = String(error);
    }

    const after = await capture(page);
    const screenshotPath = path.join(process.cwd(), 'qa-results', `authenticated_probe_${actionName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    const result = {
      action: actionName,
      description: action.description,
      before,
      after,
      actionError,
      badResponses,
      consoleErrors,
      screenshotPath,
    };

    const outPath = path.join(process.cwd(), 'qa-results', `authenticated_probe_${actionName}.json`);
    await fs.writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});