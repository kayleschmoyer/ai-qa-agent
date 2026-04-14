require('dotenv/config');

const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const SESSION_FILE = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
const DEBUG_PORT = process.env.CHROME_DEBUG_PORT || '9222';
const BASE_URL = process.env.BASE_URL;

async function main() {
  if (!BASE_URL) {
    throw new Error('BASE_URL must be set in .env before saving an auth session.');
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`).catch(() => {
    throw new Error(
      `Could not connect to Chrome on port ${DEBUG_PORT}. Start Chrome with --remote-debugging-port=${DEBUG_PORT} and sign into the app there first.`
    );
  });

  try {
    const expectedHost = new URL(BASE_URL).host;
    const contexts = browser.contexts();
    const matchingContext = contexts.find(context =>
      context.pages().some(page => {
        try {
          return new URL(page.url()).host === expectedHost;
        } catch {
          return false;
        }
      })
    );

    if (!matchingContext) {
      throw new Error(
        `No open Chrome tab matched ${BASE_URL}. Open the app in that Chrome window, complete Google sign-in manually, then rerun this command.`
      );
    }

    await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
    await matchingContext.storageState({ path: SESSION_FILE });
    console.log(`Saved authenticated session to ${SESSION_FILE}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});