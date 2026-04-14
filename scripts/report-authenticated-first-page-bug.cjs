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
    summary: 'Authenticated dashboard fails to load leagues and repeatedly 401s refresh-jwt for real user session',
    description: [
      'Observed on https://legacy-fantasy.com/ on 2026-04-14 using a real device-flow session for legacyplaywright@gmail.com.',
      '',
      'Expected:',
      'After successful login, the first authenticated page should load the user dashboard and either show leagues or a valid empty state.',
      '',
      'Actual:',
      'The authenticated landing page renders Dashboard but immediately shows "Unable to load your leagues" / "Something went wrong while fetching your leagues. Please try again."',
      'At the same time, the app repeatedly requests https://api.legacy-fantasy.com/oauth/refresh-jwt and receives 401 responses.',
      '',
      'Evidence:',
      '- Audit file: qa-results/authenticated_first_page_audit.json',
      '- Screenshot: qa-results/authenticated_first_page_audit.png',
      '- Page title: Dashboard | Legacy Sports',
      '- Heading shown: Unable to load your leagues',
      '- Repeated failing endpoint: https://api.legacy-fantasy.com/oauth/refresh-jwt',
      '- Observed 401 responses during audit: 7',
      '',
      'Real-session reproduction:',
      '1. Sign in to https://legacy-fantasy.com/ with a real device-flow account.',
      '2. Allow the app to land on the first authenticated dashboard page.',
      '3. Observe the leagues error state instead of usable dashboard content.',
      '4. Inspect the network log and see repeated 401 responses from /oauth/refresh-jwt.',
      '',
      'Notes:',
      '- This was reproduced under a real authenticated session, not the hermetic JWT test-user path.',
      '- The audited account resolved to accessLevel none, but the page still presents an error state rather than a clean empty state, so this is still user-facing breakage.',
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

  const outPath = path.join(process.cwd(), 'qa-results', 'authenticated_first_page_jira_issue.json');
  await fs.writeFile(outPath, JSON.stringify(created, null, 2), 'utf8');
  console.log(JSON.stringify(created, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});