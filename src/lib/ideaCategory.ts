import {
  AlertTriangle,
  Compass,
  DollarSign,
  FlaskConical,
  Heart,
  Package,
  ShieldCheck,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type IdeaCategory =
  | "growth"
  | "revenue"
  | "retention"
  | "product"
  | "quality"
  | "ops"
  | "strategy"
  | "risk"
  | "experiment";

export const IDEA_CATEGORIES: readonly IdeaCategory[] = [
  "growth",
  "revenue",
  "retention",
  "product",
  "quality",
  "ops",
  "strategy",
  "risk",
  "experiment",
];

export interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile (bg + text). */
  tile: string;
  /** Tailwind classes for the subtle category pill. */
  pill: string;
  /** Tailwind class for the card ring on hover/selected. */
  ring: string;
}

export const CATEGORY_META: Record<IdeaCategory, CategoryMeta> = {
  growth: {
    label: "Growth",
    icon: TrendingUp,
    tile: "bg-emerald-500/15 text-emerald-300",
    pill: "bg-emerald-500/10 text-emerald-300/90",
    ring: "hover:border-emerald-500/50 hover:ring-emerald-500/20",
  },
  revenue: {
    label: "Revenue",
    icon: DollarSign,
    tile: "bg-amber-500/15 text-amber-300",
    pill: "bg-amber-500/10 text-amber-300/90",
    ring: "hover:border-amber-500/50 hover:ring-amber-500/20",
  },
  retention: {
    label: "Retention",
    icon: Heart,
    tile: "bg-rose-500/15 text-rose-300",
    pill: "bg-rose-500/10 text-rose-300/90",
    ring: "hover:border-rose-500/50 hover:ring-rose-500/20",
  },
  product: {
    label: "Product",
    icon: Package,
    tile: "bg-sky-500/15 text-sky-300",
    pill: "bg-sky-500/10 text-sky-300/90",
    ring: "hover:border-sky-500/50 hover:ring-sky-500/20",
  },
  quality: {
    label: "Quality",
    icon: ShieldCheck,
    tile: "bg-teal-500/15 text-teal-300",
    pill: "bg-teal-500/10 text-teal-300/90",
    ring: "hover:border-teal-500/50 hover:ring-teal-500/20",
  },
  ops: {
    label: "Ops",
    icon: Wrench,
    tile: "bg-zinc-500/20 text-zinc-300",
    pill: "bg-zinc-500/15 text-zinc-300",
    ring: "hover:border-zinc-500/60 hover:ring-zinc-500/20",
  },
  strategy: {
    label: "Strategy",
    icon: Compass,
    tile: "bg-indigo-500/15 text-indigo-300",
    pill: "bg-indigo-500/10 text-indigo-300/90",
    ring: "hover:border-indigo-500/50 hover:ring-indigo-500/20",
  },
  risk: {
    label: "Risk",
    icon: AlertTriangle,
    tile: "bg-orange-500/15 text-orange-300",
    pill: "bg-orange-500/10 text-orange-300/90",
    ring: "hover:border-orange-500/50 hover:ring-orange-500/20",
  },
  experiment: {
    label: "Experiment",
    icon: FlaskConical,
    tile: "bg-violet-500/15 text-violet-300",
    pill: "bg-violet-500/10 text-violet-300/90",
    ring: "hover:border-violet-500/50 hover:ring-violet-500/20",
  },
};

export function normalizeIdeaCategory(raw: unknown): IdeaCategory {
  if (typeof raw !== "string") return "product";
  const v = raw.toLowerCase().trim();
  return (IDEA_CATEGORIES as readonly string[]).includes(v)
    ? (v as IdeaCategory)
    : "product";
}

// Ordered patterns — first match wins. Keep growth/revenue specific signals
// ahead of generic product/ops terms so "increase MRR" → revenue, not product.
const CATEGORY_HEURISTICS: Array<{ category: IdeaCategory; pattern: RegExp }> = [
  {
    category: "revenue",
    pattern:
      /\b(revenue|mrr|arr|billing|pricing|upsell|cross[\s-]?sell|monetiz|paywall|paid[\s-]?tier|subscription|cac|ltv|payback|invoice|checkout|pay[\s-]?wall|conversion\s+revenue)\b/i,
  },
  {
    category: "retention",
    pattern:
      /\b(retention|churn|reactivat|win[\s-]?back|renew|stickiness|engagement|dau|mau|nps|csat|onboard(?:ing)?|activation|north[\s-]?star)\b/i,
  },
  {
    category: "growth",
    pattern:
      /\b(growth|acquisition|signups?|sign[\s-]?ups?|funnel|top[\s-]?of[\s-]?funnel|landing|marketing|seo|sem|ads?|campaign|referral|viral|waitlist|lead(?:s|\s+gen)?)\b/i,
  },
  {
    category: "risk",
    pattern:
      /\b(risk|incident|outage|security|breach|vulnerab|compliance|sox|gdpr|hipaa|legal|audit|fraud|abuse|sla|downtime)\b/i,
  },
  {
    category: "quality",
    pattern:
      /\b(quality|bug|bugs|qa|test(?:ing|s)?|reliab|stability|crash|error[\s-]?rate|regressions?|defects?|polish)\b/i,
  },
  {
    category: "ops",
    pattern:
      /\b(ops|operations|infra|infrastructure|deploy|ci\/cd|tooling|devops|migration|cleanup|refactor|observab|monitor|logging|alerting|runbook|on[\s-]?call)\b/i,
  },
  {
    category: "experiment",
    pattern:
      /\b(experiment|a\/b|ab\s+test|hypothes|validate|prototype|spike|discovery|research|pilot\b|proof[\s-]?of[\s-]?concept|poc)\b/i,
  },
  {
    category: "strategy",
    pattern:
      /\b(strategy|strategic|roadmap|vision|positioning|north\s+star\s+strategy|market[\s-]?fit|pmf|gtm|go[\s-]?to[\s-]?market|partnership|competitiv|moat)\b/i,
  },
  {
    category: "product",
    pattern:
      /\b(feature|product|ux|ui|design|flow|workflow|dashboard|integration|api|sdk|platform|build(?:ing)?|ship(?:ping)?|release)\b/i,
  },
];

/**
 * Client-side category heuristic for scraped goals: scans free-text signals
 * (description, measurableTarget, whyItMatters) and picks the first matching
 * category. Defaults to `product` when nothing matches.
 */
export function inferIdeaCategoryFromText(
  ...texts: Array<string | null | undefined>
): IdeaCategory {
  const joined = texts
    .map((t) => (typeof t === "string" ? t : ""))
    .join(" \n ");
  if (!joined.trim()) return "product";
  for (const { category, pattern } of CATEGORY_HEURISTICS) {
    if (pattern.test(joined)) return category;
  }
  return "product";
}
