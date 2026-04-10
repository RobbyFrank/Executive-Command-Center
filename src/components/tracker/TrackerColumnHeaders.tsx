/** Column label rows for Roadmap — match GoalSection and ProjectRow widths. */

import { SlackLogo } from "./SlackLogo";

export function GoalsColumnHeaders() {
  return (
    <div className="border-b border-zinc-800/90 bg-zinc-950/80">
      <div className="flex items-center gap-2 pl-6 pr-4 py-2 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <div className="w-64 shrink-0" title="Goal description">
          Goal
        </div>
        <div className="w-40 shrink-0 min-w-0" title="Owner and department">
          Owner
        </div>
        <div className="w-14 shrink-0">Pri</div>
        <div
          className="w-44 shrink-0"
          title="Measurable target for this goal"
        >
          Target
        </div>
        <div
          className="w-44 shrink-0"
          title="Current value vs measurable target"
        >
          Current
        </div>
        <div
          className="w-24 shrink-0"
          title="Impact — higher is more valuable if the goal is achieved"
        >
          Impact
        </div>
        <div
          className="w-28 shrink-0"
          title="Confidence in achieving this goal"
        >
          Confidence
        </div>
        <div
          className="w-32 shrink-0"
          title="Cost of delay — how costly it is to wait; higher means more urgency"
        >
          Cost of delay
        </div>
        <div
          className="w-16 shrink-0"
          title="Sync = sequential projects; Async = parallel"
        >
          Exec
        </div>
        <div
          className="w-44 shrink-0 flex items-center"
          title="Slack channel"
        >
          <SlackLogo className="h-3.5 w-3.5 opacity-80" />
        </div>
        <div className="min-w-2 flex-1 shrink" aria-hidden />
        <div className="w-[5.5rem] shrink-0 text-right pr-0">Review</div>
      </div>
    </div>
  );
}

export function ProjectsColumnHeaders() {
  return (
    <div className="border-b border-zinc-800/70 bg-zinc-950/50">
      <div className="flex items-center gap-2 pl-12 pr-4 py-2 text-xs font-medium text-zinc-500">
        <div className="w-8 shrink-0" aria-hidden />
        <div className="w-64 shrink-0" title="Project name">
          Project
        </div>
        <div className="w-40 shrink-0 min-w-0" title="Owner and department">
          Owner
        </div>
        <div className="w-14 shrink-0">Pri</div>
        <div className="w-44 shrink-0" title="Delivery status">
          Status
        </div>
        <div
          className="w-44 shrink-0 min-w-0"
          title="Next milestone not yet done (from your milestone list)"
        >
          Next milestone
        </div>
        <div
          className="w-44 shrink-0 min-w-0"
          title="When this project counts as done"
        >
          Done when
        </div>
        <div
          className="w-28 shrink-0"
          title="Complexity — higher is harder to deliver"
        >
          Complexity
        </div>
        <div className="w-24 shrink-0">Progress</div>
        <div className="w-28 shrink-0" title="Target date">
          Date
        </div>
        <div
          className="w-10 shrink-0 flex items-center"
          title="Slack URL"
        >
          <SlackLogo className="h-3.5 w-3.5 opacity-80" />
        </div>
        <div className="min-w-2 flex-1 shrink" aria-hidden />
        <div className="w-[5.5rem] shrink-0 text-right pr-0">Review</div>
      </div>
    </div>
  );
}
