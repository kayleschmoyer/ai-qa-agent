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

  const issues = [
    {
      summary: 'Authenticated deep links return 404 document responses on valid in-app routes',
      description: [
        'Observed on 2026-04-14 using a real authenticated session for legacyplaywright@gmail.com.',
        '',
        'Expected:',
        'Direct navigation or browser refresh on valid authenticated routes should return an HTTP 200 document response, not a 404.',
        '',
        'Actual:',
        'Valid in-app authenticated routes render after client hydration but the initial document request returns HTTP 404.',
        '',
        'Routes confirmed:',
        '- https://legacy-fantasy.com/games/season-draft',
        '- https://legacy-fantasy.com/baseball/league/create',
        '',
        'Why this matters:',
        '- Browser refresh on these routes is broken at the HTTP layer',
        '- Shared deep links and bookmarks can report as not found',
        '- Crawlers, uptime checks, and edge caches will treat these pages as 404s even though the SPA later renders them',
        '',
        'Evidence:',
        '- Games deep check output captured a 404 for /games/season-draft before the page rendered usable content',
        '- Create League submission flow captured a 404 for /baseball/league/create before the page rendered',
        '- Screenshot: qa-results/authenticated_games_deep.png',
        '- Screenshot: qa-results/authenticated_create_league_submit.png',
      ].join('\n'),
    },
    {
      summary: 'Create League submission rejects real authenticated user with "Authentication required"',
      description: [
        'Observed on 2026-04-14 using a real authenticated session for legacyplaywright@gmail.com.',
        '',
        'Expected:',
        'A logged-in user on Create Baseball League should be able to submit the form or receive field-level validation tied to the form data.',
        '',
        'Actual:',
        'After entering a league name and submitting, the page shows a red error banner: "Authentication required to create a league".',
        '',
        'Reproduction:',
        '1. Sign in to https://legacy-fantasy.com/ with a real account.',
        '2. Open My Leagues > Create a League.',
        '3. Enter a valid league name.',
        '4. Click Create League.',
        '5. Observe the authentication error banner even though the user is already signed in.',
        '',
        'Evidence:',
        '- Screenshot: qa-results/authenticated_create_league_submit.png',
        '- Captured page text includes: "Authentication required to create a league"',
        '- The same flow also shows repeated 401 refresh-jwt responses in the network log',
      ].join('\n'),
    },
  ];

  const created = [];
  for (const issue of issues) {
    const response = await createJiraIssue(config, issue);
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`Jira create failed for \"${issue.summary}\": ${response.status} ${JSON.stringify(body)}`);
    }

    created.push({
      summary: issue.summary,
      key: body.key,
      browseUrl: `${config.baseUrl}/browse/${body.key}`,
    });
  }

  const outPath = path.join(process.cwd(), 'qa-results', 'deeper_authenticated_jira_issues.json');
  await fs.writeFile(outPath, JSON.stringify(created, null, 2), 'utf8');
  console.log(JSON.stringify(created, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});