import OpenAI from 'openai';
import { JudgeResponseSchema, type JudgeResponse } from './schemas';
import fs from 'node:fs/promises';

type JudgeInput = {
  stepName: string;
  snapshot: unknown;
  screenshotPath?: string;
  errors?: string[];
};

type Provider = 'openai' | 'anthropic' | 'xai' | 'openrouter' | 'openai-compatible';

function requiredEnv(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getProvider(): Provider {
  const raw = (process.env.QA_AI_PROVIDER || 'openai').trim().toLowerCase();

  switch (raw) {
    case 'openai':
    case 'anthropic':
    case 'xai':
    case 'openrouter':
    case 'openai-compatible':
      return raw;
    default:
      throw new Error(
        `Unsupported QA_AI_PROVIDER "${raw}". Supported values: openai, anthropic, xai, openrouter, openai-compatible.`
      );
  }
}

function getModel(provider: Provider): string {
  if (process.env.QA_MODEL?.trim()) {
    return process.env.QA_MODEL;
  }

  switch (provider) {
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'xai':
      return 'grok-3-mini';
    case 'openrouter':
      return 'meta-llama/llama-3.3-70b-instruct';
    case 'openai-compatible':
      return 'gpt-4o-mini';
    case 'openai':
    default:
      return 'gpt-4o-mini';
  }
}

function buildInstruction(input: JudgeInput): string {
  return (
    `You are a senior software QA analyst. ` +
    `Review the provided browser state and identify real product issues. ` +
    `Be conservative. Do not invent bugs. ` +
    `Only report issues that are reasonably supported by the evidence. ` +
    `Return valid JSON matching this shape:\n\n` +
    `{\n` +
    `  "pageSummary": string,\n` +
    `  "issues": [\n` +
    `    {\n` +
    `      "severity": "low" | "medium" | "high" | "critical",\n` +
    `      "category": "ui" | "ux" | "functional" | "content" | "accessibility" | "performance" | "navigation" | "consistency" | "other",\n` +
    `      "title": string,\n` +
    `      "description": string,\n` +
    `      "expectedBehavior": string,\n` +
    `      "actualBehavior": string,\n` +
    `      "reproductionSteps": string[],\n` +
    `      "confidence": number\n` +
    `    }\n` +
    `  ],\n` +
    `  "nextActions": string[]\n` +
    `}\n\n` +
    `Current step: ${input.stepName}\n` +
    `Playwright errors: ${JSON.stringify(input.errors || [])}\n` +
    `Snapshot JSON:\n${JSON.stringify(input.snapshot, null, 2)}`
  );
}

function extractJsonBlock(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || raw).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }

    throw new Error('Model response did not contain valid JSON.');
  }
}

  function normalizeConfidence(value: unknown): number {
    const numeric = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : NaN;

    if (!Number.isFinite(numeric)) {
      return 0.5;
    }

    if (numeric > 1 && numeric <= 100) {
      return numeric / 100;
    }

    if (numeric < 0) {
      return 0;
    }

    if (numeric > 1) {
      return 1;
    }

    return numeric;
  }

  function normalizeJudgeResponse(parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') {
      return parsed;
    }

    const asRecord = parsed as Record<string, unknown>;
    const issues = Array.isArray(asRecord.issues) ? asRecord.issues : [];

    return {
      ...asRecord,
      issues: issues.map((issue) => {
        if (!issue || typeof issue !== 'object') {
          return issue;
        }

        const issueRecord = issue as Record<string, unknown>;

        return {
          ...issueRecord,
          confidence: normalizeConfidence(issueRecord.confidence),
        };
      }),
    };
  }

async function judgeWithOpenAiCompatible(input: JudgeInput, model: string, config: {
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  useChatCompletions?: boolean;
}): Promise<JudgeResponse> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
  });

  const runRequest = async (includeImage: boolean): Promise<JudgeResponse> => {
    if (config.useChatCompletions) {
      const content: any[] = [
        {
          type: 'text',
          text: buildInstruction(input),
        },
      ];

      if (includeImage && input.screenshotPath) {
        const imageBytes = await fs.readFile(input.screenshotPath);
        const base64 = imageBytes.toString('base64');

        content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64}`,
          },
        });
      }

      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      });

      const raw = response.choices[0]?.message?.content || '';
      const parsed = extractJsonBlock(raw);
      return JudgeResponseSchema.parse(normalizeJudgeResponse(parsed));
    }

    const content: any[] = [
      {
        type: 'input_text',
        text: buildInstruction(input),
      },
    ];

    if (includeImage && input.screenshotPath) {
      const imageBytes = await fs.readFile(input.screenshotPath);
      const base64 = imageBytes.toString('base64');

      content.push({
        type: 'input_image',
        image_url: `data:image/png;base64,${base64}`,
      });
    }

    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content,
        },
      ],
    });

    const parsed = extractJsonBlock(response.output_text || '');
    return JudgeResponseSchema.parse(normalizeJudgeResponse(parsed));
  };

  try {
    return await runRequest(true);
  } catch (error) {
    if (input.screenshotPath && isImageUnsupportedError(error)) {
      return runRequest(false);
    }

    throw error;
  }
}

async function judgeWithAnthropic(input: JudgeInput, model: string): Promise<JudgeResponse> {
  const apiKey = requiredEnv('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY);

  const runRequest = async (includeImage: boolean): Promise<JudgeResponse> => {
    const content: Array<
      | { type: 'text'; text: string }
      | {
        type: 'image';
        source: {
          type: 'base64';
          media_type: 'image/png';
          data: string;
        };
      }
    > = [
      {
        type: 'text',
        text: buildInstruction(input),
      },
    ];

    if (includeImage && input.screenshotPath) {
      const imageBytes = await fs.readFile(input.screenshotPath);
      const base64 = imageBytes.toString('base64');

      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: base64,
        },
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic request failed (${response.status}): ${body}`);
    }

    const body = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
    };
    const raw = (body.content || [])
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');

    const parsed = extractJsonBlock(raw);
    return JudgeResponseSchema.parse(normalizeJudgeResponse(parsed));
  };

  try {
    return await runRequest(true);
  } catch (error) {
    if (input.screenshotPath && isImageUnsupportedError(error)) {
      return runRequest(false);
    }

    throw error;
  }
}

export async function judgePage(input: JudgeInput): Promise<JudgeResponse> {
  const provider = getProvider();
  const model = getModel(provider);

  if (provider === 'anthropic') {
    return judgeWithAnthropic(input, model);
  }

  if (provider === 'xai') {
    return judgeWithOpenAiCompatible(input, model, {
      apiKey: requiredEnv('XAI_API_KEY', process.env.XAI_API_KEY),
      baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
      useChatCompletions: true,
    });
  }

  if (provider === 'openrouter') {
    return judgeWithOpenAiCompatible(input, model, {
      apiKey: requiredEnv('OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY),
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://localhost',
        'X-Title': process.env.OPENROUTER_APP_TITLE || 'ai-qa-agent',
      },
      useChatCompletions: true,
    });
  }

  if (provider === 'openai-compatible') {
    return judgeWithOpenAiCompatible(input, model, {
      apiKey: requiredEnv('QA_OPENAI_COMPAT_API_KEY', process.env.QA_OPENAI_COMPAT_API_KEY),
      baseURL: requiredEnv('QA_OPENAI_COMPAT_BASE_URL', process.env.QA_OPENAI_COMPAT_BASE_URL),
      useChatCompletions: true,
    });
  }

  return judgeWithOpenAiCompatible(input, model, {
    apiKey: requiredEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY),
    baseURL: process.env.OPENAI_BASE_URL,
  });
}

function isImageUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  return [
    'image input',
    'image_url',
    'vision',
    'multimodal',
    'does not support image',
    'no endpoints found that support image',
    'invalid content type',
    'unsupported content',
  ].some((token) => normalized.includes(token));
}