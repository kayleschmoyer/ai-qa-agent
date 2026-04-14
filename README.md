# 🤖 AI QA Agent

An automated quality assurance tool that **opens your website in a real browser, takes screenshots, and asks an AI to find bugs** — then files those bugs for you automatically.

It combines [Playwright](https://playwright.dev/) (a browser automation framework) with AI models like ChatGPT, Claude, or Grok to do the work a manual QA tester would do: look at the page, poke around, and report what looks broken.

---

## What does it actually do?

| Test | What it checks |
|------|---------------|
| **Smoke + AI Review** | Opens the homepage, clicks around, takes a screenshot, and asks an AI "what's wrong here?" |
| **Homepage Functional** | Checks that all the expected text, buttons, and headings are visible and working |
| **Homepage Audit** | Checks performance (page load speed), broken images, console errors, and accessibility |
| **Bug Reporter** | If bugs are found, automatically fills out and submits the in-app bug report form |
| **Jira Integration** | Optionally creates a real Jira ticket for every bug the AI finds |

---

## Before you start — what you need

You need these installed on your computer:

1. **Node.js** (v18 or higher) — download at [nodejs.org](https://nodejs.org)
2. **An AI API key** — at least one of:
   - [OpenAI](https://platform.openai.com/api-keys) (ChatGPT) ← easiest to get started
   - [Anthropic](https://console.anthropic.com/) (Claude)
   - [xAI](https://console.x.ai/) (Grok)
   - [OpenRouter](https://openrouter.ai/keys) (access to many models via one key)
3. **The URL of the website you want to test**

---

## Setup (do this once)

### Step 1 — Install dependencies

Open a terminal in this folder and run:

```bash
npm install
```

Then install the browsers Playwright needs:

```bash
npx playwright install chromium chrome
```

### Step 2 — Create your config file

Copy the example config:

```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Open the new `.env` file in any text editor and fill in the blanks:

```env
# The website you want to test (required)
BASE_URL=https://your-website.com

# Which AI provider to use
QA_AI_PROVIDER=openai

# Which model to use (leave blank to use the default)
QA_MODEL=gpt-4o-mini

# Paste your API key here
OPENAI_API_KEY=sk-...your-key-here...
```

> 💡 **Only fill in the key for the provider you chose.** You don't need all of them.

---

## Running the tests

### Run everything (recommended first try)

```bash
npm test
```

This runs all tests and saves an HTML report. When done, open the report:

```bash
npm run report
```

---

### Run specific test suites

**Smoke test with AI page review** — opens the site, clicks around, asks AI what's wrong:
```bash
npx playwright test tests/smoke.spec.ts
```

**Full homepage check** — tests buttons, headings, copy, and Google auth popup:
```bash
npx playwright test tests/homepage.spec.ts
```

**Authenticated runs** — by default, Playwright now starts as the app repo's admin test user with a signed JWT and prebuilt browser auth state, so normal test runs require no manual login. If you explicitly need live device flow instead, run with `E2E_AUTH_MODE=device`.

**Performance + accessibility audit** — checks load speed, broken images, and axe accessibility rules:
```bash
npx playwright test tests/homepage.audit.spec.ts
```

**Homepage bundle** (smoke + functional + audit together):
```bash
npm run test:homepage:audit
```

**Watch it run in a real browser window:**
```bash
npm run test:headed
```

**Switch to live device flow only when needed:**
```bash
# Windows PowerShell
$env:E2E_AUTH_MODE='device'; npx playwright test tests/smoke.spec.ts
```

**Step through tests one at a time (debugging mode):**
```bash
npm run test:debug
```

---

### Test every AI provider at once (provider matrix)

If you have multiple API keys, this runs the smoke and Jira tests against each provider and prints a summary table:

```bash
npm run test:provider:matrix
```

It automatically skips any provider whose API key is missing from `.env`.

---

## Optional features

### Auto bug reporting

If your app has a bug-report button, the agent can click it and submit bugs automatically after finding them.

Set this in `.env`:
```env
REPORT_BUGS_ON_FAILURE=true
```

You can also tell it where the button and form are (uses CSS selectors):
```env
BUG_REPORT_TRIGGER_SELECTOR=#report-bug-button
BUG_REPORT_TEXTAREA_SELECTOR=textarea
BUG_REPORT_SUBMIT_SELECTOR=button[type=submit]
```

### Jira integration

Create real Jira tickets for bugs automatically. Add these to `.env`:

```env
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=you@your-company.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_PROJECT_KEY=PROJ
```

Get a Jira API token at: [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

Test the Jira connection:
```bash
npm run test:jira:api
```

---

## Where to find results

| Location | What's in there |
|----------|----------------|
| `qa-results/` | JSON files with AI bug reports for each test run |
| `playwright-report/` | Full HTML test report with screenshots and AI analysis attached |
| `test-results/` | Raw Playwright output, screenshots on failure, and video recordings |

---

## Supported AI providers

| Provider | Set `QA_AI_PROVIDER=` | Default model | Key env var |
|----------|-----------------------|---------------|-------------|
| OpenAI (ChatGPT) | `openai` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| Anthropic (Claude) | `anthropic` | `claude-3-5-sonnet-latest` | `ANTHROPIC_API_KEY` |
| xAI (Grok) | `xai` | `grok-3-mini` | `XAI_API_KEY` |
| OpenRouter | `openrouter` | `meta-llama/llama-3.3-70b-instruct` | `OPENROUTER_API_KEY` |
| Custom endpoint | `openai-compatible` | `gpt-4o-mini` | `QA_OPENAI_COMPAT_API_KEY` |

Override the model anytime by setting `QA_MODEL=model-name-here` in `.env`.

---

## Troubleshooting

**"Missing required environment variable"**
→ Open `.env` and make sure your API key is filled in and `QA_AI_PROVIDER` matches the key you provided.

**"Browser not found" or Playwright errors**
→ Run `npx playwright install chromium chrome` to download the browsers.

**Tests time out**
→ Your `BASE_URL` might be wrong or the site might be down. Double-check the URL in `.env`.

**AI returns weird results**
→ Try a more capable model — change `QA_MODEL=gpt-4o` in `.env` for better analysis.
