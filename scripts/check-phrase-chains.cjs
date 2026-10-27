#!/usr/bin/env node
/**
 * Chained phrases must actually chain.
 *
 * A phrase marked `buildsOn` extends one the learner meets earlier — the
 * point is that "Ich weiß nicht." is followed by "Ich weiß nicht, ob ich das
 * schaffe.", so the short phrase is learned first and then how to finish the
 * thought. Three promises are pinned here:
 *
 *   1. every buildsOn target resolves to a real course sentence — an orphan
 *      link means the extension silently falls back to its own (distant) rank;
 *   2. in the global course order, an extension sits directly after its base;
 *   3. a lesson on the chains pack serves base and extension side by side.
 */
const path = require("path");
const Module = require("module");
const root = path.join(__dirname, "..");
const esbuild = require("esbuild");

function load(entry, name) {
  const built = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: root, sourcefile: name + ".ts" },
    alias: { "@": path.join(root, "src") },
    bundle: true, format: "cjs", platform: "node", target: "node20",
    write: false, logLevel: "silent",
  });
  const mod = new Module(path.join(root, name + ".cjs"), module);
  mod.paths = Module._nodeModulePaths(root);
  mod._compile(built.outputFiles[0].text, path.join(root, name + ".cjs"));
  return mod.exports;
}

const { buildSession, resolveChainScores } = load(
  `export { buildSession, resolveChainScores } from "./src/session.ts";`, "chains-a");
const { allPartBlueprints } = load(
  `export { allPartBlueprints } from "./src/lib/data.ts";`, "chains-b");
const { sentenceIdentityKey } = load(
  `export { sentenceIdentityKey } from "./src/lib/germanTextMatch.ts";`, "chains-c");
const { buildCorpusIndex, sentenceCommonality } = load(
  `export { buildCorpusIndex, sentenceCommonality } from "./src/lib/corpusFrequency.ts";`, "chains-d");
const { conversationPriorityScore } = load(
  `export { conversationPriorityScore } from "./src/lib/conversationPriority.ts";`, "chains-e");

const failures = [];
const keyOf = (text) => sentenceIdentityKey(String(text || "")).toLowerCase();

// ── 1. every buildsOn resolves ─────────────────────────────────────────────
const identities = new Set();
const chained = [];
for (const [partKey, part] of Object.entries(allPartBlueprints)) {
  const note = (de) => { const k = keyOf(de); if (k) identities.add(k); };
  for (const ph of part?.phrases ?? []) { note(ph?.de); if (ph?.buildsOn) chained.push({ partKey, de: ph.de, buildsOn: ph.buildsOn }); }
  for (const word of part?.vocab ?? []) note(word?.example);
  for (const d of part?.dialogues ?? []) for (const line of d?.lines ?? []) note(line?.de);
}
if (chained.length < 10) {
  failures.push(`only ${chained.length} chained phrases found — the chains pack should provide at least 17`);
}
for (const { de, buildsOn } of chained) {
  if (!identities.has(keyOf(buildsOn))) {
    failures.push(`"${de}" builds on "${buildsOn}", which is not a sentence anywhere in the course`);
  }
}

// ── 2. global order: extension directly after base ─────────────────────────
const index = buildCorpusIndex(allPartBlueprints);
const rows = [];
for (const [partKey, part] of Object.entries(allPartBlueprints)) {
  const push = (de, kind, lessonPriority, buildsOn) => {
    const text = String(de || "").trim();
    if (!text) return;
    rows.push({
      de: text, buildsOn,
      score: conversationPriorityScore({
        partKey, kind,
        commonality: sentenceCommonality(text, index),
        lessonPriority,
      }),
    });
  };
  for (const ph of part?.phrases ?? []) push(ph?.de, "phrase", ph?.lessonPriority, ph?.buildsOn);
  for (const word of part?.vocab ?? []) push(word?.example, "vocab");
  for (const d of part?.dialogues ?? []) for (const line of d?.lines ?? []) push(line?.de, "dialogue");
}
resolveChainScores(rows);
rows.sort((a, b) => a.score - b.score);
const positionOf = new Map();
rows.forEach((row, i) => { const k = keyOf(row.de); if (!positionOf.has(k)) positionOf.set(k, i); });
let worstGap = 0;
for (const row of rows) {
  if (!row.buildsOn) continue;
  const base = positionOf.get(keyOf(row.buildsOn));
  const ext = positionOf.get(keyOf(row.de));
  if (base == null || ext == null) continue;
  const gap = ext - base;
  worstGap = Math.max(worstGap, Math.abs(gap));
  if (gap <= 0) failures.push(`"${row.de}" is ranked BEFORE its base "${row.buildsOn}"`);
  else if (gap > 3) failures.push(`"${row.de}" sits ${gap} places after its base — the chain is broken`);
}

// ── 3. a lesson serves base then extension side by side ────────────────────
const part = { ...allPartBlueprints.part380, partKey: "part380" };
if (!part.label) {
  failures.push("part380 (the chains pack) is missing");
} else {
  const review = {};
  const later = () => new Date(Date.now() + 400 * 864e5).toISOString();
  // Where (lesson, slot) each sentence was served, walking the pack the way a
  // learner would. An extension is on time if it appears in the SAME lesson as
  // its base, immediately after it, or leads off the NEXT lesson — a pair
  // whose base landed in the last fresh slot straddles the boundary by design.
  const servedAt = new Map();
  for (let lesson = 0; lesson < 40; lesson += 1) {
    const steps = buildSession(part, [], review, 0);
    // Conversation mode renders the served German -- the ich-form -e and the
    // grammar commas both go -- while buildsOn names the AUTHORED sentence.
    // Both spellings are recorded so a chain is still found by either name,
    // which is exactly what the engine itself does via originalDe.
    const fresh = steps.filter((s) => s.type === "sentence" && !s.review)
      .map((s) => [String(s.item?.de ?? ""), String(s.item?.originalDe ?? s.item?.de ?? "")]);
    if (!fresh.length) break;
    fresh.forEach(([de, authored], slot) => { for (const k of new Set([keyOf(de), keyOf(authored)])) { if (k && !servedAt.has(k)) servedAt.set(k, { lesson, slot }); } });
    for (const step of steps) {
      if (step.item?.id) review[step.item.id] = { lastGrade: "know", successes: 6, intervalDays: 180, dueAt: later(), updatedAt: new Date().toISOString() };
      for (const line of step.dialogue?.lines ?? []) if (line?.id) review[line.id] = { lastGrade: "know", successes: 6, intervalDays: 180, dueAt: later(), updatedAt: new Date().toISOString() };
    }
  }
  let checkedPairs = 0;
  for (const ph of part.phrases ?? []) {
    if (!ph?.buildsOn) continue;
    const base = servedAt.get(keyOf(ph.buildsOn));
    const ext = servedAt.get(keyOf(ph.de));
    if (!base || !ext) continue; // external bases live in other packs
    checkedPairs += 1;
    const sameLessonAdjacent = ext.lesson === base.lesson && ext.slot === base.slot + 1;
    const nextLessonLead = ext.lesson === base.lesson + 1 && ext.slot === 0;
    if (!sameLessonAdjacent && !nextLessonLead) {
      failures.push(`"${ph.de}" was served at lesson ${ext.lesson} slot ${ext.slot}, but its base sat at lesson ${base.lesson} slot ${base.slot}`);
    }
  }
  if (checkedPairs < 12) {
    failures.push(`only ${checkedPairs} in-pack pairs were both served — the walk should cover every chain`);
  }
}

// ── 4. the Continue Learning path serves chains adjacently ────────────────
// Replicates the guided selection (full apiParts, real scoring, real mix)
// and walks the first dozen lessons of a fresh learner: whenever a chain
// base is served, its extension must arrive in the same lesson.
{
  const { selectContinueLearningMix, orderWithChains } = load(
    `export { selectContinueLearningMix, orderWithChains } from "./src/session.ts";`, "chains-f");
  const { buildCatalog } = load(`export { buildCatalog } from "./src/session.ts";`, "chains-g");
  const { buildBundledParts } = load(`export { buildBundledParts } from "./src/lib/contentBank.ts";`, "chains-h");
  const { orderParts } = load(`export { orderParts } from "./src/lib/curriculum.ts";`, "chains-i");
  const { buildApiPartFromResolved } = load(`export { buildApiPartFromResolved } from "./src/lib/api.ts";`, "chains-j");
  const { computeAbility, itemDifficulty, itemPriority } = load(
    `export { computeAbility, itemDifficulty, itemPriority } from "./src/lib/ability.ts";`, "chains-k");
  const { statusForId } = load(`export { statusForId } from "./src/lib/activity.ts";`, "chains-l");

  const resolved = {};
  for (const [k, bp] of Object.entries(allPartBlueprints)) resolved[k] = buildApiPartFromResolved(bp, {});
  const apiParts = orderParts({ ...resolved, ...buildBundledParts() });
  const liveCatalog = buildCatalog(apiParts);
  const liveIndex = buildCorpusIndex(apiParts);
  const reviewState = {};
  const know = (id) => { reviewState[id] = { lastGrade: "know", successes: 6, intervalDays: 180, dueAt: new Date(Date.now() + 400 * 864e5).toISOString(), updatedAt: new Date().toISOString() }; };

  const nextFresh = () => {
    const ability = computeAbility(reviewState);
    const chainTargetKeys = new Set();
    liveCatalog.forEach((item) => { if (item.buildsOn) chainTargetKeys.add(keyOf(item.buildsOn)); });
    const chainBaseScores = new Map();
    const candidates = [];
    liveCatalog.forEach((item, i) => {
      const p = apiParts[item.partKey];
      if (!p) return;
      const scoreOf = () => {
        const text = String(item.de || "");
        const commonality = sentenceCommonality(text, liveIndex);
        return conversationPriorityScore({ partKey: item.partKey, kind: item.kind, commonality, lessonPriority: item.lessonPriority })
          + itemPriority({ ability: ability.band, commonality, difficulty: itemDifficulty(p.level, text.trim().split(/\s+/).filter(Boolean).length), own: false }) * 100;
      };
      const keys = [keyOf(item.de), keyOf(item.originalDe || item.de)].filter((k) => k && chainTargetKeys.has(k));
      if (keys.length) {
        const sc = scoreOf();
        for (const k of keys) { const prev = chainBaseScores.get(k); if (prev == null || sc < prev) chainBaseScores.set(k, sc); }
      }
      if (statusForId(reviewState, item.id, item.aliases) !== "new") return;
      candidates.push({ pId: item.partKey, index: i, score: scoreOf(), step: { type: "sentence", item: { ...item, mastery: "new" } } });
    });
    resolveChainScores(candidates.map((c) => ({
      get score() { return c.score; }, set score(v) { c.score = v; },
      de: String(c.step.item.de), originalDe: c.step.item.originalDe, buildsOn: c.step.item.buildsOn,
    })), chainBaseScores);
    candidates.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index));
    const lead = candidates[0];
    const chainAfterLead = [];
    if (lead) {
      let linkKeys = new Set([keyOf(lead.step.item.de), keyOf(lead.step.item.originalDe || lead.step.item.de)]);
      for (let hops = 0; hops < 3; hops += 1) {
        const next = candidates.find((c) => c !== lead && !chainAfterLead.includes(c) && c.step.item.buildsOn && linkKeys.has(keyOf(c.step.item.buildsOn)));
        if (!next) break;
        chainAfterLead.push(next);
        linkKeys = new Set([keyOf(next.step.item.de), keyOf(next.step.item.originalDe || next.step.item.de)]);
      }
    }
    const pinnedChains = lead ? candidates.slice(0, 3).filter((c) => c !== lead && !chainAfterLead.includes(c) && c.step.item.buildsOn) : [];
    const pinnedSet = new Set([...chainAfterLead, ...pinnedChains]);
    const rankedRaw = lead ? [lead, ...chainAfterLead, ...pinnedChains,
      ...candidates.filter((c) => c !== lead && !pinnedSet.has(c) && c.pId === lead.pId),
      ...candidates.filter((c) => c !== lead && !pinnedSet.has(c) && c.pId !== lead.pId)] : [];
    const ranked = orderWithChains(rankedRaw.map((c) => ({ c, de: String(c.step.item.de), originalDe: c.step.item.originalDe, buildsOn: c.step.item.buildsOn }))).map((r) => r.c);
    const { fresh } = selectContinueLearningMix(ranked.map((c) => c.step), [], [], 3, 3, []);
    return fresh.map((s) => ({ de: String(s.item.de), id: s.item.id, originalDe: s.item.originalDe, buildsOn: s.item.buildsOn }));
  };

  let chainsServed = 0;
  for (let lesson = 1; lesson <= 12; lesson += 1) {
    const fresh = nextFresh();
    if (!fresh.length) break;
    fresh.forEach((f, i) => {
      if (!f.buildsOn) return;
      chainsServed += 1;
      const prev = fresh[i - 1];
      const prevKeys = prev ? new Set([keyOf(prev.de), keyOf(prev.originalDe || prev.de)]) : new Set();
      const baseKnown = Object.keys(reviewState).length && !liveCatalog.some((it) =>
        statusForId(reviewState, it.id, it.aliases) === "new"
        && (keyOf(it.de) === keyOf(f.buildsOn) || keyOf(it.originalDe || it.de) === keyOf(f.buildsOn)));
      if (!prevKeys.has(keyOf(f.buildsOn)) && !baseKnown) {
        failures.push(`lesson ${lesson}: "${f.de}" served without its base beside it or already learned`);
      }
    });
    fresh.forEach((f) => know(f.id));
  }
  if (chainsServed < 1) {
    failures.push("twelve Continue Learning lessons served no chained phrase at all");
  }
}

// ── every planned language has drawn flag art ──────────────────────────────
// (Windows shows flag emoji as bare letter pairs, so the picker draws SVGs.)
const fs = require("fs");
const catalogueSource = fs.readFileSync(path.join(root, "src/lib/languageCatalogue.ts"), "utf8");
const flagSource = fs.readFileSync(path.join(root, "src/components/course/FlagRoundel.tsx"), "utf8");
const plannedIds = [...catalogueSource.matchAll(/\{ id: "([a-z-]+)"/g)].map((m) => m[1]);
for (const id of plannedIds) {
  // Ids are plain [a-z-], so the only quoting question is the TS key syntax.
  const asKey = id.includes("-") ? `"${id}"` : id;
  if (!flagSource.includes(`\n  ${asKey}: `) && !flagSource.includes(`\n  ${asKey}:`)) {
    failures.push(`language "${id}" has no drawn flag — Windows will show letter pairs for it`);
  }
}

// ── 5. and the component actually runs that pipeline ──────────────────────
// Section 4 replicates the logic; these string checks make sure the replica
// and the component cannot drift apart silently.
{
  const fs = require("fs");
  const guided = fs.readFileSync(path.join(root, "src/guided_learning_session.tsx"), "utf8");
  for (const [what, needle] of [
    ["score inheritance", "resolveChainScores("],
    ["chain regrouping", "orderWithChains(["],
    ["top-slot pinning", "pinnedChains"],
    ["base capture for learned bases", "chainBaseScores"],
  ]) {
    if (!guided.includes(needle)) {
      failures.push("guided_learning_session.tsx no longer uses " + what + " — Continue Learning chains are broken");
    }
  }
  const session = fs.readFileSync(path.join(root, "src/session.ts"), "utf8");
  if (!session.includes("orderWithChains(") || !session.includes("freshRows.sort(")) {
    failures.push("session.ts no longer regroups chains in the per-pack path");
  }
}

// ── 4. the chains nobody authored — "I, I have, I have a bike" ───────────
{
  const { deriveImplicitChains } = load(
    `export { deriveImplicitChains } from "./src/session.ts";`, "chains-e");
  const rows = [
    { de: "Ich habe." },
    { de: "Ich habe ein Fahrrad." },
    { de: "Ich habe ein Fahrrad, aber es ist kaputt und ich brauche dringend ein Werkzeug." },
    { de: "Ich habe ein rotes Fahrrad." },
    { de: "Ich habe ein neues Fahrrad." },
    { de: "Ich habe ein altes blaues Fahrrad." },
    { de: "Ich habe ein sehr schönes grünes Fahrrad." },
    { de: "Ich habe Hunger.", buildsOn: "Etwas ganz anderes." },
  ];
  deriveImplicitChains(rows);
  if (rows[1].buildsOn !== "Ich habe.") {
    failures.push("a word-boundary prefix sentence is not derived as the base of its extension");
  }
  if (rows[2].buildsOn) {
    failures.push("an extension adding more than four words was chained anyway — that is a different sentence");
  }
  if (rows[7].buildsOn !== "Etwas ganz anderes.") {
    failures.push("an authored buildsOn was overwritten by the derived chains");
  }
  const fahrradExtensions = rows.slice(3, 7).filter((row) => row.buildsOn === "Ich habe.").length
    + (rows[1].buildsOn === "Ich habe." ? 1 : 0);
  if (fahrradExtensions > 3) {
    failures.push(`a base carries ${fahrradExtensions} derived extensions — the three-per-base cap has died`);
  }
  const guided = fs.readFileSync(path.join(root, "src/guided_learning_session.tsx"), "utf8");
  if (!guided.includes("deriveImplicitChains(")) {
    failures.push("Continue Learning no longer derives the unauthored chains");
  }
  // Derived over the WHOLE catalogue, before chainTargetKeys is seeded.
  // Deriving from the unseen pool alone undid the feature the moment it
  // worked: once a base was learned it dropped out of the pool, so nothing
  // carried its extension forward and the extension fell back to its own
  // (usually terrible) rank — 42,038,145 for "Passt das alles ins Auto?"
  // against the 638,003 it inherits from "Passt das?".
  if (!/deriveImplicitChains\(derivedRows\)[\s\S]{0,600}const chainTargetKeys/.test(guided)) {
    failures.push("chains are no longer derived over the whole catalogue before the base scores are collected");
  }
  if (!/chainTargetKeys\.add\(sentenceIdentityKey\(String\(buildsOn\)\)/.test(guided)) {
    failures.push("derived chains no longer contribute their bases to the score-inheritance lookup");
  }
  // A heavy review backlog cuts the fresh half to ONE slot, which serves a
  // base and drops its extension — the pair is the whole point, so it claims
  // a second slot from the review half rather than being split.
  // Pairing happens on the cards ACTUALLY chosen, not on candidate positions:
  // the picker skips collisions, so position arithmetic protected the wrong
  // base and left the real last one unpaired three sittings running.
  // The one exception: inside a conversation or similar-sentences block the
  // extension waits until the block ends, so a question keeps its answer.
  if (!/for \(const step of fresh\)[\s\S]{0,900}\(blockSteps\.has\(step\) \? heldExtensions : pairedFresh\)\.push\(extension\.step\)/.test(guided)
    || !/pairedFresh\.push\(\.\.\.heldExtensions\)/.test(guided)) {
    failures.push("extensions are no longer inserted directly behind the served base");
  }
  if (!/reviews\.length = Math\.min\(reviews\.length, sittingRoom\)/.test(guided)) {
    failures.push("the sitting no longer stays six when a pair displaces a card");
  }
  if (/extendsPrevious\(sittingMix\.freshSlots\)/.test(guided)) {
    failures.push("the unreliable candidate-position slot borrow is back");
  }

  // The extension takes a SHORTER route: its words were just taught, so the
  // introduce-from-cold recognition stages are spent. Only an extension whose
  // base is in the same sitting earns it.
  const { CHAINED_SENTENCE_PHASES, SENTENCE_PHASES, buildSentencePhaseRoute } = load(
    `export { CHAINED_SENTENCE_PHASES, SENTENCE_PHASES, buildSentencePhaseRoute } from "./src/lib/guidedLessonPhases.ts";`,
    "chains-f"
  );
  if (!(CHAINED_SENTENCE_PHASES.length < SENTENCE_PHASES.length)) {
    failures.push("the chained route is no shorter than meeting a sentence cold");
  }
  for (const spent of ["MeaningSelect", "ListenPick", "MissingWord"]) {
    if (CHAINED_SENTENCE_PHASES.includes(spent)) {
      failures.push(`the chained route repeats ${spent}, which its base already taught`);
    }
  }
  for (const kept of ["Read", "Type", "RecallBoth"]) {
    if (!CHAINED_SENTENCE_PHASES.includes(kept)) {
      failures.push(`the chained route dropped ${kept} — it must still produce and recall the fuller sentence`);
    }
  }
  const chainedRoute = buildSentencePhaseRoute({ mastered: false, bilingual: false, audioMuted: false, chained: true });
  const coldRoute = buildSentencePhaseRoute({ mastered: false, bilingual: false, audioMuted: false });
  if (chainedRoute.length >= coldRoute.length) {
    failures.push(`the built chained route is not shorter (${chainedRoute.length} vs ${coldRoute.length})`);
  }
  if (!guided.includes("item.chainedFromLesson = true") || !guided.includes("servedKeys.has(base)")) {
    failures.push("the short route is no longer limited to extensions whose base is in the same sitting");
  }

  // "Know it" on a base is a request for MORE of that sentence: the freed
  // preview slot goes to its extension before the general ranking is asked.
  if (!/chainedReplacement\s*\?\?\s*pickPreviewReplacement\(/.test(guided)) {
    failures.push("mastering a preview card no longer offers that card's own extension first");
  }
  if (!/chainedReplacement \? \{ chainedFromLesson: true \}/.test(guided)) {
    failures.push("an extension swapped in after Know it should take the short route too");
  }
}

// A chain can only exist between sentences the course actually teaches, so
// the machinery working is not the same as a learner meeting a base first.
// Two long sentences were being met cold, with no shorter card between them
// and the learner: "Ich geh gerne ins Kino" wants "we cant" and "i like
// going" ahead of it. Those bases are cards now; this is the pin that they stay
// cards, and that the deriver still pairs them.
{
  const { allPartBlueprints, buildApiPartFromResolved, buildBundledParts, buildTatoebaParts, deriveImplicitChains } = load(
    [
      'export { allPartBlueprints } from "./src/lib/data.ts";',
      'export { buildApiPartFromResolved } from "./src/lib/api.ts";',
      'export { buildBundledParts, buildTatoebaParts } from "./src/lib/contentBank.ts";',
      'export { deriveImplicitChains } from "./src/session.ts";',
    ].join("\n"),
    "chains-catalogue"
  );
  const resolved = Object.fromEntries(
    Object.entries(allPartBlueprints).map(([key, blueprint]) => [key, buildApiPartFromResolved(blueprint, {})])
  );
  const parts = { ...resolved, ...buildBundledParts(), ...buildTatoebaParts() };
  const rows = [];
  for (const [partKey, part] of Object.entries(parts)) {
    for (const [index, item] of (part.phrases || []).entries()) {
      if (item && item.de) rows.push({ id: partKey + "-" + index, de: String(item.de), score: rows.length });
    }
  }
  deriveImplicitChains(rows);

  const WANT = [
    ["Wir können das nicht tun.", "Wir können das nicht."],
    ["Ich gehe gerne ins Kino.", "Ich gehe gerne."],
  ];
  for (const [extension, base] of WANT) {
    const row = rows.find((r) => r.de === extension);
    if (!row) {
      failures.push('"' + extension + '" is no longer in the course, so its chain cannot be checked');
    } else if (row.buildsOn !== base) {
      failures.push('"' + extension + '" should be taught after "' + base + '", not cold (got ' + (row.buildsOn ? '"' + row.buildsOn + '"' : "no base") + ")");
    }
  }

  // The building blocks earn their place by what they carry. If this collapses,
  // someone has removed bases rather than broken the deriver.
  const carried = rows.filter((r) => r.buildsOn).length;
  if (carried < 200) {
    failures.push("only " + carried + " sentences have a base to learn first; the building-block pack used to give over 200");
  }
}

if (failures.length) {
  console.error("FAIL check-phrase-chains");
  failures.forEach((line) => console.error("  " + line));
  process.exit(1);
}
console.log(`check-phrase-chains: ${chained.length} chained phrases all resolve, worst base→extension gap ${worstGap}, lessons serve pairs adjacently, and prefix sentences chain themselves (capped at three per base)`);
