/**
 * How Continue learning decides what a sitting is made of.
 *
 * It used to have one answer: the course's own pick, a score that blends how
 * common a sentence is with how hard it is and where the learner's ability
 * sits. That is a good default and it is still the default. But it is one
 * way to learn, and a learner who wants all of A1 before a word of A2, or
 * every sentence that starts "Ich möchte" in one run, or the short ones
 * before the long ones, had no way to say so — Listen could be told all of
 * that and the guided session could not.
 *
 * These settings are per course, like Listen's: the order somebody wants for
 * German is not the order they want for Polish. Storage is a courtesy; when
 * it is blocked the documented default applies and nothing breaks.
 */
import { cefrRung, cefrStep, CEFR_STEPS, type CefrStep } from "@/lib/cefr";
import { getLearningDirection, type LearningDirection } from "@/lib/direction";
import { sentencePattern } from "@/lib/sentencePattern";

/**
 * The picker's seven buttons. Since orders can be combined, this names a
 * BUTTON, not the whole setting: the setting is a SittingPlan.
 */
export type SittingOrder = "course" | "level" | "common" | "similar" | "conversation" | "shortest" | "longest";
/**
 * Written as a list so a value can be checked against it in one place. An
 * order added to the picker and not to this list would be chosen, written,
 * and read back as the default on the next sitting — silently.
 *
 * "conversation" sorts like the course's pick; what makes it different is
 * who follows the lead — the reply to it, from the packs' dialogues (see
 * exchanges.ts), the way "similar" is followed by its pattern-mates.
 */
export const SITTING_ORDERS: SittingOrder[] = ["course", "level", "common", "similar", "conversation", "shortest", "longest"];

/**
 * What each order is called, for anywhere that has to name one.
 *
 * Here rather than only in the picker, because the picker is no longer the
 * only place that says it: the lesson names the order that built it, and two
 * lists of the same seven names would drift the first time one was reworded.
 * The picker's own list is checked against this one.
 */
export const SITTING_ORDER_LABELS: Record<SittingOrder, string> = {
  course: "The course's pick",
  level: "Easiest first (A1 → C1)",
  common: "Most common first",
  similar: "Similar sentences together",
  conversation: "Conversation order",
  shortest: "Shortest first",
  longest: "Longest first",
};

/**
 * Orders combine.
 *
 * One order at a time could not say "the commonest sentences, and of those the
 * easiest first", or "the commonest first, as conversations". The seven
 * buttons are two kinds of thing, and the setting keeps them apart:
 *
 * - SORTS decide what comes first, and can be ranked. The first decides; each
 *   later one settles what the earlier ones leave level. A continuous measure
 *   that is not last in the ranking is compared in bands (see sittingComparator),
 *   or it would never leave anything level for the next one to settle.
 * - GROUPINGS decide what follows the sentence that leads a sitting: its
 *   reply (conversation) or its pattern-mates (similar). Ranking those against
 *   a sort means nothing, so at most one is on, alongside any sorts.
 *
 * An empty plan is the course's pick, as it always was.
 */
type SittingSort = "level" | "common" | "shortest" | "longest";
type SittingGrouping = "conversation" | "similar";
export type SittingPlan = { sorts: SittingSort[]; grouping: SittingGrouping | null };

const SITTING_SORTS: SittingSort[] = ["level", "common", "shortest", "longest"];
const SITTING_GROUPINGS: SittingGrouping[] = ["conversation", "similar"];
export const DEFAULT_SITTING_PLAN: SittingPlan = { sorts: [], grouping: null };

const isSort = (value: unknown): value is SittingSort => SITTING_SORTS.includes(value as SittingSort);
const isGrouping = (value: unknown): value is SittingGrouping => SITTING_GROUPINGS.includes(value as SittingGrouping);

/** A plan made safe to run: known sorts, each once, never both lengths. */
function normaliseSittingPlan(raw: unknown): SittingPlan {
  const value = (raw ?? {}) as { sorts?: unknown; grouping?: unknown };
  const sorts: SittingSort[] = [];
  for (const sort of Array.isArray(value.sorts) ? value.sorts : []) {
    if (!isSort(sort) || sorts.includes(sort)) continue;
    // Shortest and longest first cannot both hold; the later choice wins.
    const opposite = sort === "shortest" ? "longest" : sort === "longest" ? "shortest" : null;
    if (opposite && sorts.includes(opposite)) sorts.splice(sorts.indexOf(opposite), 1);
    sorts.push(sort);
  }
  return { sorts, grouping: isGrouping(value.grouping) ? value.grouping : null };
}

/** What a single button meant when the setting held one of them. */
function planFromOrder(order: SittingOrder): SittingPlan {
  if (isSort(order)) return { sorts: [order], grouping: null };
  if (isGrouping(order)) return { sorts: [], grouping: order };
  return DEFAULT_SITTING_PLAN;
}

/**
 * Press a button. A sort not yet ranked joins at the end; one already ranked
 * leaves, and the ones after it move up. A grouping toggles, replacing the
 * other. The course's pick clears everything.
 */
export function toggleSittingPlan(plan: SittingPlan, order: SittingOrder): SittingPlan {
  if (order === "course") return DEFAULT_SITTING_PLAN;
  if (isGrouping(order)) return { ...plan, grouping: plan.grouping === order ? null : order };
  if (!isSort(order)) return plan;
  return normaliseSittingPlan({
    ...plan,
    sorts: plan.sorts.includes(order) ? plan.sorts.filter((sort) => sort !== order) : [...plan.sorts, order],
  });
}

/** Whether a button is lit, and its place in the ranking if it is a sort. */
export function sittingButtonState(plan: SittingPlan, order: SittingOrder): { on: boolean; rank: number | null } {
  if (order === "course") return { on: plan.sorts.length === 0 && plan.grouping === null, rank: null };
  if (isGrouping(order)) return { on: plan.grouping === order, rank: null };
  const at = plan.sorts.indexOf(order as SittingSort);
  return { on: at >= 0, rank: at >= 0 && plan.sorts.length > 1 ? at + 1 : null };
}

/** The plan in words: each name already translated by `name`. */
export function sittingPlanLabel(plan: SittingPlan, name: (label: string) => string): string {
  const parts = plan.sorts.map((sort) => name(SITTING_ORDER_LABELS[sort]));
  const sorted = parts.length ? parts.join(" → ") : plan.grouping ? "" : name(SITTING_ORDER_LABELS.course);
  const grouped = plan.grouping ? name(SITTING_ORDER_LABELS[plan.grouping]) : "";
  return [sorted, grouped].filter(Boolean).join(" · ");
}

// v1 held one button's name; v2 holds the whole plan as JSON. A v1 value is
// read once as the plan it meant, so nobody's choice is lost to the change.
const ORDER_KEY_V1 = "gl-sitting-order-v1";
const PLAN_KEY = "gl-sitting-plan-v2";
const LEVEL_FILTER_KEY = "gl-sitting-level-filter-v1";

function courseSettingKey(key: string, direction: LearningDirection): string {
  return `${key}:${direction}`;
}

export function getSittingPlan(direction: LearningDirection = getLearningDirection()): SittingPlan {
  try {
    const stored = window.localStorage.getItem(courseSettingKey(PLAN_KEY, direction));
    if (stored) return normaliseSittingPlan(JSON.parse(stored));
    const legacy = window.localStorage.getItem(courseSettingKey(ORDER_KEY_V1, direction));
    if (SITTING_ORDERS.includes(legacy as SittingOrder)) return planFromOrder(legacy as SittingOrder);
  } catch { /* storage blocked or unreadable: the documented default */ }
  return DEFAULT_SITTING_PLAN;
}

export function setSittingPlan(
  plan: SittingPlan,
  direction: LearningDirection = getLearningDirection()
): SittingPlan {
  const next = normaliseSittingPlan(plan);
  try {
    window.localStorage.setItem(courseSettingKey(PLAN_KEY, direction), JSON.stringify(next));
  } catch { /* keep the session usable */ }
  return next;
}

/**
 * Which levels a sitting may draw fresh material from. The empty set means
 * every level — a filter nobody has touched must not empty the sitting, and
 * unticking the last level is the same as not filtering. Reviews are never
 * filtered: what you have started, you finish.
 */
export function getSittingLevelFilters(direction: LearningDirection = getLearningDirection()): Set<CefrStep> {
  try {
    const raw = window.localStorage.getItem(courseSettingKey(LEVEL_FILTER_KEY, direction));
    if (!raw) return new Set();
    const wanted = new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean));
    return new Set(CEFR_STEPS.filter((step) => wanted.has(step)));
  } catch { /* storage blocked: every level */ }
  return new Set();
}

export function setSittingLevelFilters(
  levels: Iterable<CefrStep>,
  direction: LearningDirection = getLearningDirection()
): Set<CefrStep> {
  const wanted = new Set(levels);
  const next = new Set(CEFR_STEPS.filter((step) => wanted.has(step)));
  try {
    window.localStorage.setItem(courseSettingKey(LEVEL_FILTER_KEY, direction), [...next].join(","));
  } catch { /* keep the session usable */ }
  return next;
}

export function passesSittingLevel(level: string | undefined, filter: Set<CefrStep>): boolean {
  if (filter.size === 0) return true;
  return filter.has(cefrStep(level));
}

/**
 * What the sitting knows about a fresh card when it decides the order. Not
 * exported: the sitting's own candidate rows carry these fields and the
 * comparator takes them structurally.
 */
type SittingCandidate = {
  /** The course's own pick: lower is sooner. */
  score: number;
  /** Curriculum position, the tie-break everything else falls back to. */
  index: number;
  /** The pack's CEFR label, e.g. "A2" or "A2-B1". */
  level?: string;
  /** The German text. */
  de: string;
  /** How often the course's own sentences say this; higher is commoner. */
  commonality: number;
};

type Compare = (a: SittingCandidate, b: SittingCandidate) => number;

/** Commonality bands: fifths of the candidates in play, commonest first. */
const COMMON_BANDS = 5;
/** Length bands, in words: a phrase, a short sentence, a sentence, a long one. */
const WORD_BANDS = [3, 6, 10];

function commonBand(candidates: readonly SittingCandidate[]): (candidate: SittingCandidate) => number {
  const sorted = candidates.map((candidate) => candidate.commonality).sort((a, b) => b - a);
  // The lowest commonality still inside each of the first four fifths.
  const floors = Array.from({ length: COMMON_BANDS - 1 }, (_, i) =>
    sorted[Math.min(sorted.length - 1, Math.floor(((i + 1) * sorted.length) / COMMON_BANDS) - 1)] ?? -Infinity);
  return (candidate) => {
    const band = floors.findIndex((floor) => candidate.commonality >= floor);
    return band < 0 ? COMMON_BANDS - 1 : band;
  };
}

function wordBand(candidate: SittingCandidate): number {
  const words = candidate.de.trim().split(/\s+/u).filter(Boolean).length;
  const band = WORD_BANDS.findIndex((most) => words <= most);
  return band < 0 ? WORD_BANDS.length : band;
}

/**
 * The order a sitting sorts its fresh candidates in. Every plan ends on the
 * course's pick and then the curriculum position, so ties are settled the way
 * the default would settle them; a grouping does not sort at all — the lead
 * is the best card by the sorts, and what follows it is decided by
 * similarMates or the exchange index.
 *
 * A sort that is LAST compares exactly. One with sorts after it compares in
 * bands — commonality in fifths of the candidates, length in word bands —
 * because exact values almost never tie, and "most common, then easiest"
 * would otherwise be "most common" with a second choice that never acts.
 * Level is already banded: A1, A2 and so on.
 *
 * `candidates` are the ones being sorted; the commonality bands are drawn
 * from them, so "the commonest fifth" means the commonest fifth of what this
 * learner has left.
 */
export function sittingComparator(plan: SittingPlan, candidates: readonly SittingCandidate[] = []): Compare {
  const course: Compare = (a, b) => a.score - b.score || a.index - b.index;
  const { sorts } = normaliseSittingPlan(plan);
  const band = sorts.some((sort, i) => sort === "common" && i < sorts.length - 1) ? commonBand(candidates) : null;
  const steps: Compare[] = sorts.map((sort, i) => {
    const last = i === sorts.length - 1;
    switch (sort) {
      case "level":
        return (a, b) => cefrRung(a.level) - cefrRung(b.level);
      case "common":
        return last || !band ? (a, b) => b.commonality - a.commonality : (a, b) => band(a) - band(b);
      case "shortest":
        return last ? (a, b) => a.de.length - b.de.length : (a, b) => wordBand(a) - wordBand(b);
      case "longest":
        return last ? (a, b) => b.de.length - a.de.length : (a, b) => wordBand(b) - wordBand(a);
    }
  });
  return (a, b) => {
    for (const step of steps) {
      const decided = step(a, b);
      if (decided) return decided;
    }
    return course(a, b);
  };
}

/**
 * The cards that open the same way as the lead, in the sitting's order. A
 * lead that is a single word, or whose opening nobody else shares, has no
 * mates and the sitting is the course's pick — the next sitting leads with
 * the next card, so a run of one-offs does not stall.
 */
export function similarMates<T extends SittingCandidate>(lead: T, candidates: T[]): T[] {
  const pattern = sentencePattern(lead.de);
  if (!pattern || !pattern.includes(" ")) return [];
  return candidates.filter((candidate) => candidate !== lead && sentencePattern(candidate.de) === pattern);
}
