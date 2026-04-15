/**
 * Autonomous QA Agent
 *
 * This is the main entry point. It:
 * 1. Crawls every discoverable route
 * 2. On each route, captures full page state + screenshot
 * 3. Discovers and exercises interactive elements
 * 4. Sends page state + screenshot to AI vision for defect analysis
 * 5. Deduplicates and filters findings
 * 6. Files high-confidence bugs directly to Jira
 *
 * Run:  npx tsx src/agent/run.ts [--dry-run] [--routes /path1,/path2]
 */
import 'dotenv/config';

import { chromium, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { discoverRoutes, capturePageState, type RouteInfo } from './crawler';
import { discoverInteractiveElements, executeInteraction, type InteractionResult } from './interactor';
import { deduplicateBugs, filterFilable, buildJiraDescription, type BugCandidate } from './bugFilter';
import { judgePage } from '../ai/judge';
import type { JudgeResponse, Issue } from '../ai/schemas';
import { getJiraConfig, createJiraIssue, searchJiraIssues } from '../utils/jira';

// ── Config ──────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || 'https://legacy-fantasy.com';
const STORAGE_STATE = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
const OUT_DIR = path.join(process.cwd(), 'qa-results', 'agent-run');
const MAX_ROUTES = parseInt(process.env.QA_MAX_ROUTES || '30', 10);
const MAX_INTERACTIONS_PER_ROUTE = parseInt(process.env.QA_MAX_INTERACTIONS || '15', 10);
const MIN_CONFIDENCE = parseFloat(process.env.QA_MIN_CONFIDENCE || '0.6');
const DRY_RUN = process.argv.includes('--dry-run');
const MANUAL_ROUTES = parseManualRoutes();

// Known app routes to seed the crawler (SPA link discovery misses these)
const SEED_ROUTES = [
  '/',
  '/baseball',
  '/baseball/league/create',
  '/baseball/league/join',
  '/baseball/mock-draft',
  '/games/season-draft',
  '/games/season-draft/create',
  '/players',
  '/players/stats',
  '/players/compare',
  '/profile/settings',
  '/help',
  '/pricing',
  '/faq',
  '/scoreboard',
  '/about',
];

interface AgentRun {
  startedAt: string;
  completedAt: string;
  routesVisited: number;
  interactionsExecuted: number;
  aiAnalysesMade: number;
  bugsFound: number;
  bugsFiled: number;
  bugs: FiledBug[];
  errors: string[];
}

interface FiledBug {
  jiraKey: string | null;
  summary: string;
  severity: string;
  category: string;
  confidence: number;
  route: string;
  screenshotPath: string;
}

// ── Main ────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════');
  console.log('   AUTONOMOUS QA AGENT — STARTING RUN');
  console.log('═══════════════════════════════════════════\n');
  console.log(`  Target:        ${BASE_URL}`);
  console.log(`  Max routes:    ${MAX_ROUTES}`);
  console.log(`  Max interact:  ${MAX_INTERACTIONS_PER_ROUTE}/route`);
  console.log(`  Min confidence:${MIN_CONFIDENCE}`);
  console.log(`  Dry run:       ${DRY_RUN}`);
  console.log(`  Output:        ${OUT_DIR}\n`);

  const run: AgentRun = {
    startedAt: new Date().toISOString(),
    completedAt: '',
    routesVisited: 0,
    interactionsExecuted: 0,
    aiAnalysesMade: 0,
    bugsFound: 0,
    bugsFiled: 0,
    bugs: [],
    errors: [],
  };

  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  let context: BrowserContext;

  try {
    await fs.access(STORAGE_STATE);
    context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE,
      viewport: { width: 1440, height: 900 },
    });
  } catch {
    context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
    });
  }

  const page = await context.newPage();
  const allCandidates: BugCandidate[] = [];
  const allFiled: BugCandidate[] = [];

  // Track summaries already filed in THIS run to avoid intra-run dupes
  const filedSummaries = new Set<string>();
  const jiraConfig = getJiraConfig();
  let skippedJiraDupes = 0;

  try {
    // ═══ Phase 1: Discover routes ═══
    console.log('\n── Phase 1: Route Discovery ──');
    let routes: RouteInfo[];

    if (MANUAL_ROUTES.length > 0) {
      routes = MANUAL_ROUTES.map(r => ({ url: r, depth: 0, source: 'manual' as const }));
      console.log(`  Using ${routes.length} manual routes`);
    } else {
      // Start with seed routes + anything discovered via link crawl
      const discovered = await discoverRoutes(page, BASE_URL, 2);
      const seeded: RouteInfo[] = SEED_ROUTES.map(r => ({ url: r, depth: 0, source: 'manual' as const }));
      const seen = new Set(seeded.map(r => r.url.replace(/\/$/, '') || '/'));
      for (const d of discovered) {
        const norm = d.url.replace(/\/$/, '') || '/';
        if (!seen.has(norm)) {
          seeded.push(d);
          seen.add(norm);
        }
      }
      routes = seeded;
      console.log(`  Seeded ${SEED_ROUTES.length} known routes + discovered ${discovered.length} via crawl = ${routes.length} total`);
    }

    routes = routes.slice(0, MAX_ROUTES);

    // ═══ Phase 2: Crawl + Analyze each route ═══
    console.log('\n── Phase 2: Route Crawl + AI Analysis ──');
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const routeLabel = `route_${i}_${sanitize(route.url)}`;
      const routeScreenDir = path.join(OUT_DIR, routeLabel);

      console.log(`\n  [${i + 1}/${routes.length}] ${route.url}`);

      try {
        // Navigate
        const badResponses: { url: string; status: number }[] = [];
        const consoleErrors: string[] = [];

        const onResp = (r: any) => {
          if (r.status() >= 400) badResponses.push({ url: r.url(), status: r.status() });
        };
        const onConsole = (m: any) => {
          if (m.type() === 'error') consoleErrors.push(m.text());
        };

        page.on('response', onResp);
        page.on('console', onConsole);

        await page.goto(route.url, { waitUntil: 'load', timeout: 20000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);

        // Capture full page state
        const pageState = await capturePageState(page, routeScreenDir, 'page');
        pageState.badResponses = badResponses;
        pageState.consoleErrors = consoleErrors;

        run.routesVisited++;

        // Save raw data
        await fs.writeFile(
          path.join(routeScreenDir, 'pageState.json'),
          JSON.stringify(pageState, null, 2),
        );

        // AI analysis of current page
        const aiResult = await analyzeWithAI(route.url, pageState, routeLabel);
        run.aiAnalysesMade++;

        if (aiResult) {
          for (const issue of aiResult.issues) {
            allCandidates.push({
              issue,
              route: route.url,
              screenshotPath: pageState.screenshotPath,
              evidenceSummary: `Page title: ${pageState.title}. Headings: ${pageState.headings.join(', ')}`,
              networkEvidence: badResponses,
              consoleEvidence: consoleErrors.slice(0, 10),
            });
          }
          console.log(`    AI found ${aiResult.issues.length} potential issues`);
        }

        // ═══ Phase 3: Interact with elements on this route ═══
        const targets = await discoverInteractiveElements(page);
        const targetCount = Math.min(targets.length, MAX_INTERACTIONS_PER_ROUTE);
        console.log(`    Found ${targets.length} interactive elements, testing ${targetCount}`);

        for (let j = 0; j < targetCount; j++) {
          const target = targets[j];

          try {
            // Navigate back to the route before each interaction
            await page.goto(route.url, { waitUntil: 'load', timeout: 15000 });
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(500);

            const result = await executeInteraction(page, target, routeScreenDir, j);
            run.interactionsExecuted++;

            // Save interaction result
            await fs.writeFile(
              path.join(routeScreenDir, `interaction_${j}.json`),
              JSON.stringify(result, null, 2),
            );

            // Only analyze interactions that produced meaningful errors
            const hasServerError = result.networkErrors.some(e => e.status >= 500);
            const hasClientError = result.networkErrors.some(e => e.status >= 400 && e.status < 500
              && !e.url.includes('/oauth/refresh-jwt'));  // Ignore known auth refresh noise
            const hasConsoleError = result.consoleErrors.some(e => !/favicon|third-party|analytics/i.test(e));
            const hasVisibleError = result.after.bodyExcerpt.match(
              /error|failed|something went wrong|500 internal|not found|crash/i,
            );
            const hasErrors = result.error !== null
              || hasServerError
              || hasConsoleError
              || hasVisibleError
              || (hasClientError && result.networkErrors.filter(e => e.status >= 400).length >= 3);

            if (hasErrors) {
              const interactionAI = await analyzeInteraction(route.url, target.label, result);
              run.aiAnalysesMade++;

              if (interactionAI) {
                for (const issue of interactionAI.issues) {
                  allCandidates.push({
                    issue,
                    route: route.url,
                    screenshotPath: result.screenshotPath,
                    evidenceSummary: `Interaction: ${target.type} "${target.label}". Error: ${result.error || 'none'}`,
                    interactionContext: `Clicked/submitted: ${target.label}`,
                    networkEvidence: result.networkErrors,
                    consoleEvidence: result.consoleErrors.slice(0, 10),
                  });
                }
                console.log(`    → Interaction "${target.label.slice(0, 40)}" — AI found ${interactionAI.issues.length} issues`);
              }
            }
          } catch (err) {
            run.errors.push(`Interaction ${j} on ${route.url}: ${String(err).slice(0, 200)}`);
          }
        }

        page.off('response', onResp);
        page.off('console', onConsole);

        // ── File bugs for this route immediately ──
        const routeCandidates = allCandidates.filter(c => c.route === route.url);
        if (routeCandidates.length > 0) {
          const deduped = deduplicateBugs(routeCandidates);
          const filable = filterFilable(deduped, MIN_CONFIDENCE);

          for (const candidate of filable) {
            // Skip if we already filed something with the same title this run
            const normTitle = candidate.issue.title.toLowerCase().trim();
            if (filedSummaries.has(normTitle)) continue;

            const filed: FiledBug = {
              jiraKey: null,
              summary: candidate.issue.title,
              severity: candidate.issue.severity,
              category: candidate.issue.category,
              confidence: candidate.issue.confidence,
              route: candidate.route,
              screenshotPath: candidate.screenshotPath,
            };

            if (!DRY_RUN && jiraConfig) {
              try {
                const existingKeys = await searchJiraIssues(jiraConfig, candidate.issue.title);
                if (existingKeys.length > 0) {
                  skippedJiraDupes++;
                  console.log(`    ~ Skipped (exists as ${existingKeys[0]}): ${candidate.issue.title.slice(0, 55)}`);
                  filed.jiraKey = existingKeys[0];
                  filedSummaries.add(normTitle);
                  run.bugs.push(filed);
                  continue;
                }

                const response = await createJiraIssue(jiraConfig, {
                  summary: candidate.issue.title,
                  description: buildJiraDescription(candidate),
                });
                const body = await response.json().catch(() => null) as any;

                if (response.ok && body?.key) {
                  filed.jiraKey = body.key;
                  run.bugsFiled++;
                  filedSummaries.add(normTitle);
                  console.log(`    ✓ Filed ${body.key}: ${candidate.issue.title.slice(0, 65)}`);
                } else {
                  console.log(`    ✗ Jira error: ${response.status} — ${candidate.issue.title.slice(0, 50)}`);
                  run.errors.push(`Jira create failed: ${response.status} — ${JSON.stringify(body).slice(0, 200)}`);
                }
              } catch (err) {
                run.errors.push(`Jira error: ${String(err).slice(0, 200)}`);
              }
            } else {
              console.log(`    [dry-run] Would file: ${candidate.issue.title.slice(0, 65)}`);
              filedSummaries.add(normTitle);
            }

            run.bugs.push(filed);
            allFiled.push(candidate);
          }

          run.bugsFound = run.bugs.length;
        }
      } catch (err) {
        console.log(`    ✗ Error: ${String(err).slice(0, 100)}`);
        run.errors.push(`Route ${route.url}: ${String(err).slice(0, 200)}`);
      }
    }

    // ── Summary ──
    console.log(`\n── Filing Summary ──`);
    console.log(`  Total raw candidates: ${allCandidates.length}`);
    console.log(`  Bugs filed to Jira:   ${run.bugsFiled}`);
    console.log(`  Skipped (in Jira):    ${skippedJiraDupes}`);
    console.log(`  Skipped (intra-run):  ${allCandidates.length - run.bugs.length - skippedJiraDupes}`);
  } finally {
    await context.close();
    await browser.close();
  }

  // ═══ Phase 5: Report ═══
  run.completedAt = new Date().toISOString();

  const reportPath = path.join(OUT_DIR, 'run-report.json');
  await fs.writeFile(reportPath, JSON.stringify(run, null, 2));

  console.log('\n═══════════════════════════════════════════');
  console.log('   QA AGENT RUN COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Routes visited:       ${run.routesVisited}`);
  console.log(`  Interactions tested:  ${run.interactionsExecuted}`);
  console.log(`  AI analyses:          ${run.aiAnalysesMade}`);
  console.log(`  Bugs found:           ${run.bugsFound}`);
  console.log(`  Bugs filed to Jira:   ${run.bugsFiled}`);
  console.log(`  Errors:               ${run.errors.length}`);
  console.log(`  Report:               ${reportPath}`);
  console.log('═══════════════════════════════════════════\n');

  // Write all candidates to a separate file for review
  const candidatesPath = path.join(OUT_DIR, 'all-candidates.json');
  await fs.writeFile(candidatesPath, JSON.stringify(allFiled.map((c: BugCandidate) => ({
    title: c.issue.title,
    severity: c.issue.severity,
    category: c.issue.category,
    confidence: c.issue.confidence,
    route: c.route,
    affectedRoutes: c.affectedRoutes || [c.route],
  })), null, 2));
}

// ── AI Helpers ──────────────────────────────────────
async function analyzeWithAI(route: string, pageState: any, label: string): Promise<JudgeResponse | null> {
  try {
    return await judgePage({
      stepName: `Route audit: ${route}`,
      snapshot: {
        url: route,
        title: pageState.title,
        headings: pageState.headings,
        bodyExcerpt: pageState.bodyExcerpt.slice(0, 4000),
        buttons: pageState.buttons,
        forms: pageState.forms,
        images: pageState.images.filter((img: any) => !img.alt || img.naturalWidth === 0),
        accessibilityIssues: pageState.accessibilityTree,
        networkErrors: pageState.badResponses,
        consoleErrors: pageState.consoleErrors,
      },
      screenshotPath: pageState.screenshotPath,
      errors: pageState.consoleErrors,
    });
  } catch (err) {
    console.log(`    AI analysis error: ${String(err).slice(0, 100)}`);
    return null;
  }
}

async function analyzeInteraction(route: string, targetLabel: string, result: InteractionResult): Promise<JudgeResponse | null> {
  try {
    return await judgePage({
      stepName: `Interaction on ${route}: ${targetLabel}`,
      snapshot: {
        action: result.action,
        target: result.target,
        before: result.before,
        after: result.after,
        error: result.error,
        networkErrors: result.networkErrors,
        consoleErrors: result.consoleErrors,
        durationMs: result.durationMs,
      },
      screenshotPath: result.screenshotPath,
      errors: result.consoleErrors,
    });
  } catch (err) {
    console.log(`    AI interaction analysis error: ${String(err).slice(0, 100)}`);
    return null;
  }
}

// ── Utilities ───────────────────────────────────────
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 50);
}

function parseManualRoutes(): string[] {
  const arg = process.argv.find(a => a.startsWith('--routes'));
  if (!arg) return [];
  const idx = process.argv.indexOf(arg);
  const val = arg.includes('=') ? arg.split('=')[1] : process.argv[idx + 1];
  return val ? val.split(',').map(r => r.trim()).filter(Boolean) : [];
}

// ── Entry Point ─────────────────────────────────────
main().catch(err => {
  console.error('Agent fatal error:', err);
  process.exit(1);
});
