require('dotenv/config');

const fs = require('node:fs/promises');
const path = require('node:path');

function getJiraConfig() {
  const baseUrl = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
  const email = process.env.JIRA_EMAIL || '';
  const apiToken = process.env.JIRA_API_TOKEN || '';
  const projectKey = process.env.JIRA_PROJECT_KEY || '';
  const issueType = process.env.JIRA_ISSUE_TYPE || 'Bug';

  if (!baseUrl || !email || !apiToken || !projectKey) {
    return null;
  }

  return { baseUrl, email, apiToken, projectKey, issueType };
}

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`, 'utf8').toString('base64')}`;
}

async function createJiraIssue(config, input) {
  return fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(config),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        issuetype: { name: config.issueType },
        summary: input.summary,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: input.description,
                },
              ],
            },
          ],
        },
        labels: ['playwright', 'web'],
      },
    }),
  });
}

async function main() {
  const config = getJiraConfig();
  if (!config) {
    throw new Error('Missing Jira configuration in .env');
  }

  const issue = {
    summary: 'Authenticated routes repeatedly 401 /oauth/refresh-jwt for real user sessions',
    description: [
      'Observed on https://legacy-fantasy.com/ on 2026-04-14 using a real saved device-flow session for legacyplaywright@gmail.com.',
      '',
      'Expected:',
      'Authenticated routes should either refresh the session successfully or remain quiet when the current session is valid. They should not repeatedly emit 401s during normal navigation.',
      '',
      'Actual:',
      'Multiple authenticated routes repeatedly call https://api.legacy-fantasy.com/oauth/refresh-jwt and receive 401 responses, producing repeated console errors during otherwise normal navigation.',
      '',
      'Routes where this reproduced during the broad authenticated pass:',
      '- Dashboard (/)',
      '- Players (/players)',
      '- Baseball hub (/baseball)',
      '- Create League (/baseball/league/create)',
      '- Pricing (/pricing)',
      '- Help (/help)',
      '',
      'Evidence:',
      '- Dashboard audit: qa-results/authenticated_first_page_audit.json',
      '- Players route probe: qa-results/authenticated_probe_allPlayers.json',
      '- Baseball hub probe: qa-results/authenticated_probe_browseLeagues.json',
      '- Create League probe: qa-results/authenticated_probe_createLeague.json',
      '- Pricing probe: qa-results/authenticated_probe_pricing.json',
      '- Help probe: qa-results/authenticated_probe_faq.json',
      '',
      'Observed impact:',
      '- Repeated browser console errors',
      '- Repeated 401 responses from /oauth/refresh-jwt during standard route navigation',
      '- At least one downstream user-facing failure state already exists on the dashboard (tracked separately)',
      '- Rollbar also started returning 429 on one route after the client generated repeated errors',
      '',
      'Real-session reproduction:',
      '1. Sign in to https://legacy-fantasy.com/ with a real device-flow account.',
      '2. Navigate through authenticated routes such as Dashboard, Players, Baseball hub, Pricing, or Help.',
      '3. Inspect the network log and browser console.',
      '4. Observe repeated 401 responses from /oauth/refresh-jwt and matching console errors.',
    ].join('\n'),
  };

  const response = await createJiraIssue(config, issue);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Jira create failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const created = {
    summary: issue.summary,
    key: body.key,
    browseUrl: `${config.baseUrl}/browse/${body.key}`,
  };

  const outPath = path.join(process.cwd(), 'qa-results', 'authenticated_refresh_jira_issue.json');
  await fs.writeFile(outPath, JSON.stringify(created, null, 2), 'utf8');
  console.log(JSON.stringify(created, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});