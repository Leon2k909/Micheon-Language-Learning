#!/usr/bin/env node
/**
 * Dark mode has to be reachable, and it has to survive a restart.
 *
 * The theme engine shipped complete — storage, sync, DOM painting, a full
 * dark palette in both stylesheets — but nothing in the app ever called
 * setTheme, and the main shell pinned itself to light on boot. Dark mode
 * existed and could not be turned on. These are the four joints that made it
 * unreachable; each one alone puts it back in the drawer.
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const failures = [];

// ── 1. a control exists, and it can pick all three ────────────────────────
const profile = read("src/Gamification.tsx");
if (!/setTheme\(value\)/.test(profile)) {
  failures.push("Profile settings has no control that calls setTheme — dark mode is unreachable again");
}
for (const option of ['"light", "Light"', '"dark", "Dark"', '"system", "Match system"']) {
  if (!profile.includes(option)) {
    failures.push(`Profile settings is missing the ${option.split(",")[0]} theme option`);
  }
}
if (!/App theme/.test(profile)) failures.push("the theme control lost its label");
// It must live in Appearance, not somewhere a learner has to hunt for.
const appearanceAt = profile.indexOf('title={ui("Appearance")}');
const controlAt = profile.indexOf("App theme");
const nextCategoryAt = profile.indexOf("SettingsCategory", appearanceAt + 1);
if (appearanceAt < 0 || controlAt < appearanceAt || (nextCategoryAt > 0 && controlAt > nextCategoryAt)) {
  failures.push("the theme control is not inside the Appearance category");
}

// ── 2. the first paint honours the choice ─────────────────────────────────
const main = read("src/main.tsx");
if (/applyThemeToDom\(isMainShell/.test(main)) {
  failures.push("main.tsx still pins the shell to light — a dark-mode learner watches it load white");
}
if (!/const bootTheme = resolveTheme\(\)/.test(main) || !/applyThemeToDom\(bootTheme\)/.test(main)) {
  failures.push("main.tsx no longer paints the stored theme before first render");
}
if (!/bootTheme === "dark"/.test(main)) {
  failures.push("the inline light background in index.html will beat the stylesheet for dark-mode learners");
}

// ── 3. the theme layer resolves "system" ──────────────────────────────────
const theme = read("src/lib/theme.ts");
for (const [what, needle] of [
  ["a preference type", "export type ThemePreference"],
  ["system resolution", "prefers-color-scheme: dark"],
  ["a resolver", "export function resolveTheme"],
  ["an OS watcher", "export function watchSystemTheme"],
]) {
  if (!theme.includes(needle)) failures.push(`theme.ts lost ${what}`);
}
const app = read("src/App.tsx");
if (!/watchSystemTheme\(\)/.test(app)) {
  failures.push('App.tsx does not follow the OS, so "Match system" freezes at whatever it was on boot');
}

// ── 4. the native window opens in the right colour ────────────────────────
const electron = read("electron/main.js");
if (!/getDesktopSettings\(\)\.theme === "dark"/.test(electron)) {
  failures.push("the Electron window still opens light — dark mode flashes white on every launch");
}
const settings = read("electron/desktop-settings.cjs");
if (!/THEMES/.test(settings) || !/^\s*theme: "(light|dark)",/m.test(settings)) {
  failures.push("desktop-settings.cjs does not persist (or validate) the paint hint");
}
// The two defaults have to agree. This used to pin the literal "light", which
// is how it survived dark becoming the app default and let the native window
// keep opening white under a dark page — the exact flash it exists to stop.
const themeLib = read("src/lib/theme.ts");
const appDefault = (themeLib.match(/export const DEFAULT_THEME: Theme = "(light|dark)";/) || [])[1];
const paintDefault = (settings.match(/^\s*theme: "(light|dark)",/m) || [])[1];
// Unreadable is a failure, not a pass: the comparison below skips silently
// when either side is missing.
if (!appDefault) failures.push("theme.ts no longer declares DEFAULT_THEME, so the app default cannot be compared with anything");
if (!/stored === "system" \? stored : DEFAULT_THEME/.test(themeLib)) {
  failures.push("getThemePreference no longer falls back to DEFAULT_THEME, so the constant and the real default can drift apart");
}
if (appDefault && paintDefault && appDefault !== paintDefault) {
  failures.push(`the app defaults to ${appDefault} but the native window opens ${paintDefault} — that is a flash of the wrong theme on every cold start`);
}
// ── the page itself must not flash either ────────────────────────────────
//
// The native window opening dark only helps if the DOCUMENT is dark by the
// first frame. The body used to carry a hardcoded light background and the
// theme was applied from the React bundle, so every cold start and every
// suspended route painted white first.
const html = read("index.html");
const head = html.slice(0, html.indexOf("</head>"));
if (!/localStorage\.getItem\("gl-theme"\)/.test(head)) {
  failures.push("index.html does not read the stored theme before first paint");
}
if (!/document\.documentElement\.setAttribute\("data-theme"/.test(head)) {
  failures.push("nothing sets data-theme before the bundle loads, so the page paints untheme'd first");
}
// A module script is deferred by definition, so it cannot beat the first
// paint however early in <head> it sits.
const prePaint = (head.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [])
  .find((tag) => tag.includes("gl-theme")) || "";
if (/\btype\s*=\s*["']module["']/.test(prePaint) || /\b(defer|async)\b/.test(prePaint.split(">")[0])) {
  failures.push("the pre-paint script is deferred (module/defer/async), so it cannot beat the first paint");
}
if (/<body[^>]*background:\s*#(?!.*inherit)[0-9a-fA-F]{6}/.test(html)) {
  failures.push("the body still hardcodes a background colour, which paints before any theme is known");
}
if (!/prefers-color-scheme: dark/.test(head)) {
  failures.push("the pre-paint script cannot resolve a \"system\" preference, so system-dark users still flash light");
}

// ── nesting you can see ──────────────────────────────────────────────────
//
// A card, the panel inside it and the field inside THAT were all #161b23 —
// three levels separated by nothing, which reads as one flat sheet and is
// tiring to look at. Adjacent surfaces need a real step. 1.06 is the floor
// here rather than a WCAG number because this is depth, not legibility: below
// it two planes are indistinguishable.
{
  const proto = read("src/prototype/new-ui-prototype.css");
  const lum = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const rel = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  };
  const ratio = (a, b) => {
    const x = rel(a), y = rel(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const grab = (name) => {
    // `\\s` — a single backslash inside a template literal is dropped, which
    // makes the pattern match nothing and the check pass on any palette.
    const m = proto.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "g")) || [];
    // The dark values are the darkest ones declared for that token.
    const values = m.map((entry) => entry.match(/#[0-9a-fA-F]{6}/)[0]);
    return values.sort((a, b) => rel(a) - rel(b))[0];
  };
  const surface = grab("surface");
  const surface2 = grab("surface-2");
  const surface3 = grab("surface-3");
  if (!surface || !surface2 || !surface3) {
    failures.push("the dark surface ladder cannot be read, so its separation cannot be checked");
  } else {
    if (ratio(surface, surface2) < 1.06) {
      failures.push(`a panel inside a card is ${ratio(surface, surface2).toFixed(2)}:1 against it — that is one flat sheet, not two levels`);
    }
    if (ratio(surface2, surface3) < 1.06) {
      failures.push(`the third level is ${ratio(surface2, surface3).toFixed(2)}:1 against the second — indistinguishable`);
    }
    // And the lift must not cost legibility, which is what made the old
    // lighter cards unpleasant in the first place.
    for (const [name, hex] of [["surface", surface], ["surface-2", surface2], ["surface-3", surface3]]) {
      const ink = ratio("#eef2f8", hex);
      if (ink < 7) failures.push(`body text is only ${ink.toFixed(1)}:1 on --${name}`);
    }
  }
}

// The paint hint has to be refreshed on every boot, not only when someone
// opens Appearance and picks something. Installs that were already dark — or
// that the default migration moved to dark — never called setTheme, so their
// saved hint stayed "light" and the native window flashed white on every
// launch for precisely the people who had never touched the setting.
{
  // Scoped to applyThemeToDom's own body. A character window is not enough:
  // setTheme calls setDesktopTheme too, so a loose search matched that one and
  // the check passed with the boot call deleted.
  const start = theme.indexOf("export function applyThemeToDom");
  const next = theme.indexOf("export function", start + 10);
  const body = start < 0 ? "" : theme.slice(start, next < 0 ? undefined : next);
  if (!/setDesktopTheme/.test(body)) {
    failures.push("the native window's colour is only updated when the theme is changed, so an install that never chose one keeps flashing the wrong colour");
  }
}

const preload = read("electron/preload.cjs");
if (!/setDesktopTheme/.test(preload)) {
  failures.push("the preload bridge cannot pass the theme to the main process");
}
// ── dark is the default, but never over a real choice ────────────────────
if (appDefault !== "dark") {
  failures.push("theme.ts no longer defaults to dark");
}
// Appearance said "The default" under Light for as long as dark had been the
// default, because the label was keyed to a literal. Keyed to the constant, it
// follows the fallback wherever that goes.
if (!/value === DEFAULT_THEME \? ui\("The default"\)/.test(profile)) {
  failures.push('Appearance no longer labels DEFAULT_THEME as "The default", so the label can name a theme the app does not open in');
}
if (/value === "(light|dark)" \? ui\("The default"\)|"(light|dark)" \? ui\("[^"]*"\) : ui\("The default"\)/.test(profile)) {
  failures.push('Appearance ties "The default" to a literal theme again instead of to DEFAULT_THEME');
}
if (!/THEME_CHOSEN_KEY/.test(theme) || !/migrateToDarkThemeDefault/.test(theme)) {
  failures.push("nothing separates an install that never chose from one that picked light — the migration would overwrite a real choice");
}
if (!/localStorage\.setItem\(THEME_CHOSEN_KEY, "1"\)/.test(theme)) {
  failures.push("setTheme does not record that the learner chose, so the next default migration would overwrite them");
}
if (!/migrateToDarkThemeDefault\(\)/.test(app)) {
  failures.push("App.tsx never runs the dark default migration");
}

if (!/germDesktop\?\.setDesktopTheme/.test(theme)) {
  failures.push("setTheme never tells the desktop shell, so the hint is never written");
}

// ── 5. dark is genuinely neutral, not green-black ─────────────────────────
// The light theme's readability problem was accent-tinted surfaces; dark
// carried the identical mistake and must not drift back.
const proto = read("src/prototype/new-ui-prototype.css");
const darkAt = proto.indexOf('html[data-theme="dark"] .new-ui-prototype {');
if (darkAt < 0) {
  failures.push("the dark palette block has moved — this gate can no longer see it");
} else {
  const block = proto.slice(darkAt, proto.indexOf("}", darkAt));
  for (const match of block.matchAll(/--(?:np-)?(?:bg|shell|surface|surface-soft|surface-2|surface-3):\s*#([0-9a-f]{6})/gi)) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
    // A surface may lean, but green must not exceed the other channels by
    // more than a whisper or the whole page reads as tinted.
    if (g - Math.max(r, b) > 6) {
      failures.push(`dark surface #${match[1]} is green-tinted (g ${g} vs r ${r}/b ${b}) — surfaces stay neutral, green is the accent`);
    }
  }
}

// ── and no COMPONENT rule keeps the old olive cast either ────────────────
// The token block going neutral was only half the job: about seventy rules
// paint their own dark, and the sidebar kept an olive-black that read green
// against a slate page. Accent tints (correct answers, active tabs) are
// meant to be green and lead by a wide margin; a surface that leads by a
// whisker is the old cast left behind.
{
  const sheets = [
    ["src/prototype/new-ui-prototype.css", proto],
    ["src/index.css", fs.readFileSync(path.join(root, "src/index.css"), "utf8")],
  ];
  for (const [name, css] of sheets) {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\s+/g, " ").trim();
      if (!selector.includes('[data-theme="dark"]')) continue;
      for (const decl of rule[2].split(";")) {
        if (!/^\s*background(-color)?\s*:/.test(decl)) continue;
        for (const colour of decl.matchAll(/#([0-9a-f]{6})\b|rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/gi)) {
          const ch = colour[1]
            ? [0, 2, 4].map((i) => parseInt(colour[1].slice(i, i + 2), 16))
            : [colour[2], colour[3], colour[4]].map(Number);
          if (Math.max(...ch) > 90) continue;          // not a dark surface
          const lead = ch[1] - Math.max(ch[0], ch[2]);
          if (lead > 0 && lead <= 12) {
            failures.push(`${name}: "${selector.slice(0, 60)}" paints a faintly olive dark (r${ch[0]} g${ch[1]} b${ch[2]}) — surfaces are slate, green is the accent`);
          }
        }
      }
    }
  }
}

if (failures.length) {
  console.error("FAIL check-theme-control");
  failures.forEach((line) => console.error("  " + line));
  process.exit(1);
}
console.log("check-theme-control: dark mode is reachable from Appearance, paints from the first frame, follows the OS, and its surfaces stay neutral");
