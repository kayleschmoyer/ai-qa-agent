import { expect, test } from '@playwright/test';
import { reportDetectedIssuesIfPossible } from '../src/utils/bugReporter';

const originalEnv = {
  reportBugsOnFailure: process.env.REPORT_BUGS_ON_FAILURE,
  triggerSelector: process.env.BUG_REPORT_TRIGGER_SELECTOR,
  textareaSelector: process.env.BUG_REPORT_TEXTAREA_SELECTOR,
  submitSelector: process.env.BUG_REPORT_SUBMIT_SELECTOR,
  dialogSelector: process.env.BUG_REPORT_DIALOG_SELECTOR,
};

test.beforeEach(() => {
  process.env.REPORT_BUGS_ON_FAILURE = 'true';
  delete process.env.BUG_REPORT_TRIGGER_SELECTOR;
  delete process.env.BUG_REPORT_TEXTAREA_SELECTOR;
  delete process.env.BUG_REPORT_SUBMIT_SELECTOR;
  delete process.env.BUG_REPORT_DIALOG_SELECTOR;
});

test.afterEach(() => {
  process.env.REPORT_BUGS_ON_FAILURE = originalEnv.reportBugsOnFailure;
  process.env.BUG_REPORT_TRIGGER_SELECTOR = originalEnv.triggerSelector;
  process.env.BUG_REPORT_TEXTAREA_SELECTOR = originalEnv.textareaSelector;
  process.env.BUG_REPORT_SUBMIT_SELECTOR = originalEnv.submitSelector;
  process.env.BUG_REPORT_DIALOG_SELECTOR = originalEnv.dialogSelector;
});

test('submits a bug report when trigger, textarea, and submit button exist', async ({ page }) => {
  await page.setContent(`
    <span
      role="button"
      aria-label="Report a bug"
      aria-haspopup="dialog"
      aria-expanded="false"
      aria-controls="Dialog--_r_21_-content"
      data-state="closed"
      tabindex="0"
      id="bug-trigger"
    >Report bug</span>
    <div id="Dialog--_r_21_-content" style="display:none;">
      <div>
        <div>
          <textarea id="bug-textarea"></textarea>
        </div>
        <div>
          <button type="button">Cancel</button>
          <button id="submit-report" type="button" disabled>Submit Report</button>
        </div>
      </div>
    </div>
    <script>
      window.__submitted = false;
      const trigger = document.getElementById('bug-trigger');
      const dialog = document.getElementById('Dialog--_r_21_-content');
      const textarea = document.getElementById('bug-textarea');
      const submit = document.getElementById('submit-report');

      trigger.addEventListener('click', () => {
        dialog.style.display = 'block';
        trigger.setAttribute('aria-expanded', 'true');
      });

      textarea.addEventListener('input', () => {
        submit.disabled = textarea.value.trim().length === 0;
      });

      submit.addEventListener('click', () => {
        window.__submitted = true;
        window.__submittedText = textarea.value;
      });
    </script>
  `);

  const result = await reportDetectedIssuesIfPossible({
    page,
    summary: 'Serious axe violations: color-contrast (2 nodes)',
  });

  expect(result).toMatchObject({
    enabled: true,
    issuesFound: true,
    attempted: true,
    submitted: true,
    triggerFound: true,
    inputFound: true,
    submitFound: true,
  });

  await expect.poll(async () => page.evaluate(() => ({
    submitted: Boolean((window as typeof window & { __submitted?: boolean }).__submitted),
    submittedText: (window as typeof window & { __submittedText?: string }).__submittedText || '',
  }))).toEqual({
    submitted: true,
    submittedText: 'Serious axe violations: color-contrast (2 nodes)',
  });
});

test('returns a useful result when auto-reporting is disabled', async ({ page }) => {
  process.env.REPORT_BUGS_ON_FAILURE = 'false';
  await page.setContent('<div>noop</div>');

  const result = await reportDetectedIssuesIfPossible({
    page,
    summary: 'Accessibility issue found',
  });

  expect(result).toMatchObject({
    enabled: false,
    issuesFound: true,
    attempted: false,
    submitted: false,
  });
  expect(result.reason).toContain('disabled');
});

test('returns a useful result when there are no issues to report', async ({ page }) => {
  await page.setContent('<div>noop</div>');

  const result = await reportDetectedIssuesIfPossible({
    page,
    summary: '',
  });

  expect(result).toMatchObject({
    issuesFound: false,
    attempted: false,
    submitted: false,
  });
  expect(result.reason).toBe('No issues detected');
});