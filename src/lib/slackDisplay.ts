import { emojify } from "node-emoji";

/**
 * Slack sends `&`, `<`, and `>` as HTML entities in raw message text (they are
 * reserved control characters in their mrkdwn spec). Clients must decode them
 * for display. See https://docs.slack.dev/messaging/formatting-message-text
 * under "Escaping text".
 *
 * This intentionally decodes only the three entities Slack spec-guarantees
 * plus the two common quote variants (`&quot;` / `&#39;`) so we don't have to
 * pull in a full HTML parser. Numeric entities (`&#60;`, `&#x3c;`) are rare
 * from Slack but included for safety.
 */
export function decodeSlackHtmlEntities(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos|#39);/g, (_m, n: string) => {
      switch (n) {
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "amp":
          return "&";
        case "quot":
          return '"';
        case "apos":
        case "#39":
          return "'";
        default:
          return _m;
      }
    })
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff
        ? String.fromCodePoint(n)
        : _m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff
        ? String.fromCodePoint(n)
        : _m;
    });
}

/** Normalize a Slack channel name for display (leading #, trimmed). */
export function formatSlackChannelHash(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t}`;
}

/**
 * True when the stored "Slack channel" field is actually a channel id (e.g. goal name empty
 * and only `C…` / `G…` was saved). Used to decide when to resolve via `conversations.info`.
 */
export function slackStoredChannelNameLooksLikeChannelId(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^[CG][A-Z0-9]{8,}$/i.test(t);
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
 * Truncate for UI preview without cutting a Slack angle-bracket token mid-way.
 * Covers `<@U…>` user mentions, `<#C…>` channel links, `<!channel|here|…>`
 * broadcasts, and `<https://…>` / `<mailto:…>` links — any of which would
 * break inline rendering if the truncation fell inside them.
 */
export function truncateSlackTextAvoidSplitMentions(
  raw: string,
  maxLen: number
): string {
  const t = raw.trim();
  if (t.length <= maxLen) return t;
  let cut = t.slice(0, maxLen);
  const partial = /<[@#!]?[^<>]*$/.exec(cut);
  if (partial && partial.index !== undefined) {
    cut = cut.slice(0, partial.index).trimEnd();
  }
  return `${cut}…`;
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

/** Common Slack `:shortcode:` → Unicode for readable previews (subset + Slack-only names). */
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
  /** Slack name; not always present in generic emoji shortcode packs. */
  film_frames: "🎞️",
};

/**
 * Fitzpatrick modifiers Slack appends for diversified emoji reactions
 * (`name::skin-tone-2` … `skin-tone-6` in the API).
 */
const SLACK_REACTION_SKIN_TONE: Record<string, string> = {
  "skin-tone-2": "\u{1F3FB}",
  "skin-tone-3": "\u{1F3FC}",
  "skin-tone-4": "\u{1F3FD}",
  "skin-tone-5": "\u{1F3FE}",
  "skin-tone-6": "\u{1F3FF}",
};

/**
 * Turn a Slack `reactions[].name` value into display text (Unicode emoji).
 * Handles `raised_hands::skin-tone-2` style names; otherwise defers to
 * {@link expandSlackEmojiShortcodes} on `:${name}:`.
 */
export function slackReactionNameToDisplay(name: string): string {
  const trimmed = name.trim();
  const skin = /^(.+)::(skin-tone-[2-6])$/i.exec(trimmed);
  if (skin) {
    const baseShort = skin[1]!;
    const toneKey = skin[2]!.toLowerCase();
    const modifier = SLACK_REACTION_SKIN_TONE[toneKey];
    const baseKey = baseShort.toLowerCase();
    const fromSlackMap = SLACK_EMOJI_SHORTCODE[baseKey];
    const baseChar =
      fromSlackMap ??
      (() => {
        const e = emojify(`:${baseShort}:`);
        return e === `:${baseShort}:` ? null : e;
      })();
    if (modifier && baseChar) return emojify(`${baseChar}${modifier}`);
  }
  return expandSlackEmojiShortcodes(`:${trimmed}:`);
}

export function expandSlackEmojiShortcodes(s: string): string {
  const afterSlackSubset = s.replace(/:([a-z0-9_+-]+):/gi, (full, code: string) => {
    const key = code.toLowerCase();
    const u = SLACK_EMOJI_SHORTCODE[key];
    return u ?? full;
  });
  return emojify(afterSlackSubset);
}

/**
 * Inline mrkdwn cleanup for UI previews: channel links and auto-links become plain
 * labels/text; then emoji shortcodes expand. Does not handle user mentions (`<@…>`).
 * Decodes HTML entities (`&gt;`, `&amp;`, `&lt;`, …) **after** angle-bracket parsing
 * so Slack's reserved `<…>` tokens are still recognized.
 */
export function slackInlineMrkdwnForPreviewPlain(s: string): string {
  let t = s;
  t = t.replace(/<#[CGD]([A-Z0-9]+)\|([^>]+)>/g, "#$2");
  t = t.replace(/<#[CGD]([A-Z0-9]+)>/g, "#channel");
  t = t.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2");
  t = t.replace(/<(https?:[^>]+)>/g, "$1");
  t = decodeSlackHtmlEntities(t);
  return expandSlackEmojiShortcodes(t);
}

/**
 * Strip Slack mrkdwn for short UI previews (threads, tooltips).
 * When `userIdToLabel` is provided, `@mentions` and bare IDs resolve to display names.
 * HTML entities (`&gt;`, `&amp;`, `&lt;`) are decoded **after** angle-bracket parsing
 * so Slack's reserved `<…>` tokens are still recognized.
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
  s = decodeSlackHtmlEntities(s);
  s = expandSlackEmojiShortcodes(s);
  if (s.length > maxLen) return `${s.slice(0, maxLen)}…`;
  return s;
}
