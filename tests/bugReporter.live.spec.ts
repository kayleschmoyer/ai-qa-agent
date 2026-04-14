import { expect, test } from '@playwright/test';
import { reportDetectedIssuesIfPossible } from '../src/utils/bugReporter';
import { saveQaResult } from '../src/utils/reporter';

const bugTriggerSelector = 'span[role="button"][aria-label="Report a bug"][aria-haspopup="dialog"], [aria-label="Report a bug"]';

test.describe('Live bug report verification', () => {
  test('submits a real signed-in bug report for Jira verification', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    process.env.REPORT_BUGS_ON_FAILURE = 'true';

    await page.goto('/');

    const bugTrigger = page.locator(bugTriggerSelector).first();

    await testInfo.attach('manual-verification-instructions', {
      body: Buffer.from(
        'If the page is not already signed in, complete login in the opened browser window. The test will continue automatically once the Report a bug control appears.',
        'utf8'
      ),
      contentType: 'text/plain',
    });

    await expect(
      bugTrigger,
      'Sign in in the opened browser window. Waiting for the Report a bug control to appear.'
    ).toBeVisible({ timeout: 120_000 });

    const marker = `QA live Jira verification ${new Date().toISOString()} ${testInfo.project.name}`;
    const summary = [
      marker,
      'This is an automated live verification submission from Playwright.',
      'If this appears in Jira, the in-app bug report flow is wired correctly.',
    ].join('\n');

    const result = await reportDetectedIssuesIfPossible({
      page,
      summary,
    });

    const report = {
      marker,
      summary,
      result,
      url: page.url(),
    };

    await testInfo.attach('live-bug-report-submission', {
      body: Buffer.from(JSON.stringify(report, null, 2), 'utf8'),
      contentType: 'application/json',
    });

    await saveQaResult(report, `${testInfo.title.replace(/[^\w-]+/g, '_')}.json`);

    expect(result.submitted, result.reason).toBe(true);
  });
});