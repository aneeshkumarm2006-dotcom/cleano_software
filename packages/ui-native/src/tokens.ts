// Design tokens for the Bookmops mobile apps.
//
// Every value here is the web product's own, taken from the Pier palette in
// apps/web/src/app/globals.css, so the apps and the web are one family rather
// than two lookalikes. The mobile screen designs in docs/design/mobile predate
// Pier (they use the old teal and navy); their layout and structure are
// followed, their colours are not.

export const color = {
  /** The page ground behind every screen. */
  ground: "#f4f7f8",
  /** A quieter ground for inset areas and pressed states. */
  groundDeep: "#e4ecee",
  /** Cards, sheets, inputs. */
  surface: "#ffffff",

  /** The dark chrome: the tab bar, the "now" block, primary buttons. */
  chrome: "#10242b",
  /** The accent. Large text, icons, fills behind white — never small text. */
  accent: "#0e7f8d",
  /** The accent for small text: 7.95:1 on white, where `accent` fails AA. */
  accentText: "#005a63",
  /** Accent washes behind content. */
  accentSoft: "rgba(14,127,141,0.10)",
  accentSofter: "rgba(14,127,141,0.05)",
  /** The accent on the dark chrome. */
  accentOnChrome: "#35b3c2",

  /** Body text. */
  ink: "#0b1418",
  /** Secondary text: 6.7:1 on white, 6.2:1 on ground. */
  ink2: "#47606a",
  /**
   * Tertiary text, the lightest text allowed: at least 4.5:1 on every ground
   * it sits on (5.5 on white, 5.1 on ground, 4.6 on groundDeep and on
   * accentSoft). Darkened from #64818b, which measured 3.86:1 on the ground
   * and failed WCAG AA for the small labels that use it.
   */
  ink3: "#526d77",
  /** Text on the dark chrome, by emphasis. */
  onChrome: "#ffffff",
  onChrome2: "rgba(255,255,255,0.72)",
  onChrome3: "rgba(255,255,255,0.56)",

  // White washes on the dark chrome, for fills rather than text or lines,
  // faintest first. Named for what they do, so a screen reaches for one of
  // these instead of writing its own alpha.
  /** A panel set into the chrome: the clock's facts row. */
  panelOnChrome: "rgba(255,255,255,0.07)",
  /** A chip or row on the chrome, at rest (a reaction), or a row pressed. */
  fillOnChrome: "rgba(255,255,255,0.08)",
  /** The empty part of a progress ring on the chrome. */
  trackOnChrome: "rgba(255,255,255,0.10)",
  /** The empty part of a progress ring on an active card. */
  trackOnChromeCard: "rgba(255,255,255,0.13)",
  /** A step not yet done, in a row of step bars. */
  stepOnChrome: "rgba(255,255,255,0.14)",
  /** A chip on the chrome, pressed. */
  fillOnChromePressed: "rgba(255,255,255,0.16)",
  /** A chip on the chrome, chosen. */
  fillOnChromeSelected: "rgba(255,255,255,0.22)",
  /** The outline of an empty checkbox on the chrome. */
  outlineOnChrome: "rgba(255,255,255,0.25)",
  /** A warning's wash on the chrome: `warningOnChrome` at 14%. */
  warningWashOnChrome: "rgba(245,196,107,0.14)",
  /** The chrome at 72%, behind a small label laid over a photo. */
  scrim: "rgba(16,36,43,0.72)",

  line: "#dbe4e7",
  lineStrong: "#c2d0d4",
  lineOnChrome: "rgba(255,255,255,0.12)",

  /** Money earned, success. */
  success: "#1f7a4d",
  successSoft: "#e2f3ea",
  /** Money on the dark chrome. */
  successOnChrome: "#7fd6a6",
  warning: "#8a5100",
  warningSoft: "#fbeedc",
  /** Time-sensitive cues on the dark chrome ("starts in 48 min"). */
  warningOnChrome: "#f5c46b",
  danger: "#ae2b2b",
  dangerSoft: "#fae9e9",
  /** Unread badges: a bright red reads as a count, not an error. */
  badge: "#dc2626",
} as const;

export type ColorToken = keyof typeof color;

/** 4-point spacing. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: 10,
  md: 13,
  lg: 15,
  xl: 17,
  xxl: 20,
  pill: 999,
} as const;

/** Every tappable thing is at least this tall (Apple HIG 44pt, Material 48dp). */
export const minTouch = 44;

export const fontFamily = {
  regular: "Gontserrat-Regular",
  medium: "Gontserrat-Medium",
  semibold: "Gontserrat-SemiBold",
  bold: "Gontserrat-Bold",
  extrabold: "Gontserrat-ExtraBold",
} as const;

export type FontWeightName = keyof typeof fontFamily;

/**
 * The type scale. Sizes follow the screen designs; `numeral` styles use
 * tabular figures so times and money line up in columns.
 */
export const type = {
  display: { fontSize: 34, lineHeight: 36, letterSpacing: -1.3, weight: "bold" },
  title: { fontSize: 26, lineHeight: 30, letterSpacing: -0.8, weight: "bold" },
  heading: { fontSize: 19, lineHeight: 24, letterSpacing: -0.3, weight: "bold" },
  subheading: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2, weight: "bold" },
  body: { fontSize: 15, lineHeight: 21, letterSpacing: 0, weight: "regular" },
  bodyStrong: { fontSize: 15, lineHeight: 21, letterSpacing: 0, weight: "semibold" },
  small: { fontSize: 13, lineHeight: 18, letterSpacing: 0, weight: "medium" },
  /** Uppercase section labels ("NEXT JOB", "LATER TODAY"). */
  eyebrow: { fontSize: 11, lineHeight: 14, letterSpacing: 1.2, weight: "extrabold", uppercase: true },
  /** Button labels. */
  button: { fontSize: 15.5, lineHeight: 20, letterSpacing: 0, weight: "bold" },
} as const satisfies Record<
  string,
  { fontSize: number; lineHeight: number; letterSpacing: number; weight: FontWeightName; uppercase?: boolean }
>;

export type TypeVariant = keyof typeof type;

/**
 * Elevation, as layered low-alpha shadows tinted with the chrome colour
 * (black shadows go muddy on the blue-grey ground). iOS takes the shadow
 * props; Android takes `elevation` and ignores the rest.
 */
export const elevation = {
  1: { shadowColor: "#10242b", shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  2: { shadowColor: "#10242b", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  3: { shadowColor: "#10242b", shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  4: { shadowColor: "#10242b", shadowOpacity: 0.18, shadowRadius: 36, shadowOffset: { width: 0, height: 20 }, elevation: 10 },
} as const;

/**
 * Motion, from the web crew app's system. Short on purpose: cleaners use this
 * one-handed, mid-shift, and anything past ~250ms starts to feel like waiting.
 */
export const motion = {
  instant: 90,
  fast: 160,
  base: 220,
  slow: 340,
} as const;
