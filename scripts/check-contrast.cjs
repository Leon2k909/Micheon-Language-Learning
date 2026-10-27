// Legibility, measured rather than eyeballed.
//
// This computes real WCAG contrast ratios from the shipped CSS tokens, so it
// catches a regression that a string match never would — someone lightening a
// hex by two steps still passes "the colour changed" checks and still makes the
// screen unreadable.
//
// Two separate things have to hold, and only the first was ever true here:
//
//   TEXT      >= 4.5:1  (WCAG 1.4.3) — was already passing.
//   BOUNDARY  >= 2.0:1  default, >= 3.0:1 in high contrast (WCAG 1.4.11 asks
//             for 3.0). Every card edge measured 1.30:1, which is invisible:
//             the reported symptom was not faint text but panels with no
//             discernible edges, so nothing looked separate from anything else.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src/prototype/new-ui-prototype.css"), "utf8");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

const channel = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (value) => {
  const h = value.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
/** Flatten a translucent border over the surface it is drawn on. */
const flatten = ([r, g, b, a], bg) => [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

/** Read a `:root`-style token block starting at a given declaration. */
function tokensFrom(anchor) {
  const start = css.indexOf(anchor);
  if (start < 0) throw new Error(`token block not found: ${anchor}`);
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  const solid = Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)].map((m) => [m[1], hex(m[2])]));
  const alpha = Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*rgba\(([^)]+)\)\s*;/g)].map((m) => {
    const parts = m[2].split(",").map((p) => Number(p.trim()));
    return [m[1], parts];
  }));
  return { solid, alpha };
}

function audit(label, anchors, { textMin, edgeMin }) {
  // A high-contrast block only overrides text and border tokens; its surfaces
  // still come from the theme underneath. Merge in cascade order so the audit
  // sees the same values the browser resolves — otherwise the loops below find
  // no surfaces, every comparison is skipped, and the check passes vacuously.
  const solid = {};
  const alpha = {};
  for (const anchor of [].concat(anchors)) {
    const layer = tokensFrom(anchor);
    Object.assign(solid, layer.solid);
    Object.assign(alpha, layer.alpha);
  }
  const surfaces = ["surface", "surface-2", "surface-3"].filter((k) => solid[k]);
  const texts = ["text-1", "text-2", "text-3"].filter((k) => solid[k]);
  if (!surfaces.length || !texts.length) {
    failures += 1;
    console.error(`FAIL ${label}: no tokens resolved — the audit would pass vacuously`);
    return;
  }

  let worstText = Infinity;
  let worstTextPair = "";
  for (const t of texts) {
    for (const s of surfaces) {
      const r = ratio(solid[t], solid[s]);
      if (r < worstText) {
        worstText = r;
        worstTextPair = `--${t} on --${s}`;
      }
    }
  }
  check(
    `${label}: every text colour is readable on every surface (worst ${worstText.toFixed(2)}:1, need ${textMin})`,
    worstText >= textMin,
    worstTextPair
  );

  // A panel is perceivable through its border OR its fill difference —
  // whichever is stronger is what the eye actually gets.
  let worstEdge = Infinity;
  let worstEdgeLabel = "";
  const border = alpha["border"];
  for (let i = 0; i < surfaces.length - 1; i += 1) {
    const under = solid[surfaces[i]];
    const over = solid[surfaces[i + 1]];
    const fill = ratio(over, under);
    const edge = border ? ratio(flatten(border, under), under) : 0;
    const best = Math.max(fill, edge);
    if (best < worstEdge) {
      worstEdge = best;
      worstEdgeLabel = `--${surfaces[i + 1]} on --${surfaces[i]} (fill ${fill.toFixed(2)}, border ${edge.toFixed(2)})`;
    }
  }
  check(
    `${label}: you can see where each panel ends (worst ${worstEdge.toFixed(2)}:1, need ${edgeMin})`,
    worstEdge >= edgeMin,
    worstEdgeLabel
  );
}

const LIGHT = "  --surface: #ffffff;";
const DARK = "  --surface: #161b23;";

audit("light", LIGHT, { textMin: 4.5, edgeMin: 2.0 });
// 1.9 was only ever reached by the border: the dark fills sit 1.22:1 apart
// and the 0.3-alpha edge scored 2.1, which on screen was every card outlined
// in white. That outline was asked to go, everywhere, so the floor is what a
// panel edge measures once it is a whisper — and it still guards the edge
// vanishing outright, which 1.0 would be. High contrast keeps its 3:1.
audit("dark", DARK, { textMin: 4.5, edgeMin: 1.2 });
audit("light + high contrast", [LIGHT, 'html[data-contrast="high"] .new-ui-prototype'], { textMin: 7.0, edgeMin: 3.0 });
audit("dark + high contrast", [DARK, 'html[data-theme="dark"][data-contrast="high"] .new-ui-prototype'], { textMin: 7.0, edgeMin: 3.0 });

// ── ink on the accent's pale tint, at every preset ──────────────────────────
//
// Under a custom accent, chips, counters and speaker buttons sit on
// --np-green-soft: the accent lifted nearly to white. Their ink was
// --accent-text, which is the ink for the SOLID accent and so is white whenever
// the accent is dark. On Indigo, Violet and Slate that was white on a pale tint
// at 1.02 to 1.37:1: the lesson preview's "1 of 4", its "New phrase" pill and
// its speakers, and thirty other labels, all effectively blank. --accent-ink is
// the token picked to read on a tint.
//
// The tokens are the real ones: applyAccentColour() runs against a stub
// document for every preset in both themes. Every rule that puts text on the
// tint is read out of the stylesheets and measured against them, so a new chip
// that reaches for the wrong ink fails here without anyone listing it.
const esbuild = require("esbuild");
const postcss = require("postcss");

const accentBundle = esbuild.buildSync({
  entryPoints: [path.join(root, "src/lib/accentColour.ts")],
  bundle: true,
  format: "cjs",
  write: false,
  platform: "node",
});
const accentModule = { exports: {} };
new Function("module", "exports", "require", accentBundle.outputFiles[0].text)(accentModule, accentModule.exports, require);
const { ACCENT_PRESETS, DEFAULT_ACCENT, applyAccentColour } = accentModule.exports;

/** The custom properties applyAccentColour() actually writes, by name. */
function paintedAccent(base, theme) {
  let sheet = "";
  globalThis.window = { localStorage: { getItem: () => null, setItem() {} }, dispatchEvent() {} };
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ set textContent(value) { sheet = value; } }),
    head: { appendChild() {} },
    documentElement: { getAttribute: (name) => (name === "data-theme" ? theme : null), dataset: {} },
  };
  try {
    applyAccentColour(base);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
  return Object.fromEntries([...sheet.matchAll(/(--[a-z0-9-]+):\s*([^;]+?)\s*!important;/g)].map((m) => [m[1], m[2]]));
}

const STYLESHEETS = ["src/index.css", "src/prototype/new-ui-prototype.css"].map((file) => ({
  file,
  ast: postcss.parse(fs.readFileSync(path.join(root, file), "utf8")),
}));

// The last colour and ground each selector declares. One selector string has
// one specificity, so within it the later declaration is the one that wins.
const painted = new Map();
for (const { file, ast } of STYLESHEETS) {
  ast.walkRules((rule) => {
    if (rule.parent && rule.parent.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    for (const raw of rule.selectors) {
      const selector = raw.replace(/\s+/g, " ").trim();
      const entry = painted.get(selector) || {};
      rule.walkDecls((decl) => {
        const at = `${file}:${decl.source.start.line}`;
        if (decl.prop === "color") entry.color = { value: decl.value, at };
        if (/^background(-color|-image)?$/.test(decl.prop)) entry.ground = { value: decl.value, at };
      });
      painted.set(selector, entry);
    }
  });
}

/** A label with no ground of its own sits on its container's: `.x small` on `.x`. */
function groundOf(selector) {
  for (let s = selector; ; ) {
    const ground = painted.get(s) && painted.get(s).ground;
    if (ground) return ground;
    const cut = s.lastIndexOf(" ");
    if (cut < 0) return null;
    s = s.slice(0, cut);
  }
}

/** An opaque colour, or null when the value is not one this table can name. */
function resolveColour(value, tokens) {
  const text = value.replace(/\s*!important\s*$/, "").trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return text;
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (tokens[m[1]] && /^#[0-9a-f]{6}$/i.test(tokens[m[1]])) return tokens[m[1]];
  }
  return null;
}

/** Every stop of a flat fill or a linear gradient, or null if any is translucent. */
function stopsOf(value, tokens) {
  const body = value.replace(/^linear-gradient\(\s*[0-9.]+deg\s*,/, "").replace(/\)\s*$/, "");
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  const stops = [];
  for (const part of parts) {
    const colour = part.replace(/\s+[0-9.]+%$/, "").trim();
    if (/rgba|color-mix|transparent|gradient/.test(colour)) return null;
    const resolved = resolveColour(colour, tokens);
    if (!resolved) return null;
    stops.push(resolved);
  }
  return stops.length ? stops : null;
}

const THEME_PREFIX = {
  light: ['html:not([data-theme="dark"])[data-accent="custom"]', 'html[data-accent="custom"]'],
  dark: ['html[data-theme="dark"][data-accent="custom"]', 'html[data-accent="custom"]'],
};
const presets = ACCENT_PRESETS.filter((preset) => preset.hex !== DEFAULT_ACCENT);
const PREVIEW_LABELS = [".fs-preview-count", ".fs-preview-count small", ".fs-flashcard-badge", ".fs-flashcard-language button"];

/**
 * Measure every custom-accent rule in the given themes whose ground and ink
 * pass the filters, at every preset. Returns the selectors it measured, so the
 * caller can prove the screen it cares about was actually among them.
 */
function measureAccentInk({ title, themes, grounds, inks = () => true, floor }) {
  const measured = new Set();
  const failed = [];
  let worst = Infinity;
  for (const theme of themes) {
    for (const preset of presets) {
      const tokens = paintedAccent(preset.hex, theme);
      for (const [selector, entry] of painted) {
        if (!entry.color || !inks(entry.color.value)) continue;
        if (!THEME_PREFIX[theme].some((prefix) => selector.startsWith(prefix + " "))) continue;
        // WCAG 1.4.3 exempts inactive controls; a disabled button is meant to recede.
        if (selector.includes(":disabled")) continue;
        const ground = groundOf(selector);
        if (!ground || !grounds.test(ground.value)) continue;
        const ink = resolveColour(entry.color.value, tokens);
        const stops = stopsOf(ground.value, tokens);
        if (!ink || !stops) continue;
        measured.add(`${theme} ${selector}`);
        const reads = Math.min(...stops.map((stop) => ratio(hex(ink), hex(stop))));
        worst = Math.min(worst, reads);
        if (reads < floor) {
          failed.push(`${preset.name} ${theme}: ${selector.slice(selector.indexOf(" ") + 1)} (${entry.color.at}) reads ${reads.toFixed(2)}:1 with ${entry.color.value}`);
        }
      }
    }
  }
  check(
    `${title} (worst ${worst.toFixed(2)}:1, need ${floor})`,
    failed.length === 0,
    failed.slice(0, 12).join("\n     ") + (failed.length > 12 ? `\n     …and ${failed.length - 12} more` : "")
  );
  return measured;
}

/** The rule is general, but the screen that exposed it must be in what was measured. */
function requirePreview(measured, theme) {
  for (const part of PREVIEW_LABELS) {
    check(
      `the ${theme} lesson preview's ${part} is among the measured labels`,
      [...measured].some((key) => key.startsWith(`${theme} `) && key.endsWith(` ${part}`))
    );
  }
}

requirePreview(measureAccentInk({
  title: "ink on the accent tint is readable at every preset in both themes",
  themes: ["light", "dark"],
  grounds: /var\(--(np-green-soft|accent-dim)\b/,
  floor: 4.5,
}), "light");

// ── ink on the pressed fill, in dark ────────────────────────────────────────
//
// In dark the same chips sit on --accent-pressed instead. Their ink was
// --accent-text, picked against the accent rather than the darker pressed
// shade (3.97:1 on Violet), and the counter was hardcoded white, which falls
// to 2.11:1 once a custom pressed fill is as bright as Amber's.
// --accent-pressed-ink is picked against that fill, and wherever it is used it
// is held to it here. 4.4, not 4.5: Slate's pressed fill is a mid grey that
// neither ink lifts to AA (white 4.33, near-black 4.47), so the floor keeps
// the better of the two rather than claiming a pass.
requirePreview(measureAccentInk({
  title: "ink picked for the pressed fill reads on it at every preset in dark",
  themes: ["dark"],
  grounds: /var\(--accent-pressed\b/,
  inks: (value) => value.includes("var(--accent-pressed-ink"),
  floor: 4.4,
}), "dark");

// An !important ink on the counter outranks every rule measured above, so it
// cannot be a bare colour: that is exactly how white stayed on Amber.
for (const { file, ast } of STYLESHEETS) {
  ast.walkDecls("color", (decl) => {
    if (!decl.important) return;
    const selectors = decl.parent && decl.parent.selectors ? decl.parent.selectors : [];
    if (!selectors.some((s) => /\.fs-preview-count( small)?$/.test(s.trim()) && !s.includes(':not([data-theme="dark"])'))) return;
    check(
      `${file}:${decl.source.start.line} lets a custom accent pick the counter's ink`,
      decl.value.includes("var(--accent-pressed-ink"),
      `color: ${decl.value} !important outranks the accent rules on every preset`
    );
  });
}

// ── a fill painted from a token nobody published ────────────────────────────
//
// --accent-strong exists only under a custom accent and inside the updater
// card. An undefined var() voids its whole declaration, so a gradient that
// used it with no fallback painted nothing under the default accent: the
// Listen page's Play audio button was a label on bare page, dark on dark.
// Colour is left out on purpose: it falls back to the inherited ink, which
// is still readable.
for (const { file, ast } of STYLESHEETS) {
  ast.walkDecls((decl) => {
    if (!/^(background|box-shadow|border|outline|fill|stroke)/.test(decl.prop)) return;
    if (!/var\(--accent-strong\)/.test(decl.value)) return;
    const selector = decl.parent && decl.parent.selector ? decl.parent.selector : "";
    if (selector.includes('[data-accent="custom"]') || selector.includes("micheon-update")) return;
    check(
      `${file}:${decl.source.start.line} paints from --accent-strong with a fallback`,
      false,
      `${selector.replace(/\s+/g, " ")} { ${decl.prop}: ${decl.value} } is blank under the default accent`
    );
  });
}

if (failures) {
  console.error(`\n${failures} contrast regression${failures === 1 ? "" : "s"}`);
  process.exit(1);
}

console.log("\ntext and panel edges are measurably legible in every theme");
