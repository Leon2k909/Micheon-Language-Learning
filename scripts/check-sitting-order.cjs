/**
 * Continue learning can be told how to put a sitting together, and Listen can
 * be told to play similar sentences together.
 *
 * The guided session had one fixed answer — the course's pick — while Listen
 * had a whole panel of orders. Now both read the same idea: an order decides
 * what comes first and still teaches everything; levels decide what a sitting
 * draws on at all. And "similar sentences together" is one shape at a time —
 * every "Ich möchte …", then every "Kannst du …" — in both places.
 *
 * Checked against the real modules and the real catalogue, not a copy.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// A browser-shaped corner for the modules that keep settings in storage.
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.window = { localStorage: global.localStorage, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
global.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
global.navigator = { language: "en-GB", onLine: true };

const built = esbuild.buildSync({
  stdin: {
    contents: [
      'export * as order from "./src/lib/sittingOrder.ts";',
      'export { sentencePattern, sharesPattern } from "./src/lib/sentencePattern.ts";',
      'export { buildExchangeIndex, exchangeChain, exchangeKey, exchangePlace, repliesTo } from "./src/lib/exchanges.ts";',
      'export { selectContinueLearningMix, pickReviews } from "./src/session.ts";',
      'export { buildListenQueue, LISTEN_QUEUE_ORDERS } from "./src/lib/listenMode.ts";',
      'export { allPartBlueprints } from "./src/lib/data.ts";',
      'export { buildApiPartFromResolved } from "./src/lib/api.ts";',
      'export { buildBundledParts, buildTatoebaParts } from "./src/lib/contentBank.ts";',
      // For asking the SITTING the question Listen is asked, rather than
      // reading the source and hoping.
      'export { buildCatalog, orderWithChains, deriveImplicitChains } from "./src/session.ts";',
      'export { takeMatchingSafe } from "./src/lib/germanTextMatch.ts";',
      'export { conversationPriorityScore } from "./src/lib/conversationPriority.ts";',
      'export { buildCorpusIndex, sentenceCommonality } from "./src/lib/corpusFrequency.ts";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "sitting-order-check-entry.ts",
  },
  alias: { "@": path.join(root, "src") },
  bundle: true, format: "cjs", platform: "node", target: "node20", write: false, logLevel: "silent",
});
const compiled = new Module("sitting-order-check", module);
compiled.filename = path.join(root, ".sitting-order-check.cjs");
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(built.outputFiles[0].text, compiled.filename);
const { order: O, sentencePattern, sharesPattern, buildExchangeIndex, exchangeChain, exchangeKey, exchangePlace, repliesTo, selectContinueLearningMix, pickReviews, buildListenQueue, LISTEN_QUEUE_ORDERS, allPartBlueprints, buildApiPartFromResolved, buildBundledParts, buildTatoebaParts, buildCatalog, orderWithChains, deriveImplicitChains, takeMatchingSafe, conversationPriorityScore, buildCorpusIndex, sentenceCommonality } = compiled.exports;

const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); failures.push(name); }
};

// ── what "similar" means ────────────────────────────────────────────────────
check("the pattern is the first two words, lowercased, without punctuation",
  sentencePattern("Ich möchte einen Kaffee, bitte.") === "ich möchte"
  && sentencePattern("Kannst du mir helfen?") === "kannst du"
  && sentencePattern("  Wo   ist der Bahnhof? ") === "wo ist");
check("a single word is its own pattern and shares it with nobody",
  sentencePattern("Danke") === "danke" && !sharesPattern("Danke", "Danke") && !sharesPattern("Danke!", "Danke."));
check("two sentences that open the same way share a pattern, and two that do not, do not",
  sharesPattern("Ich möchte zahlen.", "Ich möchte nach Hause.") && !sharesPattern("Ich möchte zahlen.", "Ich habe Hunger."));

// ── the orders the sitting can be given ─────────────────────────────────────
const panel = read("src/components/duo/ContinueLearningSettings.tsx");
const choices = [...panel.matchAll(/\[\s*"([a-z]+)",\s*"([^"]+)"\s*\]/gu)].map((m) => [m[1], m[2]]);
check("every order the panel offers is one the library keeps",
  choices.length >= 6 && choices.every(([value]) => O.SITTING_ORDERS.includes(value)),
  `on screen but rejected: ${choices.filter(([v]) => !O.SITTING_ORDERS.includes(v)).map(([v]) => v).join(", ")}`);
check("every order the library keeps has a button",
  O.SITTING_ORDERS.every((value) => choices.some(([v]) => v === value)),
  `accepted but unreachable: ${O.SITTING_ORDERS.filter((v) => !choices.some(([c]) => c === v)).join(", ")}`);
// ── and the lesson calls each order what the picker calls it ────────────────
// The picker used to be the only place that named an order. The lesson names
// the one that built it now — because Listen and Continue learning each have
// their own order and both offer a Conversation order, so an order set in one
// and expected in the other looks exactly like an order that does not work.
// Two lists of the same seven names drift the first time one is reworded, so
// the picker's list is checked against the library's.
const mislabelled = choices.filter(([value, label]) => O.SITTING_ORDER_LABELS[value] !== label);
check("the picker and the library agree on what every order is called",
  mislabelled.length === 0,
  mislabelled.map(([v, label]) => `${v}: panel "${label}" vs library "${O.SITTING_ORDER_LABELS[v]}"`).join("; "));
check("every order the library keeps has a name",
  O.SITTING_ORDERS.every((value) => Boolean(O.SITTING_ORDER_LABELS[value])));
check("the lesson says which order built the sitting",
  /sittingPlanLabel\(getSittingPlan\(\), ui\)/u.test(read("src/GuidedSession.tsx")),
  "the sitting never says how it was put together, so a setting that did not apply looks like one that does not work");
const explanation = panel.slice(panel.indexOf('ui("The course\'s pick'), panel.indexOf('aria-label={ui("Order")}'));
for (const [, label] of choices) {
  const name = label.replace(/\s*\(.*\)$/u, "");
  check(`the order text explains "${name}"`, explanation.includes(name), "the panel offers it and never says what it does");
}

// ── what each order does ────────────────────────────────────────────────────
const c = (score, index, level, de, commonality) => ({ score, index, level, de, commonality });
const a1worse = c(300, 0, "A1", "Ich möchte einen Tee.", 2);
const b1best = c(100, 1, "B1", "Ich möchte mich beschweren.", 1);
const common = c(200, 2, "A2", "Ich habe Hunger.", 9);
const short = c(250, 3, "A2", "Danke.", 3);
const cands = [b1best, common, short, a1worse];
// One button pressed on an empty plan: the plan that button alone makes.
const plan = (...orders) => orders.reduce((p, order) => O.toggleSittingPlan(p, order), O.DEFAULT_SITTING_PLAN);
const sortBy = (p, list = cands) => [...list].sort(O.sittingComparator(p, list)).map((x) => x.de);
const by = (name) => sortBy(plan(name));
check("the course's pick is the score", by("course")[0] === b1best.de);
check("easiest first takes a worse-scoring A1 before the best-scoring B1",
  by("level")[0] === a1worse.de && by("level").indexOf(b1best.de) === cands.length - 1);
check("most common first ignores level and score", by("common")[0] === common.de);
check("shortest first and longest first go by length",
  by("shortest")[0] === short.de && by("longest")[0] === b1best.de);
check("similar leads with the course's pick", by("similar")[0] === b1best.de);
const mates = O.similarMates(b1best, cands).map((x) => x.de);
check("and its mates are the cards that open the same way, and only those",
  mates.length === 1 && mates[0] === a1worse.de);
check("a single-word lead has no mates", O.similarMates(short, cands).length === 0);

// ── orders combine ──────────────────────────────────────────────────────────
// Ranked sorts: the first decides, the next settles what it leaves level. A
// continuous measure that is not last compares in bands, or the next sort
// would never get a tie to settle.
const band = (n) => Array.from({ length: n }, (_, i) => i);
const pool = [
  // The commonest fifth holds a B1 that is the very commonest, and an A1 just behind it.
  ...band(2).map((i) => c(500 + i, 10 + i, i ? "A1" : "B1", `Gemeinsam ${i} hier.`, i ? 95 : 99)),
  // Everything else is far rarer, and A1.
  ...band(8).map((i) => c(100 + i, 20 + i, "A1", `Selten ${i} hier.`, 10 - i)),
];
const commonThenLevel = sortBy(plan("common", "level"), pool);
check("most common, then easiest: the easiest of the commonest fifth comes first",
  commonThenLevel[0] === "Gemeinsam 1 hier." && commonThenLevel[1] === "Gemeinsam 0 hier.",
  commonThenLevel.slice(0, 3).join(" | "));
check("and the commonest fifth still comes before anything rarer",
  commonThenLevel.slice(0, 2).every((de) => de.startsWith("Gemeinsam")));
check("most common alone is exact: the commonest card leads whatever its level",
  sortBy(plan("common"), pool)[0] === "Gemeinsam 0 hier.");
const levelThenCommon = sortBy(plan("level", "common"), pool);
check("easiest, then most common: all of A1 first, its commonest leading",
  levelThenCommon[0] === "Gemeinsam 1 hier." && levelThenCommon[levelThenCommon.length - 1] === "Gemeinsam 0 hier.");
check("a ranked sort pressed again leaves, and the ones after it move up",
  JSON.stringify(O.toggleSittingPlan(plan("common", "level", "shortest"), "level").sorts) === JSON.stringify(["common", "shortest"]));
check("shortest and longest cannot both hold; the later choice wins",
  JSON.stringify(plan("shortest", "common", "longest").sorts) === JSON.stringify(["common", "longest"]));
const withGrouping = plan("common", "conversation");
check("a grouping sits on top of any ranking, and only one is on at a time",
  withGrouping.grouping === "conversation" && JSON.stringify(withGrouping.sorts) === JSON.stringify(["common"])
  && O.toggleSittingPlan(withGrouping, "similar").grouping === "similar"
  && O.toggleSittingPlan(withGrouping, "conversation").grouping === null);
check("the course's pick clears everything",
  JSON.stringify(O.toggleSittingPlan(withGrouping, "course")) === JSON.stringify(O.DEFAULT_SITTING_PLAN));
const twoRanked = plan("common", "level");
check("the buttons show the ranking: a number only when two or more are ranked",
  O.sittingButtonState(twoRanked, "common").rank === 1 && O.sittingButtonState(twoRanked, "level").rank === 2
  && O.sittingButtonState(plan("common"), "common").rank === null && O.sittingButtonState(twoRanked, "course").on === false
  && O.sittingButtonState(O.DEFAULT_SITTING_PLAN, "course").on === true);
const named = (p) => O.sittingPlanLabel(p, (label) => label);
check("the lesson names a combined plan the way it was built",
  named(plan("common", "level", "conversation")) === "Most common first → Easiest first (A1 → C1) · Conversation order"
  && named(O.DEFAULT_SITTING_PLAN) === "The course's pick" && named(plan("similar")) === "Similar sentences together",
  named(plan("common", "level", "conversation")));

// ── what sticks ─────────────────────────────────────────────────────────────
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
O.setSittingPlan(plan("common", "level", "conversation"), "de-en");
check("the plan is remembered per course, whole",
  same(O.getSittingPlan("de-en"), { sorts: ["common", "level"], grouping: "conversation" })
  && same(O.getSittingPlan("pl-en"), O.DEFAULT_SITTING_PLAN));
check("a stored plan is cleaned on the way in: unknown sorts dropped, repeats once",
  same(O.setSittingPlan({ sorts: ["nonsense", "level", "level"], grouping: "sideways" }, "de-en"), { sorts: ["level"], grouping: null }));
// A learner who chose one order before orders combined keeps it.
localStorage.setItem("gl-sitting-order-v1:fr-en", "similar");
localStorage.setItem("gl-sitting-order-v1:es-en", "longest");
check("a single order chosen before orders combined is read as the plan it meant",
  same(O.getSittingPlan("fr-en"), { sorts: [], grouping: "similar" }) && same(O.getSittingPlan("es-en"), { sorts: ["longest"], grouping: null }));
const kept = O.setSittingLevelFilters(["a1", "b2", "zz"], "de-en");
check("levels are remembered as a set, filtered to real steps",
  kept.size === 2 && kept.has("a1") && kept.has("b2") && O.getSittingLevelFilters("de-en").has("b2"));
check("no levels chosen means every level; chosen levels admit only their own",
  O.passesSittingLevel("B1", new Set()) && O.passesSittingLevel("A1", kept) && !O.passesSittingLevel("B1", kept));

// ── the sitting reads it ────────────────────────────────────────────────────
const sitting = read("src/guided_learning_session.tsx");
check("the sitting sorts its fresh candidates by the chosen plan, banded over those candidates",
  /candidates\.sort\(sittingComparator\(sittingPlan, candidates\)\)/u.test(sitting)
  && /sittingPlan\.grouping === "conversation" \? buildExchangeIndex/u.test(sitting));
check("and drops fresh material outside the chosen levels before scoring it",
  /passesSittingLevel\(item\.level \?\? p\.level, sittingLevels\)/u.test(sitting));
check("similar sentences follow the lead ahead of its pack-mates",
  /similarMates\(lead, candidates\)/u.test(sitting) && /\.\.\.patternMates,\s*\n\s*(?:\.\.\.exchangeMates,\s*\n\s*)?(?:\/\/[^\n]*\n\s*)*\.\.\.candidates\.filter/u.test(sitting));

// ── and both doors show the panel ───────────────────────────────────────────
const session = read("src/GuidedSession.tsx");
check("the session header has the gear beside mute and close",
  /<MuteButton[\s\S]{0,400}data-testid="session-settings-button"[\s\S]{0,600}aria-label=\{ui\("Close lesson"\)\}/u.test(session));
check("and the gear opens the same panel the Learn page shows",
  /<ContinueLearningSettings\b/u.test(session) && read("src/components/duo/DuoPathView.tsx").includes("<ContinueLearningSettings />"));
// A change rebuilds the sitting on the spot. The learner pressed an order to
// see it; "applies from your next sitting" was the panel not doing its job.
check("the panel says a change rebuilds the sitting, and does",
  session.includes('ui("Changing this rebuilds the sitting from the start.")')
  && /<ContinueLearningSettings onChange=\{\(\) => \{ sessionSettingsChangedRef\.current = true; \}\} \/>/u.test(session)
  && /if \(sessionSettingsOpen \|\| !sessionSettingsChangedRef\.current\) return;\s*sessionSettingsChangedRef\.current = false;\s*onRebuildSitting\?\.\(\);/u.test(session)
  && /onRebuildSitting=\{\(\) => \{[\s\S]{0,400}startSessionRef\.current\(lastRequestedPartRef\.current\)/u.test(sitting));
check("the panel hangs under the header wherever the header ends, not at a fixed offset",
  /sessionHeaderRef\.current\?\.getBoundingClientRect\(\)\.bottom/u.test(session)
  && /style=\{\{ top: sessionSettingsTop \}\}/u.test(session)
  && /<header className="fs-topbar" ref=\{sessionHeaderRef\}>/u.test(session));

// ── Listen plays similar sentences together ─────────────────────────────────
check("Listen accepts the order", LISTEN_QUEUE_ORDERS.includes("similar"));
const view = read("src/components/listen/ListenView.tsx");
check("Listen's picker offers it and its explanation names it",
  /"similar", "Similar sentences together",/u.test(view)
  && /Similar sentences together plays sentences that start the same way/u.test(view));
const parts = {
  ...Object.fromEntries(Object.entries(allPartBlueprints).map(([k, bp]) => [k, buildApiPartFromResolved(bp, {})])),
  ...buildBundledParts(),
};
const queue = buildListenQueue(parts, {}, { order: "similar", within: "common", contentSource: ["phrases"] });
const patterns = queue.map((item) => sentencePattern(item.de));
const members = new Map();
for (const p of patterns) if (p.includes(" ")) members.set(p, (members.get(p) ?? 0) + 1);
const grouped = queue.map((item, i) => (members.get(patterns[i]) ?? 0) > 1);
const lastGrouped = grouped.lastIndexOf(true), firstSingle = grouped.indexOf(false);
check(`the queue (${queue.length} sentences) plays every shared shape before any one-off`,
  lastGrouped >= 0 && (firstSingle < 0 || firstSingle > lastGrouped),
  `a one-off at ${firstSingle + 1} sits before the last shape at ${lastGrouped + 1}`);
const starts = [];
for (let i = 0; i <= lastGrouped; i++) if (i === 0 || patterns[i] !== patterns[i - 1]) starts.push(i);
const seen = new Set(), split = starts.filter((i) => { const p = patterns[i]; if (seen.has(p)) return true; seen.add(p); return false; });
check("each shape plays in one run, never split", split.length === 0,
  `${split.length} shape(s) come back after another started, e.g. "${patterns[split[0]]}" at ${split[0] + 1}`);
const sizes = starts.map((i) => members.get(patterns[i]));
check("the biggest shape plays first and shapes never grow along the queue",
  sizes.every((n, i) => i === 0 || n <= sizes[i - 1]),
  `sizes along the queue: ${sizes.slice(0, 8).join(", ")}`);
check("the first shape really is a run of one opening",
  starts.length > 3 && sizes[0] >= 5 && patterns[0] === patterns[1],
  `first shape "${patterns[0]}" ×${sizes[0]}`);

// ── conversation order: a question, then the answer that fits it ────────────
// The only honest source of "what answers what" is the packs' dialogues,
// which are turns in sequence. The index is built from them by sentence,
// so a line a pack also teaches as a phrase still knows its place.
const exchanges = buildExchangeIndex(parts);
check(`the dialogues are indexed (${exchanges.dialogues} of them, ${exchanges.follows.size} lines with a reply)`,
  exchanges.dialogues > 500 && exchanges.follows.size > 2000);
const wieHeisst = repliesTo("Wie heißt du?", exchanges).map((key) => key);
check("\"Wie heißt du?\" is answered by a name",
  wieHeisst.some((key) => key.startsWith("ich heiße")), `replies: ${wieHeisst.slice(0, 3).join(" | ")}`);
const chain = exchangeChain("Hallo! Was möchtest du?", exchanges, () => true, 3);
check("an exchange follows the dialogue turn by turn",
  chain.length >= 1 && chain[0] === exchangeKey("Ich möchte einen Kaffee, bitte."), `chain: ${chain.join(" → ")}`);
check("and stops at the first turn nobody has",
  exchangeChain("Hallo! Was möchtest du?", exchanges, (key) => key !== exchangeKey("Ich möchte einen Kaffee, bitte."), 3).length === 0);
check("the sitting leads with a card that has a reply, and its reply follows it",
  /exchangeChain\(candidate\.de, exchanges, \(key\) => candidateByKey\.has\(key\), 1\)\.length > 0/u.test(sitting)
  && /exchangeChain\(lead\.de, exchanges, \(key\) => candidateByKey\.has\(key\), NEW_PER_LESSON_TARGET\)/u.test(sitting)
  && /\.\.\.exchangeMates,/u.test(sitting));
/*
 * And the SITTING is asked the same question, not just read.
 *
 * Everything above about the sitting is a regex over its source: the lead
 * finder is spelled this way, exchangeMates is spread there. That is worth
 * having and it is not the same as knowing a sitting comes out as an
 * exchange — Listen is built here and inspected, and the sitting was taken on
 * trust, which is exactly the gap a report of "it works in Listen but not in
 * the session" falls into. So this rebuilds the fresh half the way
 * guided_learning_session does — sort by the order, lead with the best card
 * that has a reply among the fresh ones, pin the reply behind it, order the
 * chains, then take the slots through the same picker — and asks what the
 * learner would actually be taught.
 *
 * A learner is somebody who has already learned things, so it is asked twice:
 * once from nothing, once with the first six hundred cards behind them. An
 * exchange needs BOTH halves unseen, and that is the condition most likely to
 * quietly stop being met as a learner advances.
 */
const NEW_PER_LESSON_TARGET = 3;
const corpusIndex = buildCorpusIndex(parts);
// The sitting's pool is wider than Listen's: guided_learning_session adds the
// Tatoeba packs, and derives chains between sentences where one extends
// another. Both matter here — derived chains are pinned into the fresh slots,
// and that competition is what cut the reply out of a sitting.
const sittingCatalog = buildCatalog({ ...parts, ...buildTatoebaParts() }).filter((item) => item.kind !== "vocab");
const derivedRows = sittingCatalog.map((item) => ({ id: item.id, de: String(item.de ?? ""), originalDe: item.originalDe, buildsOn: item.buildsOn, score: 0 }));
deriveImplicitChains(derivedRows);
const sittingCandidates = sittingCatalog.map((item, index) => {
  const de = String(item.de ?? "");
  const commonality = sentenceCommonality(de, corpusIndex);
  return {
    index,
    de,
    commonality,
    level: item.level,
    score: conversationPriorityScore({
      partKey: item.partKey, kind: item.kind, commonality, lessonPriority: item.lessonPriority,
    }),
    step: { type: "sentence", item: { id: item.id, de, en: item.en, buildsOn: derivedRows[index].buildsOn, originalDe: item.originalDe } },
  };
});
const freshSitting = (seenCount, sorts = []) => {
  const inCourseOrder = [...sittingCandidates].sort(O.sittingComparator(O.DEFAULT_SITTING_PLAN, sittingCandidates));
  const seen = new Set(inCourseOrder.slice(0, seenCount).map((c) => exchangeKey(c.de)));
  const candidates = [...sittingCandidates]
    .filter((c) => !seen.has(exchangeKey(c.de)))
    .sort(O.sittingComparator({ sorts, grouping: "conversation" }, sittingCandidates));
  const byKey = new Map(candidates.map((c) => [exchangeKey(c.de), c]));
  const lead = candidates.find((c) => exchangeChain(c.de, exchanges, (k) => byKey.has(k), 1).length > 0)
    ?? candidates[0];
  const mates = exchangeChain(lead.de, exchanges, (k) => byKey.has(k), NEW_PER_LESSON_TARGET)
    .map((k) => byKey.get(k))
    .filter((c) => c && c !== lead);
  // As the session does: chained cards among the top few by the order are
  // pinned, and they compete with the reply for the fresh slots. The lead and
  // its reply are one block at the front, outside orderWithChains.
  const pinnedChains = candidates.slice(0, NEW_PER_LESSON_TARGET).filter((c) => c !== lead && c.step.item.buildsOn && !mates.includes(c));
  const block = mates.length ? [lead, ...mates] : [];
  const inBlock = new Set(block);
  const pinned = new Set([lead, ...mates, ...pinnedChains]);
  const ranked = [...block, ...orderWithChains([lead, ...pinnedChains, ...mates, ...candidates.filter((c) => !pinned.has(c))]
    .filter((c) => !inBlock.has(c))
    .map((c) => ({ candidate: c, de: c.de, originalDe: c.step.item.originalDe, buildsOn: c.step.item.buildsOn })))
    .map((row) => row.candidate)];
  return takeMatchingSafe(
    ranked.map((c) => c.step),
    NEW_PER_LESSON_TARGET,
    (step) => ({ german: String(step?.item?.de ?? ""), english: String(step?.item?.en ?? "") }),
    new Set()
  ).map((step) => step.item.de);
};
// Conversation order alone, and on top of most common first. The second is
// the combination that cut replies out: most common first ties thousands of
// short sentences at the top of the commonality scale, their derived
// extensions were pinned ahead of the reply, and the sitting opened on
// "Wie sieht sie aus?" followed by a stranger.
for (const sorts of [[], ["common"], ["common", "level"]]) {
  for (const seenCount of [0, 600, 900]) {
    const taught = freshSitting(seenCount, sorts);
    const replies = repliesTo(taught[0], exchanges);
    check(
      `a sitting in conversation order${sorts.length ? ` (after ${sorts.join(", then ")})` : ""} opens on an exchange${seenCount ? ` after ${seenCount} cards learned` : ""}`,
      taught.length >= 2 && replies.includes(exchangeKey(taught[1])),
      `it teaches: ${taught.join("  →  ")}`
    );
  }
}
check("the session puts the grouping's block first, outside the chain regrouping",
  /const groupBlock = lead && groupMates\.length > 0 \? \[lead, \.\.\.groupMates\] : \[\];/u.test(sitting)
  && /\[\.\.\.groupBlock, \.\.\.orderWithChains\(\[/u.test(sitting)
  && /\.filter\(\(candidate\) => !inGroupBlock\.has\(candidate\)\)/u.test(sitting));
check("and an extension of a card in the block waits until the block ends",
  /\(blockSteps\.has\(step\) \? heldExtensions : pairedFresh\)\.push\(extension\.step\);/u.test(sitting)
  && /pairedFresh\.push\(\.\.\.heldExtensions\);/u.test(sitting));

check("Listen accepts conversation order and its picker offers it",
  LISTEN_QUEUE_ORDERS.includes("conversation") && /"conversation", "Conversation order",/u.test(view)
  && /Conversation order plays the course's dialogues as exchanges/u.test(view));
const talk = buildListenQueue(parts, {}, { order: "conversation", within: "common", contentSource: ["phrases"] });
const places = talk.map((item) => exchangePlace(item.de, exchanges));
const lastInDialogue = places.map((p) => Boolean(p)).lastIndexOf(true), firstAlone = places.findIndex((p) => !p);
check(`Listen plays every dialogue line (${places.filter(Boolean).length}) before anything that stands alone`,
  lastInDialogue >= 0 && (firstAlone < 0 || firstAlone > lastInDialogue),
  `a lone card at ${firstAlone + 1} before the last dialogue line at ${lastInDialogue + 1}`);
let broken = 0, splitDialogues = 0;
const seenDialogues = new Set();
for (let i = 0; i <= lastInDialogue; i++) {
  const here = places[i], before = places[i - 1];
  if (!before || before.dialogue !== here.dialogue) {
    if (seenDialogues.has(here.dialogue)) splitDialogues++;
    seenDialogues.add(here.dialogue);
  } else if (here.line < before.line) broken++;
}
check("each dialogue plays whole, in turn order, and is never split",
  broken === 0 && splitDialogues === 0, `${broken} turn(s) out of order, ${splitDialogues} dialogue(s) split`);
check("the first exchange really is a question and its reply",
  places[0]?.line === 0 && places[1]?.dialogue === places[0]?.dialogue && places[1]?.line === 1,
  `queue opens: ${talk.slice(0, 2).map((item) => item.de).join("  →  ")}`);

// ── the exchange is not cut to fit, and reviews that belong to it come along ─
// With a backlog of ten due reviews the mix left one fresh slot — the
// question and never its reply — and with words in the sitting it did so
// from four. The fresh slots now hold the lead and its mates; reviews give
// way, as they already do to words. And among what is due, the lines of the
// lead's own conversation are preferred and then dealt in dialogue order
// around the exchange — a preference, so a sitting with nothing fitting is
// exactly what it was.
check("the fresh slots hold the whole exchange (or run of similar sentences), reviews give way",
  /const groupMates = sittingPlan\.grouping === "conversation" \? exchangeMates\s*: sittingPlan\.grouping === "similar" \? patternMates : \[\];/u.test(sitting)
  && /const mates = groupMates;/u.test(sitting)
  && /sentenceSlots\.freshSlots = Math\.max\(sentenceSlots\.freshSlots, Math\.min\(NEW_PER_LESSON_TARGET, 1 \+ mates\.length\)\)/u.test(sitting)
  && /const sittingRoom = Math\.max\(1, 6 - fresh\.length - mixedWords\.length\)/u.test(sitting));
check("reviews from the lead's conversation are preferred, then dealt in dialogue order around the exchange",
  /fitsConversation\s*\n\s*\);/u.test(sitting)
  && /\.\.\.talk,\s*\n\s*\.\.\.freshSteps\.filter\(\(step\) => !talkSet\.has\(step\)\),\s*\n\s*\.\.\.mixedWords,\s*\n\s*\.\.\.reviews\.filter/u.test(sitting));
// The preference in the mix itself, on synthetic reviews: a fitting review
// with a longer interval beats a weaker unrelated one only when preferred.
// Two slots, three due: the plain mix takes the weakest and one well-known
// card (its "one older" rule), so the middling fitting one is left out; with
// the preference it leads.
const rv = (de, interval) => ({ type: "sentence", interval, item: { id: de, de, en: de } });
const unrelatedWeak = rv("Wo ist der Bahnhof?", 1), fittingMid = rv("Ich heiße Alex.", 3), unrelatedOld = rv("Danke schön.", 9);
const due = [unrelatedWeak, fittingMid, unrelatedOld];
const fits = (step) => step.item.de === "Ich heiße Alex.";
const withPreference = selectContinueLearningMix([], [], due, 3, 2, [], "de", fits).reviews;
const without = selectContinueLearningMix([], [], due, 3, 2, [], "de").reviews;
check("a fitting review is taken ahead of a weaker one when preferred, and not otherwise",
  withPreference[0] === fittingMid && !without.includes(fittingMid) && without[0] === unrelatedWeak,
  `preferred: ${withPreference.map((s) => s.item.de).join(", ")}; plain: ${without.map((s) => s.item.de).join(", ")}`);
check("and the preference never adds a review that is not due",
  selectContinueLearningMix([], [], [unrelatedWeak], 3, 2, [], "de", fits).reviews.length === 1);
check("struggles keep their place ahead of any preference",
  selectContinueLearningMix([], [rv("Hilfe!", 0)], due, 3, 2, [], "de", fits).reviews[0]?.item.de === "Hilfe!");
check("pickReviews itself honours the preference first, then weakest first",
  pickReviews(due, 2, [], fits)[0] === fittingMid && pickReviews(due, 2)[0] === unrelatedWeak);

if (failures.length) {
  console.error(`\n${failures.length} sitting-order check(s) failed`);
  process.exit(1);
}
console.log(`check-sitting-order: Continue learning takes ${O.SITTING_ORDERS.length} orders and a level filter, the session and the Learn page both show the panel, and Listen's similar order plays ${starts.length} shapes in runs, the biggest ("${patterns[0]}" ×${sizes[0]}) first.`);
