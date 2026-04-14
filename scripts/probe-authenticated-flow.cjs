require('dotenv/config');

const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const STORAGE_STATE_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
const flowName = process.argv[2];

async function capture(page) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const headings = await page.locator('h1, h2, h3').allTextContents().catch(() => []);
  const dialogs = await page
    .locator('[role="dialog"], [data-state="open"]')
    .evaluateAll(nodes => nodes.map(node => (node.textContent || '').trim()).filter(Boolean).slice(0, 5))
    .catch(() => []);

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    headings,
    dialogs,
    excerpt: bodyText.slice(0, 3000),
  };
}

const flows = {
  joinLeagueCta: {
    description: 'Open Baseball hub and activate the visible Join League CTA',
    run: async page => {
      await page.goto('/baseball', { waitUntil: 'load' });
      const joinLeague = page.getByText(/^join league$/i).first();
      const href = await joinLeague.evaluate(node => {
        const anchor = node.closest('a');
        return anchor ? anchor.getAttribute('href') : null;
      });
      await joinLeague.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      return { href };
    },
  },
  startMockDraft: {
    description: 'Open Mock Draft and start a draft with default settings',
    run: async page => {
      await page.goto('/baseball/mock-draft', { waitUntil: 'load' });
      await page.getByRole('button', { name: /start mock draft/i }).click();
      await page.waitForLoadState('networkidle').catch(() => {});
      return {
        hasDraftBoard: await page.getByText(/round 1|on the clock|draft board|mock draft/i).first().isVisible().catch(() => false),
      };
    },
  },
  updateUsername: {
    description: 'Edit the username on Profile Settings and attempt to save',
    run: async page => {
      await page.goto('/profile/settings', { waitUntil: 'load' });
      const editButton = page.getByRole('button', { name: /^edit$/i }).first();
      await editButton.click();
      const usernameInput = page.getByLabel(/username/i).or(page.locator('input[name="username"], input[id*="username"]')).first();
      const original = await usernameInput.inputValue();
      const nextValue = `legacyplaywright-${Date.now().toString().slice(-6)}`;
      await usernameInput.fill(nextValue);
      await page.getByRole('button', { name: /^save$/i }).first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      const body = await page.locator('body').innerText().catch(() => '');
      return {
        original,
        attempted: nextValue,
        savedValue: await usernameInput.inputValue().catch(() => null),
        successMessageVisible: /saved|updated|success/i.test(body),
      };
    },
  },
};

async function main() {
  const flow = flows[flowName];
  if (!flow) {
    throw new Error(`Unknown flow ${flowName}`);
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
    let flowError = null;
    let details = null;

    try {
      details = await flow.run(page);
      await page.waitForTimeout(1500);
      await page.waitForLoadState('networkidle').catch(() => {});
    } catch (error) {
      flowError = String(error);
    }

    const after = await capture(page);
    const screenshotPath = path.join(process.cwd(), 'qa-results', `authenticated_flow_${flowName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    const result = {
      flow: flowName,
      description: flow.description,
      before,
      after,
      details,
      flowError,
      badResponses,
      consoleErrors,
      screenshotPath,
    };

    const outPath = path.join(process.cwd(), 'qa-results', `authenticated_flow_${flowName}.json`);
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