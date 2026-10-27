import { syncLocalStorageItem } from "@/lib/profileStorage";

/**
 * The app's accent colour, chosen by the learner.
 *
 * Micheon's green is the default and stays the identity; this only lets
 * someone who wants a different colour have one. Everything downstream is
 * DERIVED rather than stored, because an accent is not one colour: it is a
 * button fill, a hover, a pressed state, a soft tint behind selected things,
 * and the ink that has to sit on top of it and still be readable. Storing
 * only the base and computing the rest is what keeps a hand-picked colour
 * from producing white text on yellow.
 */
const ACCENT_KEY = "gl-accent-colour";
export const ACCENT_CHANGE_EVENT = "gl-accent-changed";

/** Micheon green. Matches --accent in the light theme. */
export const DEFAULT_ACCENT = "#43b84c";

interface AccentPreset {
  hex: string;
  name: string;
}

/** A spread of hues that all survive the readability derivation below. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { hex: DEFAULT_ACCENT, name: "Micheon green" },
  { hex: "#2f9e6e", name: "Pine" },
  { hex: "#2f8fd8", name: "Sky" },
  { hex: "#4f6ee0", name: "Indigo" },
  { hex: "#7a48d8", name: "Violet" },
  { hex: "#d4568f", name: "Rose" },
  { hex: "#e0603f", name: "Ember" },
  { hex: "#d59a1f", name: "Amber" },
  { hex: "#1f9b96", name: "Teal" },
  { hex: "#6b7280", name: "Slate" },
];

type Rgb = { b: number; g: number; r: number };
type Hsl = { h: number; l: number; s: number };

export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.replace(/(.)/g, "$1$1") : raw;
  return /^[0-9a-f]{6}$/i.test(full) ? `#${full.toLowerCase()}` : null;
}

function toRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
}

function shift(hex: string, { lightness = 0, saturation = 0 }: { lightness?: number; saturation?: number }): string {
  const hsl = rgbToHsl(toRgb(hex));
  return toHex(hslToRgb({
    h: hsl.h,
    s: Math.max(0, Math.min(1, hsl.s + saturation)),
    l: Math.max(0, Math.min(1, hsl.l + lightness)),
  }));
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const lin = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Ink that is actually readable on a given fill.
 *
 * A picker will happily hand back a yellow, and white on yellow is unreadable
 * — so this picks whichever of near-black or white wins, rather than assuming
 * the accent is dark enough for white the way a hardcoded green could.
 */
export function inkOn(hex: string): string {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#0b0e13") ? "#ffffff" : "#0b0e13";
}

interface AccentShades {
  accent: string;
  accentDim: string;
  accentHover: string;
  accentPressed: string;
  accentText: string;
}

/**
 * The full set a theme needs, derived from one colour.
 *
 * Dark mode lifts the base first: a colour tuned to read against white is
 * muddy against #0b0e13, which is exactly why the built-in green is #43b84c
 * in light and a brighter #3fd964 in dark.
 */
export function accentShades(base: string, theme: "dark" | "light"): AccentShades {
  const hex = normaliseHex(base) ?? DEFAULT_ACCENT;
  if (theme === "dark") {
    const lifted = shift(hex, { lightness: 0.12, saturation: 0.06 });
    return {
      accent: lifted,
      accentHover: shift(lifted, { lightness: 0.06 }),
      accentPressed: shift(lifted, { lightness: -0.08 }),
      accentDim: shift(hex, { lightness: -0.28, saturation: -0.1 }),
      accentText: inkOn(lifted),
    };
  }
  return {
    accent: hex,
    accentHover: shift(hex, { lightness: -0.07 }),
    accentPressed: shift(hex, { lightness: -0.13 }),
    accentDim: shift(hex, { lightness: 0.4, saturation: -0.12 }),
    accentText: inkOn(hex),
  };
}

export function getAccentColour(): string {
  if (typeof window === "undefined") return DEFAULT_ACCENT;
  try {
    return normaliseHex(window.localStorage.getItem(ACCENT_KEY)) ?? DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function isDefaultAccent(hex: string = getAccentColour()): boolean {
  return normaliseHex(hex) === DEFAULT_ACCENT;
}

/**
 * Paint the derived shades onto the document.
 *
 * Not as inline properties on the root: every themed container
 * (.new-ui-prototype, the guided lesson, the portalled mixer) re-declares
 * --accent on ITSELF, and a custom property declared on a closer ancestor
 * beats one inherited from the root — so setting them on <html> changed
 * nothing at all downstream. A stylesheet that names those containers, with
 * !important so it cannot lose to the theme blocks' higher specificity, is
 * what actually reaches the buttons.
 */
/**
 * The accent, pushed along its own hue until it is legible as text.
 *
 * Walks toward white on dark and toward black on light, one percent at a time,
 * and stops the moment it clears 4.5:1 against the surface it will sit on —
 * so the colour still reads as the learner's accent rather than being replaced
 * by grey, but the label can actually be read.
 */
function readableInk(hex: string, theme: "dark" | "light"): string {
  const surface = theme === "dark" ? "#161b23" : "#ffffff";
  const towards = theme === "dark" ? 255 : 0;
  const { r, g, b } = toRgb(hex);
  let best = hex;
  for (let step = 0; step <= 100; step += 2) {
    const t = step / 100;
    const candidate = toHex({
      r: Math.round(r + (towards - r) * t),
      g: Math.round(g + (towards - g) * t),
      b: Math.round(b + (towards - b) * t),
    });
    best = candidate;
    // 7, not 4.5: these labels usually sit on a translucent tint of the
    // accent rather than the bare surface, which lifts the background and eats
    // most of a 4.5 margin. The headroom is what makes it hold in place.
    if (contrastRatio(candidate, surface) >= 7) break;
  }
  return best;
}

/** "94, 199, 96" — ready to drop into rgba(var(--accent-rgb), 0.4). */
/**
 * Ink for text that sits on --feature-gradient.
 *
 * Not the same job as accentText, which is picked against `accent`. The
 * gradient runs accentHover -> accentPressed, and in light mode both are
 * darker than accent — dark enough that on five of the ten presets the winner
 * flips. Measured on a light-mode Pine gradient: near-black reaches 3.00:1,
 * white reaches 4.74:1, and accentText chose the near-black.
 *
 * Picked against whichever end of the sweep is worse, so the answer holds for
 * the whole gradient rather than only where it starts.
 */
function featureInk(hover: string, pressed: string): string {
  const worst = (ink: string) => Math.min(contrastRatio(ink, hover), contrastRatio(ink, pressed));
  return worst("#ffffff") >= worst("#0b0e13") ? "#ffffff" : "#0b0e13";
}

function accentChannels(hex: string): string {
  const { r, g, b } = toRgb(hex);
  return `${r}, ${g}, ${b}`;
}

const ACCENT_STYLE_ID = "micheon-accent-overrides";
const ACCENT_SCOPES = [
  ":root",
  ".new-ui-prototype",
  ".np-feature-host",
  ".guided-session.fs-app.prototype-guided-session",
  ".audio-mixer-panel.prototype-audio-mixer",
];

export function applyAccentColour(hex: string = getAccentColour()) {
  if (typeof window === "undefined") return;
  const existing = document.getElementById(ACCENT_STYLE_ID);
  const base = normaliseHex(hex) ?? DEFAULT_ACCENT;

  if (base === DEFAULT_ACCENT) {
    // Hand the palette back to the stylesheets rather than re-stating their
    // own values, so the built-in green keeps its hand-tuned shades.
    existing?.remove();
    delete document.documentElement.dataset.accent;
    return;
  }
  // A handful of rules paint Micheon green as a literal gradient rather than
  // from a token. This flag lets those be re-pointed for a custom accent
  // while leaving the default's hand-tuned look untouched.
  document.documentElement.dataset.accent = "custom";

  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const shades = accentShades(base, theme);
  const declarations = [
    ["--accent", shades.accent],
    ["--accent-hover", shades.accentHover],
    ["--accent-pressed", shades.accentPressed],
    ["--accent-dim", shades.accentDim],
    ["--accent-text", shades.accentText],
    ["--accent-strong", theme === "dark" ? shades.accentHover : shades.accentPressed],
    // Ink for text ON the pressed fill. accentText is picked against the
    // accent, and the pressed shade is dark enough to flip the winner: the
    // dark lesson preview's pill read 3.97:1 in near-black on Violet where
    // white reaches 4.86, and its counter, hardcoded white, 2.11:1 on Amber.
    ["--accent-pressed-ink", inkOn(shades.accentPressed)],
    // Accent-coloured TEXT. --accent is tuned to be a fill; used as ink on the
    // page it lands around 3.7:1, which fails. This is the same hue pushed
    // until it clears 4.5:1 against the surface it will actually sit on.
    ["--accent-ink", readableInk(shades.accent, theme)],
    // Ink for text ON the gradient, as opposed to accent-coloured text on
    // the page. The cards using it hardcoded #ffffff, which is unreadable
    // once the accent is a yellow.
    ["--feature-ink", featureInk(shades.accentHover, shades.accentPressed)],
    ["--feature-ink-rgb", accentChannels(featureInk(shades.accentHover, shades.accentPressed))],
    ["--np-green", shades.accent],
    ["--np-green-dark", shades.accentHover],
    ["--np-green-soft", shades.accentDim],
    // Decorative, not semantic: --mint paints the activity chart and the
    // stat chips on the profile page. --success-* stays green in every
    // accent, because that one is carrying meaning.
    ["--mint", shades.accent],
    // The activity chart has its own family of tokens, so it kept its green
    // bars under every other colour. They are decorative — how much you
    // studied is not a success/failure signal — so they follow the accent.
    ["--activity-green-bar", shades.accentHover],
    ["--activity-green-bar-strong", shades.accent],
    ["--activity-green-icon", shades.accent],
    ["--activity-green-text", readableInk(shades.accent, theme)],
    ["--activity-green-soft-bg", shades.accentDim],
    // Bare channels, so a translucent gradient can be built from the accent.
    // The course hero's wash fades green to nothing across the artwork; it
    // needs the colour without an alpha baked in, which a hex token cannot
    // give it — which is why that gradient stayed green while everything
    // around it turned.
    ["--accent-rgb", accentChannels(shades.accent)],
    ["--accent-hover-rgb", accentChannels(shades.accentHover)],
    ["--accent-ink-rgb", accentChannels(readableInk(shades.accent, theme))],
    ["--fs-yellow", shades.accent],
    ["--fs-yellow-hover", shades.accentHover],
    ["--fs-purple", shades.accent],
    // The profile page paints its feature cards — "Words tracked", "Next
    // target", the activity chart — from this gradient rather than from
    // --accent, so they stayed green under any other colour.
    ["--feature-gradient", `linear-gradient(145deg, ${shades.accentHover}, ${shades.accentPressed})`],
    // The guided session's primary button — Continue, Next flashcard — is
    // painted from this gradient rather than from --accent, so it stayed
    // green while the session around it turned.
    ["--fs-grad", `linear-gradient(135deg, ${shades.accentHover} 0%, ${shades.accent} 52%, ${shades.accentPressed} 100%)`],
  ].map(([name, value]) => `  ${name}: ${value} !important;`).join("\n");

  const style = existing ?? document.createElement("style");
  style.id = ACCENT_STYLE_ID;
  style.textContent = `${ACCENT_SCOPES.join(",\n")} {\n${declarations}\n}`;
  if (!existing) document.head.appendChild(style);
}

export function setAccentColour(hex: string) {
  const base = normaliseHex(hex) ?? DEFAULT_ACCENT;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(ACCENT_KEY, base); } catch { /* keep the app usable */ }
    syncLocalStorageItem(ACCENT_KEY, base);
    applyAccentColour(base);
    window.dispatchEvent(new Event(ACCENT_CHANGE_EVENT));
  }
}

export function resetAccentColour() {
  setAccentColour(DEFAULT_ACCENT);
}
