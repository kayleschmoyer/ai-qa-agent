import type { Issue } from '../ai/schemas';

export interface BugCandidate {
  issue: Issue;
  route: string;
  screenshotPath: string;
  evidenceSummary: string;
  interactionContext?: string;
  networkEvidence?: { url: string; status: number }[];
  consoleEvidence?: string[];
}

/**
 * Deduplicate bug candidates by comparing titles and descriptions.
 */
export function deduplicateBugs(candidates: BugCandidate[]): BugCandidate[] {
  const seen = new Map<string, BugCandidate>();

  for (const candidate of candidates) {
    const key = normalizeForDedup(candidate.issue.title);

    if (!seen.has(key)) {
      seen.set(key, candidate);
    } else {
      // Keep the higher-confidence one
      const existing = seen.get(key)!;
      if (candidate.issue.confidence > existing.issue.confidence) {
        seen.set(key, candidate);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Filter candidates that meet the filing threshold.
 */
export function filterFilable(candidates: BugCandidate[], minConfidence = 0.6): BugCandidate[] {
  return candidates.filter(c => c.issue.confidence >= minConfidence);
}

/**
 * Build a Jira description from a BugCandidate.
 */
export function buildJiraDescription(candidate: BugCandidate): string {
  const sections = [
    `Route: ${candidate.route}`,
    `Category: ${candidate.issue.category}`,
    `Severity: ${candidate.issue.severity}`,
    `Confidence: ${(candidate.issue.confidence * 100).toFixed(0)}%`,
    '',
    'Description:',
    candidate.issue.description,
    '',
    'Expected Behavior:',
    candidate.issue.expectedBehavior,
    '',
    'Actual Behavior:',
    candidate.issue.actualBehavior,
    '',
    'Reproduction Steps:',
    ...candidate.issue.reproductionSteps.map((s, i) => `${i + 1}. ${s}`),
  ];

  if (candidate.networkEvidence?.length) {
    sections.push('', 'Network Errors:');
    for (const ne of candidate.networkEvidence.slice(0, 10)) {
      sections.push(`- ${ne.status} ${ne.url}`);
    }
  }

  if (candidate.consoleEvidence?.length) {
    sections.push('', 'Console Errors:');
    for (const ce of candidate.consoleEvidence.slice(0, 10)) {
      sections.push(`- ${ce}`);
    }
  }

  if (candidate.evidenceSummary) {
    sections.push('', 'Evidence:', candidate.evidenceSummary);
  }

  return sections.join('\n');
}

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
}
