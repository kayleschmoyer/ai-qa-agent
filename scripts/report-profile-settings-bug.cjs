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
        labels: ['playwright', 'web', 'accessibility', 'profile-settings'],
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
    summary: 'Profile Settings username "Edit" control is not exposed as an interactive element',
    description: [
      'Observed on 2026-04-13 on https://legacy-fantasy.com/profile/settings using a real authenticated session for legacyplaywright@gmail.com.',
      '',
      'Expected:',
      'The visible "Edit" affordance beside Username should be a real interactive control that can be discovered and activated by keyboard and assistive technology.',
      '',
      'Actual:',
      'The page copy says the username can be changed and shows a blue "Edit" pill, but the affordance is rendered as non-semantic markup instead of an interactive control.',
      '',
      'Evidence captured during the Playwright probe:',
      '- The visible node resolves to a plain <p> with text "Edit".',
      '- Its ancestor chain is only <div>/<p> wrappers with no button role and no tabindex.',
      '- It does not appear in the keyboard focus order.',
      '',
      'Why this matters:',
      '- Keyboard-only users cannot reach the control.',
      '- Screen readers do not get an actionable control for editing the username.',
      '- The page presents username editing as available while hiding the action behind non-semantic markup.',
      '',
      'Evidence:',
      '- Screenshot: qa-results/authenticated_flow_updateUsername.png',
      '- DOM probe output confirmed the visible "Edit" element is a <p> with no role/tabindex.',
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

  const outPath = path.join(process.cwd(), 'qa-results', 'profile_settings_jira_issue.json');
  await fs.writeFile(outPath, JSON.stringify(created, null, 2), 'utf8');
  console.log(JSON.stringify(created, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});