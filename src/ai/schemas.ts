import { z } from 'zod';

export const IssueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.enum([
    'ui',
    'ux',
    'functional',
    'content',
    'accessibility',
    'performance',
    'navigation',
    'consistency',
    'other',
  ]),
  title: z.string().min(3),
  description: z.string().min(10),
  expectedBehavior: z.string().min(3),
  actualBehavior: z.string().min(3),
  reproductionSteps: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
});

export const JudgeResponseSchema = z.object({
  pageSummary: z.string(),
  issues: z.array(IssueSchema),
  nextActions: z.array(z.string()).default([]),
});

export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;
export type Issue = z.infer<typeof IssueSchema>;