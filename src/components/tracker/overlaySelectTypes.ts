/** Second argument to `formatDisplay` for overlay `<select>`-style cells (see `InlineEditCell`). */
export type OverlaySelectFormatContext = {
  role: "trigger" | "option";
  isSelected: boolean;
};
