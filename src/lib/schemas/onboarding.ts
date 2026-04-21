import { z } from "zod";

export const OnboardingRecommendationSchema = z.object({
  existingProjectCandidates: z
    .array(
      z.object({
        projectId: z.string().default(""),
        suggestedRole: z.enum(["owner", "assignee"]),
        rationale: z.string().max(500),
        fitScore: z.number().int().min(0).max(5),
        introContextQuotes: z.array(z.string()).default([]),
      })
    )
    .length(2),
  newProjectProposal: z.object({
    suggestedCompanyId: z.string(),
    suggestedGoalId: z.string().default(""),
    suggestedName: z.string().min(1),
    suggestedDefinitionOfDone: z.string().default(""),
    rationale: z.string().max(500),
  }),
  overallConfidence: z.number().int().min(1).max(5),
  dmContextSummary: z.string().default(""),
});

export type OnboardingRecommendation = z.infer<
  typeof OnboardingRecommendationSchema
>;

export const WelcomeDetectionSchema = z.object({
  isWelcome: z.boolean(),
  role: z.string().default(""),
  roleConfidence: z.number().min(0).max(1).optional().default(0.85),
});

export type WelcomeDetection = z.infer<typeof WelcomeDetectionSchema>;

/**
 * AI-suggested teammates to pair with a new hire for accountability and oversight.
 * Strict 1-2 candidates so the resulting group DM stays small.
 */
export const BuddyRecommendationSchema = z.object({
  candidates: z
    .array(
      z.object({
        personId: z.string().min(1),
        rationale: z.string().max(400),
        fitScore: z.number().int().min(1).max(5),
        sameDepartment: z.boolean().default(false),
        sharesPilotContext: z.boolean().default(false),
      })
    )
    .min(1)
    .max(2),
  /** Optional one-line summary of pairing rationale for the dialog header. */
  summary: z.string().max(280).default(""),
});

export type BuddyRecommendation = z.infer<typeof BuddyRecommendationSchema>;
