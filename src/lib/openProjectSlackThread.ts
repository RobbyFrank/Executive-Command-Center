/**
 * Tiny pub/sub for "open the Slack thread popover for project X" requests that
 * originate outside the `ProjectRow` (e.g. the Goal popover's per-project row).
 *
 * The Slack thread popover state (anchor ref, thread status, likelihood, etc.)
 * lives inside `ProjectRow`, and the row is only mounted while the goal is
 * expanded. Rather than duplicating that wiring elsewhere, we dispatch a
 * request and let `GoalSection` auto-expand the matching goal while
 * `ProjectRow` opens its local popover once it mounts.
 *
 * A single "last request" is retained so `ProjectRow` can pick it up during
 * its own mount (fired from the goal popover before the row exists), with a
 * short TTL so a stale request never auto-opens minutes later.
 *
 * Plus a matching "thread closed" signal so callers (e.g. the Goal popover)
 * can re-open themselves after the user dismisses the in-app thread window.
 */

export type OpenProjectSlackThreadListener = (projectId: string) => void;
export type ProjectSlackThreadClosedListener = (projectId: string) => void;

const openListeners = new Set<OpenProjectSlackThreadListener>();
const closedListeners = new Set<ProjectSlackThreadClosedListener>();

interface PendingRequest {
  projectId: string;
  ts: number;
}

let pending: PendingRequest | null = null;

/** Max time (ms) a pending request remains "fresh" for `ProjectRow` mount consumption. */
const PENDING_TTL_MS = 2000;

export function subscribeOpenProjectSlackThread(
  listener: OpenProjectSlackThreadListener,
): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

export function requestOpenProjectSlackThread(projectId: string): void {
  const id = projectId.trim();
  if (!id) return;
  pending = { projectId: id, ts: Date.now() };
  for (const listener of Array.from(openListeners)) {
    try {
      listener(id);
    } catch {
    }
  }
}

/** Called by `ProjectRow` on mount / when its id changes; returns true once. */
export function consumePendingOpenProjectSlackThread(
  projectId: string,
): boolean {
  if (!pending) return false;
  if (pending.projectId !== projectId.trim()) return false;
  if (Date.now() - pending.ts > PENDING_TTL_MS) {
    pending = null;
    return false;
  }
  pending = null;
  return true;
}

export function subscribeProjectSlackThreadClosed(
  listener: ProjectSlackThreadClosedListener,
): () => void {
  closedListeners.add(listener);
  return () => {
    closedListeners.delete(listener);
  };
}

/**
 * Emitted by `ProjectRow` when the user closes the in-app Slack thread
 * popover that was opened via `requestOpenProjectSlackThread`. `GoalSection`
 * uses this to re-open the Goal delivery popover on dismiss.
 */
export function notifyProjectSlackThreadClosed(projectId: string): void {
  const id = projectId.trim();
  if (!id) return;
  for (const listener of Array.from(closedListeners)) {
    try {
      listener(id);
    } catch {
    }
  }
}
