#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const matrixCommand = 'npx playwright test tests/smoke.spec.ts tests/jira.api.spec.ts --project=chromium --workers=1';

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstErrorLine(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLike = lines.find((line) => /(^error\b|\bfailed\b|\bexception\b|\b401\b|\b403\b|\b404\b|\b429\b|\b500\b)/i.test(line));
  return errorLike || 'See full output above for details.';
}

function checkRequiredEnv(requiredKeys) {
  const missing = requiredKeys.filter((key) => !normalize(process.env[key]));
  return {
    ok: missing.length === 0,
    missing,
  };
}

const providerProfiles = [
  {
    label: 'OpenAI',
    env: {
      QA_AI_PROVIDER: 'openai',
      QA_MODEL: normalize(process.env.OPENAI_QA_MODEL) || 'gpt-4o-mini',
    },
    required: ['OPENAI_API_KEY'],
  },
  {
    label: 'Anthropic',
    env: {
      QA_AI_PROVIDER: 'anthropic',
      QA_MODEL: normalize(process.env.ANTHROPIC_QA_MODEL) || 'claude-3-5-sonnet-20241022',
    },
    required: ['ANTHROPIC_API_KEY'],
  },
  {
    label: 'xAI',
    env: {
      QA_AI_PROVIDER: 'xai',
      QA_MODEL: normalize(process.env.XAI_QA_MODEL) || 'grok-2-vision-latest',
    },
    required: ['XAI_API_KEY'],
  },
  {
    label: 'OpenRouter',
    env: {
      QA_AI_PROVIDER: 'openrouter',
      QA_MODEL: normalize(process.env.OPENROUTER_QA_MODEL) || 'meta-llama/llama-3.3-70b-instruct',
    },
    required: ['OPENROUTER_API_KEY'],
  },
];

function printTable(rows) {
  const headers = ['Provider', 'Status', 'Exit', 'Duration(s)', 'Notes'];
  const widths = headers.map((header, index) => {
    const maxData = rows.reduce((max, row) => {
      const value = String(Object.values(row)[index]);
      return Math.max(max, value.length);
    }, 0);
    return Math.max(header.length, maxData);
  });

  const line = '+' + widths.map((width) => '-'.repeat(width + 2)).join('+') + '+';

  const formatRow = (cells) => {
    return '| ' + cells.map((cell, i) => String(cell).padEnd(widths[i], ' ')).join(' | ') + ' |';
  };

  console.log('\nProvider Matrix Results');
  console.log(line);
  console.log(formatRow(headers));
  console.log(line);
  rows.forEach((row) => {
    console.log(formatRow(Object.values(row)));
  });
  console.log(line);
}

async function run() {
  const rows = [];
  let failed = 0;

  for (const profile of providerProfiles) {
    const envCheck = checkRequiredEnv(profile.required);
    if (!envCheck.ok) {
      rows.push({
        Provider: profile.label,
        Status: 'SKIP',
        Exit: '-',
        'Duration(s)': '0.00',
        Notes: `Missing env: ${envCheck.missing.join(', ')}`,
      });
      continue;
    }

    console.log(`\n=== Running smoke + Jira tests for ${profile.label} ===`);
    const started = Date.now();

    const child = spawnSync(matrixCommand, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...profile.env,
        JIRA_TEST_PROVIDER_LABEL: profile.label,
      },
      shell: true,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    const durationSec = ((Date.now() - started) / 1000).toFixed(2);
    const spawnError = child.error ? `Spawn error: ${child.error.message}` : '';
    const combined = `${child.stdout || ''}\n${child.stderr || ''}\n${spawnError}`;
    const exitCode = typeof child.status === 'number' ? child.status : (child.error ? 1 : 0);
    const passed = exitCode === 0;

    if (combined.trim()) {
      console.log(combined);
    }

    if (!passed) {
      failed += 1;
    }

    rows.push({
      Provider: profile.label,
      Status: passed ? 'PASS' : 'FAIL',
      Exit: String(exitCode),
      'Duration(s)': durationSec,
      Notes: passed ? 'Smoke + Jira tests passed.' : firstErrorLine(combined),
    });
  }

  printTable(rows);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
