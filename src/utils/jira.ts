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

/**
 * Search for existing open Jira issues whose summary matches the given text.
 * Uses JQL `summary ~ "text"` with the project and required labels scoped.
 * Returns matching issue keys (e.g. ['LS-3200', 'LS-3201']).
 */
export async function searchJiraIssues(
  config: JiraConfig,
  summaryText: string,
  maxResults = 5,
): Promise<string[]> {
  // Escape JQL special chars in the summary text
  const escaped = summaryText.replace(/[\\"\[\]{}()+\-!^~*?:|&]/g, ' ').trim();
  if (!escaped) return [];

  const labelFilter = REQUIRED_JIRA_LABELS.map(l => `labels = "${l}"`).join(' AND ');
  const jql = `project = "${config.projectKey}" AND ${labelFilter} AND summary ~ "${escaped}" AND statusCategory != Done ORDER BY created DESC`;

  const url = `${config.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=key,summary`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader(config),
      Accept: 'application/json',
    },
  });

  if (!response.ok) return [];

  const body = (await response.json().catch(() => null)) as any;
  if (!body?.issues?.length) return [];

  return body.issues.map((i: any) => i.key as string);
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