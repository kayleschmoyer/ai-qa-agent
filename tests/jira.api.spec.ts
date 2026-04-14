import { expect, test } from '@playwright/test';
import { REQUIRED_JIRA_LABELS, getJiraConfig, getMissingJiraConfigFields, createJiraIssue, getJiraIssue } from '../src/utils/jira';
import { saveQaResult } from '../src/utils/reporter';

test.describe('Jira API verification', () => {
  test('creates a Jira bug directly through the Jira API', async ({}, testInfo) => {
    const config = getJiraConfig();

    test.skip(!config, `Missing Jira config: ${getMissingJiraConfigFields().join(', ')}`);

    const marker = `QA Jira API verification ${new Date().toISOString()} ${testInfo.project.name}`;
    const summary = marker;
    const description = [
      marker,
      'This issue was created by Playwright using the Jira REST API.',
      'Use this to verify direct Jira ticket creation works from automation.',
    ].join('\n');

    const createResponse = await createJiraIssue(config!, {
      summary,
      description,
    });

    const createBody = await createResponse.json().catch(() => null);

    await testInfo.attach('jira-create-response', {
      body: Buffer.from(JSON.stringify({ status: createResponse.status, body: createBody }, null, 2), 'utf8'),
      contentType: 'application/json',
    });

    expect(
      createResponse.ok,
      `Jira issue creation failed with status ${createResponse.status} and body ${JSON.stringify(createBody)}`
    ).toBe(true);
    expect(createBody?.key).toBeTruthy();

    const issueKey = String(createBody.key);
    const getResponse = await getJiraIssue(config!, issueKey);
    const issueBody = await getResponse.json().catch(() => null);

    const report = {
      marker,
      issueKey,
      browseUrl: `${config!.baseUrl}/browse/${issueKey}`,
      createStatus: createResponse.status,
      getStatus: getResponse.status,
      createdIssue: issueBody,
    };

    await testInfo.attach('jira-created-issue', {
      body: Buffer.from(JSON.stringify(report, null, 2), 'utf8'),
      contentType: 'application/json',
    });

    await saveQaResult(report, `${testInfo.title.replace(/[^\w-]+/g, '_')}.json`);

    expect(getResponse.ok, `Jira issue fetch failed with status ${getResponse.status} and body ${JSON.stringify(issueBody)}`).toBe(true);
    expect(issueBody?.fields?.summary).toBe(summary);
    expect(issueBody?.fields?.labels).toEqual([...REQUIRED_JIRA_LABELS]);
  });
});