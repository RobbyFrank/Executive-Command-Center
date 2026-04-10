export class TrackerConcurrentModificationError extends Error {
  readonly code = "TRACKER_CONFLICT" as const;

  constructor(
    message = "Data changed while saving. Refresh the page and try again."
  ) {
    super(message);
    this.name = "TrackerConcurrentModificationError";
  }
}
