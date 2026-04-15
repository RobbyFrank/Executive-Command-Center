/** Normalize a Slack channel name for display (leading #, trimmed). */
export function formatSlackChannelHash(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t}`;
}

/**
 * Build a Slack deep-link for a channel. Uses the universal redirect
 * endpoint so it works in desktop, mobile, and browser.
 */
export function slackChannelUrl(channelId: string): string {
  const id = channelId.trim();
  if (!id) return "";
  return `https://slack.com/app_redirect?channel=${encodeURIComponent(id)}`;
}

/** Collect Slack user IDs from mrkdwn user mentions in message text. */
export function collectSlackUserIdsFromMessageText(raw: string): string[] {
  const ids: string[] = [];
  const re = /<@(U[A-Z0-9]+)(?:\|[^>]*)?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    ids.push(m[1].toUpperCase());
  }
  return ids;
}

/**
 * Replace `<@USERID|Name>` / `<@USERID>` using embedded labels and/or a resolved id→name map.
 * Optionally replaces bare `U…` Slack IDs when they appear as standalone tokens (export quirks).
 */
export function expandSlackUserMentionsForDisplay(
  raw: string,
  userIdToLabel?: Map<string, string>
): string {
  const map = userIdToLabel ?? new Map<string, string>();
  let s = raw;
  s = s.replace(
    /<@(U[A-Z0-9]+)(?:\|([^>]*))?>/gi,
    (_full, idRaw: string, embedded: string | undefined) => {
      const id = idRaw.toUpperCase();
      const emb = embedded?.trim();
      if (emb) return emb;
      const name = map.get(id);
      if (name) return `@${name}`;
      return `@${id}`;
    }
  );
  if (map.size > 0) {
    s = s.replace(/\b(U[A-Z0-9]{10})\b/g, (token) => {
      const name = map.get(token);
      return name ?? token;
    });
  }
  return s;
}

/** Common Slack `:shortcode:` → Unicode for readable previews (subset). */
const SLACK_EMOJI_SHORTCODE: Record<string, string> = {
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  x: "❌",
  heavy_multiplication_x: "✖️",
  warning: "⚠️",
  exclamation: "❗",
  question: "❓",
  bangbang: "‼️",
  interrobang: "⁉️",
  fire: "🔥",
  rocket: "🚀",
  thumbsup: "👍",
  "+1": "👍",
  thumbsdown: "👎",
  "-1": "👎",
  eyes: "👀",
  raised_hands: "🙌",
  clap: "👏",
  pray: "🙏",
  muscle: "💪",
  heart: "❤️",
  blue_heart: "💙",
  green_heart: "💚",
  yellow_heart: "💛",
  broken_heart: "💔",
  tada: "🎉",
  sparkles: "✨",
  zap: "⚡",
  bulb: "💡",
  speech_balloon: "💬",
  left_speech_bubble: "🗨️",
  thought_balloon: "💭",
  pencil: "📝",
  memo: "📝",
  calendar: "📅",
  date: "📅",
  clock: "🕐",
  hourglass_flowing_sand: "⏳",
  hourglass: "⌛",
  inbox_tray: "📥",
  outbox_tray: "📤",
  email: "📧",
  link: "🔗",
  page_facing_up: "📄",
  bookmark: "🔖",
  pushpin: "📌",
  round_pushpin: "📍",
  construction: "🚧",
  road: "🛣️",
  traffic_light: "🚦",
  rotating_light: "🚨",
  mag: "🔍",
  microscope: "🔬",
  coffee: "☕",
  beer: "🍺",
  pizza: "🍕",
  package: "📦",
  ship: "🚢",
  airplane: "✈️",
  dart: "🎯",
  checkered_flag: "🏁",
  crown: "👑",
  star: "⭐",
  star2: "🌟",
  rainbow: "🌈",
  ocean: "🌊",
  sunny: "☀️",
  cloud: "☁️",
  umbrella: "☂️",
  snowflake: "❄️",
  skull: "💀",
  ghost: "👻",
  robot_face: "🤖",
  wave: "👋",
  hand: "✋",
  point_right: "👉",
  point_left: "👈",
  point_up: "👆",
  point_down: "👇",
  ok_hand: "👌",
  v: "✌️",
  crossed_fingers: "🤞",
  smile: "😊",
  slight_smile: "🙂",
  neutral_face: "😐",
  worried: "😟",
  frowning: "☹️",
  sob: "😭",
  joy: "😂",
  sweat_smile: "😅",
  astonished: "😲",
  thinking_face: "🤔",
  face_with_monocle: "🧐",
  nerd_face: "🤓",
  sunglasses: "😎",
};

export function expandSlackEmojiShortcodes(s: string): string {
  return s.replace(/:([a-z0-9_+-]+):/gi, (full, code: string) => {
    const key = code.toLowerCase();
    const u = SLACK_EMOJI_SHORTCODE[key];
    return u ?? full;
  });
}

/**
 * Inline mrkdwn cleanup for UI previews: channel links and auto-links become plain
 * labels/text; then emoji shortcodes expand. Does not handle user mentions (`<@…>`).
 */
export function slackInlineMrkdwnForPreviewPlain(s: string): string {
  let t = s;
  t = t.replace(/<#[CGD]([A-Z0-9]+)\|([^>]+)>/g, "#$2");
  t = t.replace(/<#[CGD]([A-Z0-9]+)>/g, "#channel");
  t = t.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2");
  t = t.replace(/<(https?:[^>]+)>/g, "$1");
  return expandSlackEmojiShortcodes(t);
}

/**
 * Strip Slack mrkdwn for short UI previews (threads, tooltips).
 * When `userIdToLabel` is provided, `@mentions` and bare IDs resolve to display names.
 */
export function slackMessageTextForDisplay(
  raw: string,
  maxLen = 400,
  userIdToLabel?: Map<string, string>
): string {
  let s = raw.trim();
  s = expandSlackUserMentionsForDisplay(s, userIdToLabel);
  s = s.replace(/<#[CDG][A-Z0-9]+\|([^>]+)>/g, "#$1");
  s = s.replace(/<#[CDG][A-Z0-9]+>/g, "#channel");
  s = s.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2");
  s = s.replace(/<(https?:[^>]+)>/g, "$1");
  s = s.replace(/!channel/gi, "@channel");
  s = s.replace(/!here/gi, "@here");
  s = s.replace(/!everyone/gi, "@everyone");
  s = expandSlackEmojiShortcodes(s);
  if (s.length > maxLen) return `${s.slice(0, maxLen)}…`;
  return s;
}
