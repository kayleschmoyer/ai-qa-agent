import type { Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR = path.join(process.cwd(), 'playwright', '.auth');
const TOKEN_CACHE_PATH = path.join(AUTH_DIR, 'token-cache.json');
const DEV_JWT_SECRET = 'dev-jwt-secret-key-not-for-production-use-only';
const DEFAULT_IDENTITY = 'admin';
const DEFAULT_AUTH_MODE = 'ci';

type AccessLevel = 'admin' | 'none';

interface JwtPayload {
  iat: number;
  exp: number;
  id: number;
  email: string;
  username: string;
  accessLevel: AccessLevel;
}

interface TokenCache {
  jwt: string;
  email: string;
  expiresAt: number;
}

interface TestIdentity {
  id: number;
  email: string;
  username: string;
  accessLevel: AccessLevel;
}

interface ResolvedAuthSession {
  jwt: string;
  payload: JwtPayload;
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  jwt: string;
  user: {
    id?: number;
    email: string;
    username?: string;
    accessLevel: string;
  };
}

const TEST_IDENTITIES: Record<string, TestIdentity> = {
  admin: {
    id: 1,
    email: 'admin@test.com',
    username: 'admin',
    accessLevel: 'admin',
  },
  user: {
    id: 2,
    email: 'user@test.com',
    username: 'testuser',
    accessLevel: 'none',
  },
  creator: {
    id: 3,
    email: 'creator@test.com',
    username: 'creator',
    accessLevel: 'none',
  },
  participant: {
    id: 4,
    email: 'participant@test.com',
    username: 'participant',
    accessLevel: 'none',
  },
};

export async function resolveAuthSession(options?: {
  forceRefresh?: boolean;
  openVerificationUrl?: (url: string) => Promise<void> | void;
}): Promise<ResolvedAuthSession> {
  const authMode = (process.env.E2E_AUTH_MODE || (process.env.CI === 'true' ? 'ci' : DEFAULT_AUTH_MODE)).toLowerCase();

  if (authMode !== 'device') {
    return signCiAuthSession();
  }

  if (options?.forceRefresh) {
    clearCachedToken();
  }

  const cached = loadCachedToken();
  if (cached) {
    console.log(`[Auth] Using cached device-flow token for ${cached.email}`);
    return {
      jwt: cached.jwt,
      payload: parseJwtPayload(cached.jwt),
    };
  }

  console.log('[Auth] No valid cached token, starting device flow');
  return runDeviceFlow(options?.openVerificationUrl);
}

export async function resolveAuthToken(options?: {
  forceRefresh?: boolean;
  openVerificationUrl?: (url: string) => Promise<void> | void;
}) {
  const session = await resolveAuthSession(options);
  return session.jwt;
}

export function buildAuthStorageState(origin: string, session: ResolvedAuthSession) {
  const url = new URL(origin);
  const profile = {
    id: session.payload.id,
    email: session.payload.email,
    username: session.payload.username,
    accessLevel: session.payload.accessLevel,
  };

  return {
    cookies: [
      {
        name: 'ls_jwt',
        value: session.jwt,
        domain: url.hostname,
        path: '/',
        expires: session.payload.exp,
        httpOnly: true,
        secure: url.protocol === 'https:',
        sameSite: 'Lax' as const,
      },
      {
        name: 'ls_csrf',
        value: 'e2e-csrf-token',
        domain: url.hostname,
        path: '/',
        expires: session.payload.exp,
        httpOnly: false,
        secure: url.protocol === 'https:',
        sameSite: 'Lax' as const,
      },
    ],
    origins: [
      {
        origin: `${url.protocol}//${url.host}`,
        localStorage: [
          {
            name: 'ls_user_profile',
            value: JSON.stringify(profile),
          },
          {
            name: 'ls_token_expiry',
            value: String(session.payload.exp),
          },
        ],
      },
    ],
  };
}

export async function authenticateInCurrentBrowserSession(
  page: Page,
  options?: { forceRefresh?: boolean },
) {
  const session = await resolveAuthSession({
    forceRefresh: options?.forceRefresh,
    openVerificationUrl: async url => {
      console.log('[Auth] Complete device-flow approval in the current browser window');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    },
  });

  const baseURL = process.env.BASE_URL;
  if (!baseURL) {
    throw new Error('BASE_URL must be set for in-browser authentication.');
  }

  const storageState = buildAuthStorageState(baseURL, session);
  await page.context().addCookies(storageState.cookies);
  await page.context().addInitScript(entries => {
    for (const entry of entries) {
      window.localStorage.setItem(entry.name, entry.value);
    }
  }, storageState.origins[0].localStorage);

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});

  return {
    hasToken: true,
    email: session.payload.email,
    accessLevel: session.payload.accessLevel,
  };
}

function loadCachedToken(): TokenCache | null {
  try {
    if (!fs.existsSync(TOKEN_CACHE_PATH)) {
      return null;
    }

    const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8')) as TokenCache;
    if (!cache.jwt || cache.jwt.split('.').length !== 3) {
      return null;
    }

    if (cache.expiresAt - 5 * 60 * 1000 < Date.now()) {
      console.log('[Auth] Cached token expired');
      return null;
    }

    return cache;
  } catch {
    return null;
  }
}

function clearCachedToken() {
  try {
    fs.rmSync(TOKEN_CACHE_PATH, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function cacheToken(jwt: string, email: string, expiresInSeconds: number) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(
    TOKEN_CACHE_PATH,
    JSON.stringify(
      {
        jwt,
        email,
        expiresAt: Date.now() + expiresInSeconds * 1000,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

async function runDeviceFlow(openVerificationUrl?: (url: string) => Promise<void> | void): Promise<string> {
  const oauthUrl = resolveOAuthUrl();
  const deviceName = `AI-QA-${process.env.COMPUTERNAME || process.env.HOSTNAME || 'local'}`;

  const authResponse = await fetch(`${oauthUrl}/device/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_type: 'cli',
      device_name: deviceName,
    }),
  });

  if (!authResponse.ok) {
    throw new Error(
      `Device auth request failed (${authResponse.status}): ${await authResponse.text()}`,
    );
  }

  const deviceAuth = (await authResponse.json()) as DeviceAuthResponse;

  console.log('');
  console.log('Device-flow authentication required');
  console.log(`Code: ${deviceAuth.user_code}`);
  console.log(`URL:  ${deviceAuth.verification_uri_complete}`);
  console.log('');

  if (openVerificationUrl) {
    await openVerificationUrl(deviceAuth.verification_uri_complete);
  } else {
    openBrowser(deviceAuth.verification_uri_complete);
  }

  const pollIntervalMs = (deviceAuth.interval || 5) * 1000;
  const deadline = Date.now() + deviceAuth.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const tokenResponse = await fetch(`${oauthUrl}/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceAuth.device_code }),
    });

    if (tokenResponse.status === 200) {
      const data = (await tokenResponse.json()) as DeviceTokenResponse;
      cacheToken(data.jwt, data.user.email, 24 * 60 * 60);
      console.log(`[Auth] Authenticated as ${data.user.email} (${data.user.accessLevel})`);
      return {
        jwt: data.jwt,
        payload: parseJwtPayload(data.jwt),
      };
    }

    if (tokenResponse.status === 428) {
      continue;
    }

    const errorBody = await tokenResponse.text().catch(() => 'unknown');
    throw new Error(`Device flow token request failed (${tokenResponse.status}): ${errorBody}`);
  }

  throw new Error('Device flow timed out before authorization completed.');
}

function signCiAuthSession(): ResolvedAuthSession {
  const identityName = process.env.E2E_TEST_IDENTITY || DEFAULT_IDENTITY;
  const identity = TEST_IDENTITIES[identityName];

  if (!identity) {
    throw new Error(
      `Unknown E2E_TEST_IDENTITY \"${identityName}\". Use one of: ${Object.keys(TEST_IDENTITIES).join(', ')}`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iat: now,
    exp: now + 24 * 60 * 60,
    id: identity.id,
    email: identity.email,
    username: identity.username,
    accessLevel: identity.accessLevel,
  };

  console.log(`[Auth] ${'CI-compatible'} auth mode enabled, signing JWT for ${payload.email} (${payload.accessLevel})`);

  return {
    jwt: signJwt(payload, process.env.JWT_SECRET || DEV_JWT_SECRET),
    payload,
  };
}

function signJwt(payload: JwtPayload, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(unsignedToken).digest('base64url');
  return `${unsignedToken}.${signature}`;
}

function parseJwtPayload(jwt: string): JwtPayload {
  const [, payloadPart] = jwt.split('.');
  if (!payloadPart) {
    throw new Error('Invalid JWT payload');
  }

  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as JwtPayload;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function resolveOAuthUrl(): string {
  return (
    process.env.VITE_OAUTH_PROXY_URL ||
    process.env.OAUTH_PROXY_URL ||
    'https://bd1opa1yv7.execute-api.us-east-1.amazonaws.com/dev/oauth'
  );
}

function openBrowser(url: string) {
  try {
    if (process.platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore' });
      return;
    }

    if (process.platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
      return;
    }

    execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch {
    // Ignore browser-open failures; the URL is already printed.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}