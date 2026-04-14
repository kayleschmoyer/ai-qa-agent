require('dotenv/config');

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEBUG_PORT = process.env.CHROME_DEBUG_PORT || '9222';
const BASE_URL = process.env.BASE_URL;
const USER_DATA_DIR = process.env.AUTH_CHROME_PROFILE || path.join(os.tmpdir(), 'legacy-auth-profile');

const candidatePaths = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function resolveChromePath() {
  return candidatePaths.find(candidate => fs.existsSync(candidate));
}

function main() {
  if (!BASE_URL) {
    throw new Error('BASE_URL must be set in .env before opening Chrome.');
  }

  const chromePath = resolveChromePath();
  if (!chromePath) {
    throw new Error('Could not find Chrome. Set CHROME_PATH in .env to your chrome.exe path.');
  }

  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${USER_DATA_DIR}`,
      BASE_URL,
    ],
    {
      detached: true,
      stdio: 'ignore',
    }
  );

  child.unref();

  console.log(`Opened Chrome with remote debugging on port ${DEBUG_PORT}`);
  console.log(`Profile directory: ${USER_DATA_DIR}`);
  console.log(`Navigate and sign in at ${BASE_URL}, then run npm run auth:save-session`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}