import { slackReactionNameToDisplay } from "@/lib/slackDisplay";
import { cn } from "@/lib/utils";

export type SlackReactionForDisplay = {
  name: string;
  count: number;
};

/**
 * Renders Slack emoji reactions as compact pills (emoji + count). Used on both
 * the Followups row (reactions on the ask itself) and inside the thread-preview
 * popover (reactions on each message). Custom workspace emojis that aren't in
 * the shortcode map fall back to their raw `:name:` text — still readable and
 * signals that someone reacted.
 */
export function SlackReactionsRow({
  reactions,
  size = "sm",
  className,
  title,
}: {
  reactions: SlackReactionForDisplay[] | undefined;
  size?: "xs" | "sm";
  className?: string;
  title?: string;
}) {
  if (!reactions || reactions.length === 0) return null;

  const pillClass =
    size === "xs"
      ? "gap-0.5 px-1.5 py-0 text-[10px] leading-[1.4rem]"
      : "gap-1 px-1.5 py-0.5 text-[11px]";

  return (
    <div
      className={cn("flex flex-wrap gap-1", className)}
      aria-label={title ?? "Reactions"}
    >
      {reactions.map((r, i) => {
        const rendered = slackReactionNameToDisplay(r.name);
        // If the shortcode couldn't be resolved, rendered === `:name:` — still
        // render it so the user sees *something* reacted to the message.
        const display = rendered === `:${r.name}:` ? `:${r.name}:` : rendered;
        const isCustom = display === `:${r.name}:`;
        return (
          <span
            key={`${r.name}-${i}`}
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border border-zinc-700/70 bg-zinc-800/60 tabular-nums text-zinc-200 transition-colors hover:border-zinc-600",
              pillClass
            )}
            title={`:${r.name}: · ${r.count}`}
          >
            <span className={cn(isCustom ? "text-[10px] text-zinc-400" : "")}>
              {display}
            </span>
            <span className="text-zinc-400">{r.count}</span>
          </span>
        );
      })}
    </div>
  );
}
