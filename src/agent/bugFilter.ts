import type { Issue } from '../ai/schemas';

export interface BugCandidate {
  issue: Issue;
  route: string;
  screenshotPath: string;
  evidenceSummary: string;
  interactionContext?: string;
  networkEvidence?: { url: string; status: number }[];
  consoleEvidence?: string[];
  /** Populated during dedup — all routes where this bug was observed */
  affectedRoutes?: string[];
}

// ── Stop words removed from tokens during similarity comparison ──
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only',
  'own', 'same', 'than', 'too', 'very', 'just', 'because', 'if', 'when',
  'while', 'this', 'that', 'these', 'those', 'it', 'its', 'page', 'route',
]);

/**
 * Multi-level deduplication pipeline:
 *
 * 1. Fingerprint pass — exact-match dedup on network-error key, console-error
 *    key, or normalized title+category key. Merges routes.
 * 2. Semantic pass — Jaccard similarity on tokenised title+description.
 *    Threshold 0.40 → cluster → pick highest confidence per cluster.
 * 3. Same-category-per-route-group pass — if two bugs share the same category
 *    AND their affected-route sets overlap >50 %, keep only the higher-confidence one.
 */
export function deduplicateBugs(candidates: BugCandidate[]): BugCandidate[] {
  if (candidates.length === 0) return [];

  // ── Pass 1: Fingerprint dedup ──
  const fingerprinted = fingerprintDedup(candidates);
  console.log(`    dedup pass 1 (fingerprint): ${candidates.length} -> ${fingerprinted.length}`);

  // ── Pass 2: Semantic similarity clustering ──
  const clustered = semanticCluster(fingerprinted, 0.40);
  console.log(`    dedup pass 2 (semantic):    ${fingerprinted.length} -> ${clustered.length}`);

  // ── Pass 3: Category + route overlap merge ──
  const merged = categoryRouteMerge(clustered);
  console.log(`    dedup pass 3 (cat+route):   ${clustered.length} -> ${merged.length}`);

  return merged;
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
  const routes = candidate.affectedRoutes?.length
    ? candidate.affectedRoutes
    : [candidate.route];

  const sections = [
    `*Affected Routes (${routes.length}):*`,
    ...routes.map(r => `- ${r}`),
    '',
    `Category: ${candidate.issue.category}`,
    `Severity: ${candidate.issue.severity}`,
    `Confidence: ${(candidate.issue.confidence * 100).toFixed(0)}%`,
    '',
    'h3. Description',
    candidate.issue.description,
    '',
    'h3. Expected Behavior',
    candidate.issue.expectedBehavior,
    '',
    'h3. Actual Behavior',
    candidate.issue.actualBehavior,
    '',
    'h3. Reproduction Steps',
    ...candidate.issue.reproductionSteps.map((s, i) => `${i + 1}. ${s}`),
  ];

  if (candidate.networkEvidence?.length) {
    sections.push('', 'h3. Network Errors');
    for (const ne of candidate.networkEvidence.slice(0, 10)) {
      sections.push(`- ${ne.status} ${ne.url}`);
    }
  }

  if (candidate.consoleEvidence?.length) {
    sections.push('', 'h3. Console Errors');
    for (const ce of candidate.consoleEvidence.slice(0, 10)) {
      sections.push(`- ${ce}`);
    }
  }

  if (candidate.evidenceSummary) {
    sections.push('', 'h3. Evidence', candidate.evidenceSummary);
  }

  return sections.join('\n');
}

// ═══════════════════════════════════════════════════════
// Dedup internals
// ═══════════════════════════════════════════════════════

/**
 * Pass 1: Fingerprint-based exact dedup.
 *
 * Network errors  → key = status + URL pathname
 * Console errors  → key = first 120 chars of error text
 * Everything else → key = category + normalised title (first 80 chars alphanum)
 */
function fingerprintDedup(candidates: BugCandidate[]): BugCandidate[] {
  const buckets = new Map<string, BugCandidate>();

  for (const c of candidates) {
    const key = buildFingerprint(c);
    const existing = buckets.get(key);

    if (!existing) {
      c.affectedRoutes = [c.route];
      buckets.set(key, c);
    } else {
      // Merge: keep higher confidence, accumulate routes
      if (!existing.affectedRoutes) existing.affectedRoutes = [existing.route];
      if (!existing.affectedRoutes.includes(c.route)) {
        existing.affectedRoutes.push(c.route);
      }
      if (c.issue.confidence > existing.issue.confidence) {
        const routes = existing.affectedRoutes;
        c.affectedRoutes = routes;
        if (!c.affectedRoutes.includes(c.route)) c.affectedRoutes.push(c.route);
        buckets.set(key, c);
      }
    }
  }

  return Array.from(buckets.values());
}

function buildFingerprint(c: BugCandidate): string {
  // Network-error bugs: group by status+pathname
  if (c.networkEvidence?.length && c.issue.category === 'functional') {
    const primary = c.networkEvidence[0];
    try {
      const pathname = new URL(primary.url).pathname;
      return `net:${primary.status}:${pathname}`;
    } catch { /* ignore bad URLs */ }
  }

  // Console-error bugs: group by first error text
  if (c.consoleEvidence?.length && c.issue.title.toLowerCase().includes('console')) {
    const normalized = c.consoleEvidence[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 120);
    return `console:${normalized}`;
  }

  // General: category + normalised title
  const normTitle = c.issue.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
  return `${c.issue.category}:${normTitle}`;
}

/**
 * Pass 2: Semantic similarity clustering via Jaccard index on word tokens.
 */
function semanticCluster(candidates: BugCandidate[], threshold: number): BugCandidate[] {
  const tokenSets = candidates.map(c => tokenize(c.issue.title + ' ' + c.issue.description));

  // Union-Find for clustering
  const parent = candidates.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // O(n^2) pairwise comparison — fine for a few hundred candidates
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      // Only cluster within the same category
      if (candidates[i].issue.category !== candidates[j].issue.category) continue;
      if (jaccard(tokenSets[i], tokenSets[j]) >= threshold) {
        union(i, j);
      }
    }
  }

  // Group by cluster root
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  }

  // Pick best representative from each cluster, merge routes
  const result: BugCandidate[] = [];
  for (const members of clusters.values()) {
    // Sort by confidence desc, then severity weight desc
    members.sort((a, b) => {
      const ca = candidates[a], cb = candidates[b];
      const confDiff = cb.issue.confidence - ca.issue.confidence;
      if (Math.abs(confDiff) > 0.05) return confDiff;
      return severityWeight(cb.issue.severity) - severityWeight(ca.issue.severity);
    });

    const best = { ...candidates[members[0]] };
    const allRoutes = new Set(best.affectedRoutes || [best.route]);
    for (const idx of members) {
      const c = candidates[idx];
      for (const r of (c.affectedRoutes || [c.route])) allRoutes.add(r);
    }
    best.affectedRoutes = Array.from(allRoutes);

    // Boost confidence slightly if observed across many routes (real bug signal)
    if (allRoutes.size >= 3) {
      best.issue = { ...best.issue, confidence: Math.min(1, best.issue.confidence + 0.05) };
    }

    result.push(best);
  }

  return result;
}

/**
 * Pass 3: If two surviving bugs share the same category and >50% route overlap,
 * keep only the higher-severity/confidence one.
 */
function categoryRouteMerge(candidates: BugCandidate[]): BugCandidate[] {
  const removed = new Set<number>();

  for (let i = 0; i < candidates.length; i++) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (removed.has(j)) continue;
      if (candidates[i].issue.category !== candidates[j].issue.category) continue;

      const routesA = new Set(candidates[i].affectedRoutes || [candidates[i].route]);
      const routesB = new Set(candidates[j].affectedRoutes || [candidates[j].route]);
      const overlap = [...routesA].filter(r => routesB.has(r)).length;
      const smaller = Math.min(routesA.size, routesB.size);
      if (smaller === 0) continue;

      if (overlap / smaller > 0.5) {
        // Titles must also be somewhat similar
        const simScore = jaccard(
          tokenize(candidates[i].issue.title),
          tokenize(candidates[j].issue.title),
        );
        if (simScore < 0.25) continue; // Genuinely different bugs in same category

        // Keep the better one, merge routes
        const [keep, drop] = rankPair(candidates, i, j);
        const dropRoutes = candidates[drop].affectedRoutes || [candidates[drop].route];
        const keepRoutes = new Set(candidates[keep].affectedRoutes || [candidates[keep].route]);
        for (const r of dropRoutes) keepRoutes.add(r);
        candidates[keep].affectedRoutes = Array.from(keepRoutes);
        removed.add(drop);
      }
    }
  }

  return candidates.filter((_, i) => !removed.has(i));
}

// ═══════════════════════════════════════════════════════
// Utility helpers
// ═══════════════════════════════════════════════════════

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  return new Set(words.filter(w => w.length > 2 && !STOP_WORDS.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  const unionSize = a.size + b.size - intersection;
  return unionSize === 0 ? 0 : intersection / unionSize;
}

function severityWeight(s: string): number {
  switch (s) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

function rankPair(candidates: BugCandidate[], i: number, j: number): [number, number] {
  const ci = candidates[i], cj = candidates[j];
  const scoreDiff = (cj.issue.confidence + severityWeight(cj.issue.severity) / 4)
    - (ci.issue.confidence + severityWeight(ci.issue.severity) / 4);
  return scoreDiff > 0 ? [j, i] : [i, j];
}
