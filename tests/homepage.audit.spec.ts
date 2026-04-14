import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { reportDetectedIssuesIfPossible } from '../src/utils/bugReporter';
import { saveQaResult } from '../src/utils/reporter';

const knownConsoleNoisePatterns = [
  /Provider's accounts list is empty\./i,
  /fragment with name Matchup already exists/i,
  /fragment with name TeamMember already exists/i,
  /\[GSI_LOGGER\].*FedCM/i,
];

const labelViolationIds = new Set([
  'aria-command-name',
  'aria-input-field-name',
  'button-name',
  'form-field-multiple-labels',
  'input-button-name',
  'label',
  'link-name',
]);

function slugify(value: string) {
  return value.replace(/[^\w-]+/g, '_');
}

function isKnownConsoleNoise(text: string) {
  return knownConsoleNoisePatterns.some((pattern) => pattern.test(text));
}

async function attachJsonReport(testInfo: TestInfo, name: string, data: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(data, null, 2), 'utf8'),
    contentType: 'application/json',
  });
}

function buildRuntimeIssueSummary(report: {
  runtimeAudit: {
    responseStatus: number | null;
    totalNavigationMs: number;
    metrics: {
      domContentLoadedMs: number;
      loadEventEndMs: number;
      responseEndMs: number;
    } | null;
    requestFailures: Array<{ url: string; errorText: string }>;
    badResponses: Array<{ url: string; status: number }>;
  };
  assetHealth: {
    brokenImages: Array<{ src: string }>;
    missingAltImages: Array<{ src: string }>;
  };
  unexpectedConsoleErrors: Array<{ text: string }>;
}) {
  const issues: string[] = [];

  if (report.runtimeAudit.responseStatus !== 200) {
    issues.push(`Homepage returned unexpected status ${String(report.runtimeAudit.responseStatus)}.`);
  }

  if (report.runtimeAudit.requestFailures.length > 0) {
    issues.push(`Failed requests: ${report.runtimeAudit.requestFailures.map((item) => `${item.url} (${item.errorText})`).join('; ')}`);
  }

  if (report.runtimeAudit.badResponses.length > 0) {
    issues.push(`HTTP ${report.runtimeAudit.badResponses.map((item) => `${item.status} at ${item.url}`).join('; ')}`);
  }

  if (report.unexpectedConsoleErrors.length > 0) {
    issues.push(`Unexpected console errors: ${report.unexpectedConsoleErrors.map((item) => item.text).join(' | ')}`);
  }

  if (report.runtimeAudit.totalNavigationMs >= 5000) {
    issues.push(`Homepage total navigation time ${report.runtimeAudit.totalNavigationMs}ms exceeded 5000ms.`);
  }

  if ((report.runtimeAudit.metrics?.responseEndMs ?? 0) >= 1000) {
    issues.push(`Homepage responseEnd ${report.runtimeAudit.metrics?.responseEndMs}ms exceeded 1000ms.`);
  }

  if ((report.runtimeAudit.metrics?.domContentLoadedMs ?? 0) >= 2500) {
    issues.push(`Homepage DOMContentLoaded ${report.runtimeAudit.metrics?.domContentLoadedMs}ms exceeded 2500ms.`);
  }

  if ((report.runtimeAudit.metrics?.loadEventEndMs ?? 0) >= 4000) {
    issues.push(`Homepage loadEventEnd ${report.runtimeAudit.metrics?.loadEventEndMs}ms exceeded 4000ms.`);
  }

  if (report.assetHealth.brokenImages.length > 0) {
    issues.push(`Broken images detected: ${report.assetHealth.brokenImages.map((item) => item.src).join(', ')}`);
  }

  if (report.assetHealth.missingAltImages.length > 0) {
    issues.push(`Images missing alt text: ${report.assetHealth.missingAltImages.map((item) => item.src).join(', ')}`);
  }

  return issues.join('\n');
}

function buildAccessibilityIssueSummary(report: {
  accessibilityAudit: {
    labelViolations: Array<{ id: string; help: string; nodes: number }>;
    imageAltViolations: Array<{ id: string; help: string; nodes: number }>;
    criticalViolations: Array<{ id: string; help: string; nodes: number }>;
    seriousViolations: Array<{ id: string; help: string; nodes: number }>;
  };
  assetHealth: {
    missingAltImages: Array<{ src: string }>;
  };
}) {
  const issues: string[] = [];

  if (report.accessibilityAudit.labelViolations.length > 0) {
    issues.push(`Missing-label violations: ${report.accessibilityAudit.labelViolations.map((item) => `${item.id} (${item.nodes} nodes)`).join(', ')}`);
  }

  if (report.accessibilityAudit.imageAltViolations.length > 0) {
    issues.push(`Image-alt violations: ${report.accessibilityAudit.imageAltViolations.map((item) => `${item.id} (${item.nodes} nodes)`).join(', ')}`);
  }

  if (report.assetHealth.missingAltImages.length > 0) {
    issues.push(`Visible images missing alt text: ${report.assetHealth.missingAltImages.map((item) => item.src).join(', ')}`);
  }

  if (report.accessibilityAudit.criticalViolations.length > 0) {
    issues.push(`Critical axe violations: ${report.accessibilityAudit.criticalViolations.map((item) => `${item.id} (${item.nodes} nodes)`).join(', ')}`);
  }

  if (report.accessibilityAudit.seriousViolations.length > 0) {
    issues.push(`Serious axe violations: ${report.accessibilityAudit.seriousViolations.map((item) => `${item.id} (${item.nodes} nodes)`).join(', ')}`);
  }

  return issues.join('\n');
}

async function gotoHomepageWithSignals(page: Page) {
  const consoleMessages: Array<{ type: string; text: string }> = [];
  const requestFailures: Array<{ url: string; errorText: string }> = [];
  const badResponses: Array<{ url: string; status: number }> = [];

  page.on('console', (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
    });
  });

  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      errorText: request.failure()?.errorText || 'unknown',
    });
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });

  const navigationStartedAt = Date.now();
  const response = await page.goto('/', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const totalNavigationMs = Date.now() - navigationStartedAt;

  const metrics = await page.evaluate(() => {
    const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    if (!navigationEntry) {
      return null;
    }

    return {
      domContentLoadedMs: Math.round(navigationEntry.domContentLoadedEventEnd),
      loadEventEndMs: Math.round(navigationEntry.loadEventEnd),
      responseEndMs: Math.round(navigationEntry.responseEnd),
      transferSize: 'transferSize' in navigationEntry ? navigationEntry.transferSize : null,
      encodedBodySize: 'encodedBodySize' in navigationEntry ? navigationEntry.encodedBodySize : null,
      decodedBodySize: 'decodedBodySize' in navigationEntry ? navigationEntry.decodedBodySize : null,
    };
  });

  return {
    responseStatus: response?.status() ?? null,
    totalNavigationMs,
    metrics,
    consoleMessages,
    requestFailures,
    badResponses,
  };
}

async function collectAssetHealth(page: Page) {
  return page.evaluate(() => {
    const images = Array.from(document.images).map((image) => ({
      src: image.currentSrc || image.src,
      alt: image.getAttribute('alt'),
      ariaHidden: image.getAttribute('aria-hidden'),
      role: image.getAttribute('role'),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    }));

    const brokenImages = images.filter((image) => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0);

    const missingAltImages = images.filter((image) => {
      if (image.ariaHidden === 'true' || image.role === 'presentation') {
        return false;
      }

      return typeof image.alt !== 'string' || image.alt.trim().length === 0;
    });

    return {
      imageCount: images.length,
      brokenImages,
      missingAltImages,
    };
  });
}

async function collectAccessibilityAudit(page: Page) {
  const axeResults = await new AxeBuilder({ page }).analyze();

  const headingSummary = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) => ({
      tag: heading.tagName.toLowerCase(),
      text: (heading.textContent || '').trim(),
    }));

    return {
      headingCount: headings.length,
      h1Count: headings.filter((heading) => heading.tag === 'h1').length,
      headings,
    };
  });

  const criticalViolations = axeResults.violations.filter((violation) => violation.impact === 'critical');
  const seriousViolations = axeResults.violations.filter((violation) => violation.impact === 'serious');
  const labelViolations = axeResults.violations.filter((violation) => labelViolationIds.has(violation.id));
  const imageAltViolations = axeResults.violations.filter((violation) => violation.id === 'image-alt');

  return {
    summary: {
      violationCount: axeResults.violations.length,
      incompleteCount: axeResults.incomplete.length,
      headingCount: headingSummary.headingCount,
      h1Count: headingSummary.h1Count,
    },
    headings: headingSummary.headings,
    criticalViolations: criticalViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
    })),
    seriousViolations: seriousViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
    })),
    labelViolations: labelViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
    })),
    imageAltViolations: imageAltViolations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.length,
    })),
    allViolations: axeResults.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      description: violation.description,
      nodes: violation.nodes.length,
    })),
  };
}

test.describe('Legacy Sports homepage audit', () => {
  test('meets performance, console, network, and asset health gates', async ({ page }, testInfo) => {
    const runtimeAudit = await gotoHomepageWithSignals(page);
    const assetHealth = await collectAssetHealth(page);

    const unexpectedConsoleErrors = runtimeAudit.consoleMessages.filter(
      (message) => message.type === 'error' && !isKnownConsoleNoise(message.text)
    );

    const knownConsoleNoise = runtimeAudit.consoleMessages.filter((message) => isKnownConsoleNoise(message.text));

    const report = {
      page: 'homepage',
      runtimeAudit,
      assetHealth,
      unexpectedConsoleErrors,
      knownConsoleNoise,
    };

    const bugReportAttempt = await reportDetectedIssuesIfPossible({
      page,
      summary: buildRuntimeIssueSummary(report),
    });

    const reportWithBugSubmission = {
      ...report,
      bugReportAttempt,
    };

    await attachJsonReport(testInfo, 'homepage-runtime-audit', reportWithBugSubmission);
    await saveQaResult(reportWithBugSubmission, `${slugify(testInfo.title)}.json`);

    expect(runtimeAudit.responseStatus).toBe(200);
    expect(runtimeAudit.requestFailures).toEqual([]);
    expect(runtimeAudit.badResponses).toEqual([]);
    expect(unexpectedConsoleErrors).toEqual([]);

    expect(runtimeAudit.totalNavigationMs).toBeLessThan(5000);
    expect(runtimeAudit.metrics?.responseEndMs ?? Number.POSITIVE_INFINITY).toBeLessThan(1000);
    expect(runtimeAudit.metrics?.domContentLoadedMs ?? Number.POSITIVE_INFINITY).toBeLessThan(2500);
    expect(runtimeAudit.metrics?.loadEventEndMs ?? Number.POSITIVE_INFINITY).toBeLessThan(4000);

    expect(assetHealth.brokenImages).toEqual([]);
    expect(assetHealth.missingAltImages).toEqual([]);
  });

  test('meets homepage accessibility gates', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});

    const accessibilityAudit = await collectAccessibilityAudit(page);
    const assetHealth = await collectAssetHealth(page);

    const report = {
      page: 'homepage',
      accessibilityAudit,
      assetHealth,
    };

    const bugReportAttempt = await reportDetectedIssuesIfPossible({
      page,
      summary: buildAccessibilityIssueSummary(report),
    });

    const reportWithBugSubmission = {
      ...report,
      bugReportAttempt,
    };

    await attachJsonReport(testInfo, 'homepage-accessibility-audit', reportWithBugSubmission);
    await saveQaResult(reportWithBugSubmission, `${slugify(testInfo.title)}.json`);

    expect(accessibilityAudit.summary.headingCount).toBeGreaterThan(0);
    expect(accessibilityAudit.summary.h1Count).toBe(1);
    expect(accessibilityAudit.labelViolations, 'Homepage should not ship missing-label accessibility violations').toEqual([]);
    expect(accessibilityAudit.imageAltViolations, 'Homepage should not ship missing image-alt accessibility violations').toEqual([]);
    expect(assetHealth.missingAltImages, 'Visible homepage images should expose alternative text or be decorative').toEqual([]);
    expect(accessibilityAudit.criticalViolations, 'Homepage should not have critical axe violations').toEqual([]);
    expect(accessibilityAudit.seriousViolations, 'Homepage should not have serious axe violations').toEqual([]);
  });
});