import type { FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { buildAuthStorageState, resolveAuthSession } from './auth-session';

const AUTH_DIR = path.join(process.cwd(), 'playwright', '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'session.json');

export default async function globalSetup(config: FullConfig) {
  if (process.env.AUTH_IN_BROWSER === 'true') {
    console.log('[Auth] Skipping global auth setup because AUTH_IN_BROWSER=true');
    return;
  }

  console.log('[Auth] Running Playwright auth setup');

  const session = await resolveAuthSession({
    forceRefresh: process.env.FORCE_AUTH_SETUP === 'true',
  });
  const projectUse = config.projects[0]?.use;
  const baseURL = typeof projectUse?.baseURL === 'string' ? projectUse.baseURL : process.env.BASE_URL;

  if (!baseURL) {
    throw new Error('BASE_URL must be set to write authenticated storage state.');
  }

  writeStorageState(baseURL, session);
  console.log('[Auth] Wrote authenticated storage state to playwright/.auth/session.json');
}

function writeStorageState(origin: string, session: Awaited<ReturnType<typeof resolveAuthSession>>) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  fs.writeFileSync(
    STORAGE_STATE_PATH,
    JSON.stringify(buildAuthStorageState(origin, session), null, 2),
  );
}