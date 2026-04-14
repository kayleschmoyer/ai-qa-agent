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
      summary: 'Homepage accessibility: color contrast fails WCAG AA on public landing page',
      description: [
        'Observed on https://legacy-fantasy.com/ as an unauthenticated visitor on 2026-04-14.',
        'Automated axe audit found a serious color-contrast violation affecting 4 nodes on the public homepage.',
        '',
        'Expected:',
        'Public homepage text and interactive content should meet WCAG 2.1 AA color contrast requirements.',
        '',
        'Actual:',
        'Axe reports color-contrast failures on the landing page, which can make content difficult to read for low-vision users.',
        '',
        'Evidence:',
        '- Audit file: qa-results/homepage_public_audit.json',
        '- Screenshot: qa-results/homepage_public_audit.png',
        '- Violation id: color-contrast',
        '- Impact: serious',
        '- Affected node count: 4',
        '',
        'Reproduction:',
        '1. Open https://legacy-fantasy.com/ in a fresh browser session.',
        '2. Run an accessibility audit or inspect low-contrast text on the landing page.',
        '3. Observe WCAG AA color contrast failures.',
        '',
        'Notes:',
        'The same unauthenticated homepage audit showed no HTTP failures, so this appears to be a page styling issue rather than a load failure.',
      ].join('\n'),
    },
    {
      summary: 'Homepage accessibility: public landing page lacks main landmark structure',
      description: [
        'Observed on https://legacy-fantasy.com/ as an unauthenticated visitor on 2026-04-14.',
        'Automated axe audit found semantic landmark violations on the public homepage.',
        '',
        'Expected:',
        'The page should expose one main landmark and group content into landmark regions so screen-reader users can navigate the page structure efficiently.',
        '',
        'Actual:',
        'Axe reported both landmark-one-main and region violations on the landing page.',
        '',
        'Evidence:',
        '- Audit file: qa-results/homepage_public_audit.json',
        '- Screenshot: qa-results/homepage_public_audit.png',
        '- Violation ids: landmark-one-main, region',
        '- landmark-one-main nodes: 1',
        '- region nodes: 14',
        '',
        'Reproduction:',
        '1. Open https://legacy-fantasy.com/ in a fresh browser session.',
        '2. Run an accessibility audit against the landing page.',
        '3. Observe missing main landmark and content not fully contained by landmark regions.',
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

  const outPath = path.join(process.cwd(), 'qa-results', 'homepage_public_jira_issues.json');
  await fs.writeFile(outPath, JSON.stringify(created, null, 2), 'utf8');
  console.log(JSON.stringify(created, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});