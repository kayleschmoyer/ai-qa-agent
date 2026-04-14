import 'dotenv/config';

export type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
};

export type JiraIssue = {
  id: string;
  key: string;
  self: string;
};

export const REQUIRED_JIRA_LABELS = ['playwright', 'web'] as const;

export function getJiraConfig(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL || '';
  const email = process.env.JIRA_EMAIL || '';
  const apiToken = process.env.JIRA_API_TOKEN || '';
  const projectKey = process.env.JIRA_PROJECT_KEY || '';
  const issueType = process.env.JIRA_ISSUE_TYPE || 'Bug';

  if (!baseUrl || !email || !apiToken || !projectKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    email,
    apiToken,
    projectKey,
    issueType,
  };
}

export function getMissingJiraConfigFields() {
  const missing: string[] = [];

  if (!process.env.JIRA_BASE_URL) {
    missing.push('JIRA_BASE_URL');
  }

  if (!process.env.JIRA_EMAIL) {
    missing.push('JIRA_EMAIL');
  }

  if (!process.env.JIRA_API_TOKEN) {
    missing.push('JIRA_API_TOKEN');
  }

  if (!process.env.JIRA_PROJECT_KEY) {
    missing.push('JIRA_PROJECT_KEY');
  }

  return missing;
}

function authHeader(config: JiraConfig) {
  const token = Buffer.from(`${config.email}:${config.apiToken}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

export async function createJiraIssue(config: JiraConfig, input: { summary: string; description: string; labels?: string[] }) {
  const labels = [...REQUIRED_JIRA_LABELS];

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
        labels,
      },
    }),
  });
}

export async function getJiraIssue(config: JiraConfig, issueKey: string) {
  return fetch(`${config.baseUrl}/rest/api/3/issue/${issueKey}?fields=summary,status,labels,issuetype,project`, {
    headers: {
      Authorization: authHeader(config),
      Accept: 'application/json',
    },
  });
}