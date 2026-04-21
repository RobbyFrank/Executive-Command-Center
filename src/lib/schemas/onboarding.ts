import { z } from "zod";

/**
 * Slack channels the AI thinks the new hire should be invited to for additional context
 * (role-relevant ops channels, pilot-company channels, channels the onboarding partners are in).
 * The channel id must come from the tracker's Slack channel catalog (real id from conversations.list);
 * name is cached for display when conversations.invite fails or the UI is offline.
 */
export const SuggestedChannelSchema = z.object({
  channelId: z.string().min(1),
  channelName: z.string().default(""),
  rationale: z.string().max(300).default(""),
  /** 1-5, AI self-reported confidence that this channel adds context for the pilot. */
  fitScore: z.number().int().min(1).max(5).default(3),
  /** True if the channel is private (groups:write.invites needed to invite to it). */
  isPrivate: z.boolean().default(false),
});

export type SuggestedChannel = z.infer<typeof SuggestedChannelSchema>;

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
  /**
   * 0-5 channel suggestions. Defaults to [] so older cached JSON still parses; the AI is asked
   * to fill this with role-/company-/partner-relevant channels when appropriate.
   */
  suggestedChannels: z.array(SuggestedChannelSchema).max(8).default([]),
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

/**
 * Standalone proposal for an additional pilot project (no owner yet — the new hire will be set as
 * owner after `AiCreateDialog` finishes). Used as a backfill when no existing-project candidate
 * passes the fit floor and we want more than a single `newProjectProposal` on the cards grid.
 */
export const NewPilotProjectProposalSchema = z.object({
  suggestedCompanyId: z.string(),
  suggestedGoalId: z.string().default(""),
  suggestedName: z.string().min(1),
  suggestedDefinitionOfDone: z.string().default(""),
  rationale: z.string().max(500),
});

export type NewPilotProjectProposal = z.infer<
  typeof NewPilotProjectProposalSchema
>;

export const AdditionalPilotProposalsSchema = z.object({
  proposals: z.array(NewPilotProjectProposalSchema).min(0).max(4),
});

export type AdditionalPilotProposals = z.infer<
  typeof AdditionalPilotProposalsSchema
>;
