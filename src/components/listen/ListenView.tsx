import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Info,
  GripVertical,
  Headphones,
  ListMusic,
  Minimize2,
  Pause,
  Play,
  Repeat2,
  Undo2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { literalGloss } from "@/lib/literalGloss";
import { cn } from "@/lib/utils";
import { usageNote, useUsageNotes } from "@/lib/usageNotes";
import { ENGLISH_VARIANT_EVENT } from "@/lib/englishVariant";
import { SettingsCategory } from "@/components/SettingsCategory";
import { ui, uiFmt, uiNumber, uiOr } from "@/lib/i18n";
import { loadGradeStore } from "@/lib/activity";
import {
  AUDIO_SETTINGS_EVENT,
  getAudioSettings,
  getTtsAudioVolume,
  isMasterAudioSilent,
  isTtsLanguageMuted,
  setMasterAudioVolume,
  setTtsLanguageVolume,
  toggleAudioMuted,
  toggleTtsLanguageMuted,
  type AudioSettings,
} from "@/lib/audioMute";
import { MuteButton } from "@/components/MuteButton";
import { SpeechSpeedControl } from "@/components/SpeechSpeedControl";
import {
  buildListenQueue,
  buildListenSpeechPlan,
  formatListenPetCaption,
  getListenBackgroundPlayback,
  getListenContentKinds,
  getListenCurrentItemId,
  getListenMeaningRepeats,
  getListenTargetRepeats,
  getListenLanguageGapMs,
  getListenLanguageOrder,
  getListenLoopItems,
  getListenMixedCounts,
  LISTEN_MIXED_TOTAL,
  arrangeListenMixedQueue,
  listenMixGroupFor,
  getListenLoopPasses,
  getListenNextCardDelayMs,
  getListenPetBilingualCaptions,
  getListenQueueOrder,
  getListenQueueWithin,
  getListenReturnGap,
  getListenReturnScope,
  DEFAULT_LISTEN_QUEUE_WITHIN,
  getListenLevelFilters,
  getListenUsefulnessFilters,
  listenLoopPassForPlayhead,
  listenPlayheadForQueueIndex,
  listenQueueIndexForPlayhead,
  recordListenGrade,
  setListenBackgroundPlayback,
  setListenContentKinds,
  setListenCurrentItemId,
  setListenMeaningRepeats,
  setListenTargetRepeats,
  setListenLanguageGapMs,
  setListenLanguageOrder,
  setListenLoopItems,
  setListenMixedCounts,
  setListenLoopPasses,
  setListenNextCardDelayMs,
  setListenPetBilingualCaptions,
  setListenQueueOrder,
  setListenQueueWithin,
  setListenReturnGap,
  setListenReturnScope,
  setListenLevelFilters,
  setListenUsefulnessFilters,
  setListenReviewLevel,
  snoozeListenItem,
  listenQueueHasGroups,
  undoListenReviewChange,
  listenContentSourceKey,
  LISTEN_CONTENT_KINDS,
  type ListenContentKind,
  type ListenItem,
  type ListenLanguageOrder,
  type ListenQueueOrder,
  type ListenQueueWithin,
  type ListenReturnGap,
  type ListenReturnScope,
  type ListenReviewChange,
  type ListenReviewLevel,
  LISTEN_TARGET_RATE,
  LISTEN_MEANING_RATE,
} from "@/lib/listenMode";
import { cefrRungLabel, cefrStepLabel, CEFR_STEPS, type CefrStep } from "@/lib/cefr";
import { USEFULNESS_FILTERS, type ConversationUsefulness } from "@/lib/conversationPriority";
import { ListenTest } from "@/components/listen/ListenTest";
import { TtsWaveform } from "@/components/TtsWaveform";
import { LISTEN_TEST_MAX_QUESTIONS } from "@/lib/listenTest";
import { TappableSentence } from "@/components/shared/TappableSentence";
import { preloadTts, stopTts, ttsSequence, TTS_SPEAKING_EVENT, type SeqItem } from "@/lib/voice";
import { readListenSession, writeListenSession } from "@/lib/listenSession";
import {
  AUDIO_LANGUAGE,
  courseSide,
  courseSides,
  meaningLanguageFor,
  targetLanguage,
  type CourseLanguage,
} from "@/lib/courseLanguages";
import type { UserProfile } from "@/lib/profileStorage";
import {
  loadMiniPlayerPosition,
  miniPlayerFraction,
  miniPlayerPixels,
  saveMiniPlayerPosition,
  type MiniPlayerPosition,
} from "@/lib/miniPlayerPosition";
import type { LearningDirection } from "@/lib/direction";
import { useCodexPets, type CodexPetVoiceLanguage } from "@/components/codexPets/CodexPetProvider";
import { useInterfaceLanguage } from "@/lib/interfaceLanguage";
import {
  ensureTranslations,
  isTranslationLoaded,
  TRANSLATIONS_LOADED_EVENT,
} from "@/lib/translations";

type ListenMediaCommand = "previous" | "toggle" | "play" | "pause" | "next";

/**
 * How long to wait before asking for a card again when none of it was heard.
 *
 * A card whose every clip failed used to stop the player on the spot, with
 * nothing on screen but the Play button: the learner came back to a paused
 * card and no way to tell why. Synthesis fails in bursts — the service turns
 * away handshakes for a few seconds at a time — so the same card usually
 * plays a moment later. One entry per retry; once they are spent the player
 * stops and says so.
 */
const LISTEN_SILENT_RETRY_MS = [1_500, 4_000, 8_000];

type ListenReviewNotice = {
  message: string;
  undo?: {
    change: ListenReviewChange;
    item: ListenItem;
  };
};

type ListenDesktopApi = {
  onListenMediaCommand?: (callback: (command: ListenMediaCommand) => void) => (() => void);
  setListenMediaState?: (state: {
    available: boolean;
    playing: boolean;
    title?: string;
    subtitle?: string;
  }) => void;
};

const desktop = typeof window !== "undefined"
  ? (window as typeof window & { germDesktop?: ListenDesktopApi }).germDesktop
  : undefined;

const REVIEW_LEVELS: Array<{ value: ListenReviewLevel; label: string; note: string }> = [
  { value: "new", label: "New", note: "Starts over from the beginning" },
  { value: "struggle", label: "Struggling", note: "Comes back as soon as there is a slot" },
  { value: 1, label: "Not confident", note: "Comes back soon, often within a day" },
  { value: 2, label: "Familiar", note: "About 3 days away, sooner if you slip" },
  { value: 3, label: "Strong", note: "About 10 days away, sooner if you slip" },
  { value: 4, label: "Solid", note: "About 30 days away, sooner if you slip" },
  { value: 5, label: "Mastered", note: "About 180 days away, sooner if you slip" },
  { value: "permanent", label: "Never review", note: "Never comes back at all" },
];

const SNOOZE_CHOICES = [
  { days: 1, label: "Tomorrow", note: "Nothing brings it back today" },
  { days: 3, label: "In 3 days", note: "Held back until then" },
  { days: 7, label: "In a week", note: "Held back until then" },
  { days: 30, label: "In a month", note: "Held back until then" },
] as const;

function VolumeGlyph({ muted, volume, className }: { muted: boolean; volume: number; className?: string }) {
  if (muted || volume <= 0) return <VolumeX className={className} />;
  if (volume < 0.55) return <Volume1 className={className} />;
  return <Volume2 className={className} />;
}

function ListenVolumeRow({
  label,
  value,
  muted,
  muteLabel,
  unmuteLabel,
  onToggleMuted,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  muted: boolean;
  muteLabel: string;
  unmuteLabel: string;
  onToggleMuted: () => void;
  onChange: (value: number) => void;
  testId: string;
}) {
  const percent = Math.round(value * 100);
  return (
    <div className="audio-mixer-row">
      <div className="audio-mixer-rowhead">
        <span>{label}</span>
        <strong>{muted ? ui("Muted") : `${percent}%`}</strong>
      </div>
      <div className="audio-mixer-controls">
        <button
          aria-label={muted ? unmuteLabel : muteLabel}
          aria-pressed={muted}
          className={cn("audio-mixer-mute", muted && "is-muted")}
          data-testid={`${testId}-mute`}
          onClick={onToggleMuted}
          type="button"
        >
          <VolumeGlyph className="h-4 w-4" muted={muted} volume={value} />
        </button>
        <input
          aria-label={label}
          aria-valuetext={muted ? ui("Muted") : `${percent}%`}
          className="audio-mixer-range"
          data-testid={`${testId}-volume`}
          max="100"
          min="0"
          onChange={(event) => onChange(Number(event.target.value) / 100)}
          step="1"
          type="range"
          value={percent}
        />
      </div>
    </div>
  );
}

function NumberSetting({
  label,
  note,
  value,
  min,
  max,
  step = 1,
  suffix,
  onCommit,
  testId,
}: {
  label: string;
  note: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onCommit: (value: number) => number;
  testId: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    const next = onCommit(Number.isFinite(parsed) ? parsed : value);
    setDraft(String(next));
  };

  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <span className="min-w-0">
        <strong className="block text-sm font-black text-[var(--text-1)]">{label}</strong>
        <small className="mt-0.5 block text-[11px] font-semibold leading-snug text-[var(--text-3)]">{note}</small>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <input
          className="h-10 w-[72px] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-2 text-center text-sm font-black text-[var(--text-1)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-dim)]"
          data-testid={testId}
          inputMode="decimal"
          max={max}
          min={min}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
          }}
          step={step}
          type="number"
          value={draft}
        />
        <span className="min-w-8 text-xs font-black text-[var(--text-3)]">{suffix}</span>
      </span>
    </label>
  );
}

/**
 * Listen is the hands-free companion to guided lessons. By default it reads
 * English once, then German twice. Items are grouped into short learning loops
 * and revisited before new material arrives; both the group size and number of
 * passes are learner-controlled. Passive Know it / Struggle marks remain
 * deliberately damped; the explicit level picker is the place for a strong
 * tracker correction.
 */
/**
 * What the player says while it holds the gap open.
 *
 * A map rather than a ternary because the answer is one of five languages
 * now, and because the sentence has to be written out in full for the
 * translations to find it.
 */
const YOUR_TURN_LABEL: Record<CourseLanguage, string> = {
  de: "Your turn — say it in German",
  en: "Your turn — say it in English",
  fr: "Your turn — say it in French",
  pl: "Your turn — say it in Polish",
  es: "Your turn — say it in Spanish",
  it: "Your turn — say it in Italian",
  pt: "Your turn — say it in Portuguese",
  ru: "Your turn — say it in Russian",
  el: "Your turn — say it in Greek",
  sq: "Your turn — say it in Albanian",
};

const REPEATS_LABEL: Record<CourseLanguage, string> = {
  de: "German repeats",
  en: "English repeats",
  fr: "French repeats",
  pl: "Polish repeats",
  es: "Spanish repeats",
  it: "Italian repeats",
  pt: "Portuguese repeats",
  ru: "Russian repeats",
  el: "Greek repeats",
  sq: "Albanian repeats",
};

const MUTED_VOICE_LABEL: Record<CourseLanguage, string> = {
  de: "German voice is muted and will be skipped.",
  en: "English voice is muted and will be skipped.",
  fr: "French voice is muted and will be skipped.",
  pl: "Polish voice is muted and will be skipped.",
  es: "Spanish voice is muted and will be skipped.",
  it: "Italian voice is muted and will be skipped.",
  pt: "Portuguese voice is muted and will be skipped.",
  ru: "Russian voice is muted and will be skipped.",
  el: "Greek voice is muted and will be skipped.",
  sq: "Albanian voice is muted and will be skipped.",
};

const SAY_IT_FIRST_LABEL: Record<CourseLanguage, string> = {
  de: "Your turn to say the German before it is spoken",
  en: "Your turn to say the English before it is spoken",
  fr: "Your turn to say the French before it is spoken",
  pl: "Your turn to say the Polish before it is spoken",
  es: "Your turn to say the Spanish before it is spoken",
  it: "Your turn to say the Italian before it is spoken",
  pt: "Your turn to say the Portuguese before it is spoken",
  ru: "Your turn to say the Russian before it is spoken",
  el: "Your turn to say the Greek before it is spoken",
  sq: "Your turn to say the Albanian before it is spoken",
};

const FIRST_LABEL: Record<CourseLanguage, string> = {
  de: "German first",
  en: "English first",
  fr: "French first",
  pl: "Polish first",
  es: "Spanish first",
  it: "Italian first",
  pt: "Portuguese first",
  ru: "Russian first",
  el: "Greek first",
  sq: "Albanian first",
};

// Written out rather than composed from a "{language} voice" pattern, because
// German inflects the adjective: die deutsche Stimme, die französische Stimme.
const VOICE_LABEL: Record<CourseLanguage, string> = {
  de: "German voice",
  en: "English voice",
  fr: "French voice",
  pl: "Polish voice",
  es: "Spanish voice",
  it: "Italian voice",
  pt: "Portuguese voice",
  ru: "Russian voice",
  el: "Greek voice",
  sq: "Albanian voice",
};

const MUTE_VOICE_LABEL: Record<CourseLanguage, string> = {
  de: "Mute German voice",
  en: "Mute English voice",
  fr: "Mute French voice",
  pl: "Mute Polish voice",
  es: "Mute Spanish voice",
  it: "Mute Italian voice",
  pt: "Mute Portuguese voice",
  ru: "Mute Russian voice",
  el: "Mute Greek voice",
  sq: "Mute Albanian voice",
};

const UNMUTE_VOICE_LABEL: Record<CourseLanguage, string> = {
  de: "Unmute German voice",
  en: "Unmute English voice",
  fr: "Unmute French voice",
  pl: "Unmute Polish voice",
  es: "Unmute Spanish voice",
  it: "Unmute Italian voice",
  pt: "Unmute Portuguese voice",
  ru: "Unmute Russian voice",
  el: "Unmute Greek voice",
  sq: "Unmute Albanian voice",
};

/**
 * What the group is called, in the words of the order that made it.
 *
 * "Then within each group" is true of all of them and says nothing. A learner
 * who chose Easiest first is thinking in levels, and one who chose Newest
 * first is thinking in packs, so the heading says the word they are already
 * using. Most common first makes no groups and has no entry.
 */
const WITHIN_LEGEND: Record<string, string> = {
  level: "Then within each level",
  learning: "Then within reviews, struggles and new cards",
  "least-heard": "Then among cards heard the same number of times",
  newest: "Then within each pack",
};

/**
 * Written out in full rather than derived from the orders above, because two
 * of them do not appear here and one of these is not an order at all: hardest
 * first only makes sense once there is a group to sort, so it has never been
 * something the whole queue could be arranged by.
 */
const WITHIN_CHOICES = [
  ["common", "Most common first"],
  ["hardest", "Hardest first"],
  ["least-heard", "Least heard first"],
  ["newest", "Newest first"],
  ["learning", "Reviews & struggles first"],
] as const;

/**
 * The wait, from a few cards to a whole review ladder.
 *
 * The short end is counted in cards and the long end in time, because those
 * are two different exercises. Coming back after three other cards is
 * short-term memory — you are still holding the word when it returns. Coming
 * back after a day is recall. A scale that started at four hours could only
 * ever train the second, and the first is the one most people mean when they
 * say they want to hear something again soon.
 *
 * Written out rather than generated from the maps so the wording is a decision
 * rather than a rendering: "after three cards" is what a learner is choosing,
 * and a rank comparison is what the queue is doing about it.
 */
const RETURN_GAP_CHOICES = [
  ["immediate", "Straight away"],
  ["three", "After 3 more cards"],
  ["ten", "After 10 more cards"],
  ["thirty", "After 30 more cards"],
  ["hours", "After a few hours"],
  ["day", "After a day"],
  ["due", "When the review says so"],
] as const;

const RETURN_GAP_EXPLAINED: Record<string, string> = {
  immediate: "No wait at all. Anything can play again the moment the order reaches it — which on a narrow filter can mean the same handful of cards all evening. Right for a first pass through a new pack, and not much else.",
  three: "Three other cards go by first. Short enough that you are still holding the word when it comes back, which is the exercise short-term memory actually is.",
  ten: "Ten other cards go by first. Far enough that you have to fetch the word back rather than still be carrying it, and near enough to do it several times in one sitting.",
  thirty: "Thirty other cards go by first. About a session's worth on a narrow filter, so a word returns once you have genuinely moved on from it.",
  hours: "About four hours. Long enough that you have to remember it rather than recognise it from a minute ago, and short enough to meet it again the same day.",
  day: "A full day. This is the shortest gap the review ladder ever asks for, and the point at which hearing something again is recall rather than an echo.",
  due: "Nothing you have answered correctly comes back until the review ladder says it is due — one day, then three, ten, thirty, a hundred and eighty. Anything you have heard but never answered waits a day.",
};

const RETURN_SCOPE_CHOICES = [
  ["both", "Words and sentences"],
  ["words", "Words only"],
  ["sentences", "Sentences and phrases only"],
] as const;

const VOLUME_SETTING = {
  de: "germanVolume",
  en: "englishVolume",
  fr: "frenchVolume",
  pl: "polishVolume",
  es: "spanishVolume",
  it: "italianVolume",
  pt: "portugueseVolume",
  ru: "russianVolume",
  el: "greekVolume",
  sq: "albanianVolume",
} as const;


export function ListenView({ active, apiParts, learningDirection, onOpen, profile }: {
  active: boolean;
  apiParts: Record<string, any>;
  learningDirection: LearningDirection;
  onOpen: () => void;
  profile: UserProfile | null;
}) {
  // Redraws once when this language's usage notes land.
  useUsageNotes();
  const [contentKinds, setContentKinds] = useState<ListenContentKind[]>(
    () => getListenContentKinds(learningDirection)
  );
  /**
   * The set as one string, for dependency arrays and stored cursors.
   *
   * A fresh array every render would rebuild the queue on every render, and
   * the cursor is filed under a name rather than under an array.
   */
  const contentKey = listenContentSourceKey(contentKinds);
  /**
   * Whether the loop is a mix of more than one kind of material.
   *
   * A count per kind only means anything when there is more than one kind to
   * balance; with a single source ticked the loop is simply "cards at a
   * time". This used to ask specifically for words AND sentences, which left
   * a learner playing sentences and paragraphs together — two kinds of very
   * different length — with no way to say how much of each.
   */
  const interleaves = contentKinds.length > 1;
  const [queueOrder, setQueueOrder] = useState<ListenQueueOrder>(
    () => getListenQueueOrder(learningDirection)
  );
  const [queueWithin, setQueueWithin] = useState<ListenQueueWithin>(
    () => getListenQueueWithin(learningDirection)
  );
  const [returnGap, setReturnGap] = useState<ListenReturnGap>(
    () => getListenReturnGap(learningDirection)
  );
  const [returnScope, setReturnScope] = useState<ListenReturnScope>(
    () => getListenReturnScope(learningDirection)
  );
  const [levelFilter, setLevelFilter] = useState<Set<CefrStep>>(
    () => getListenLevelFilters(learningDirection)
  );
  const [usefulnessFilter, setUsefulnessFilter] = useState<Set<ConversationUsefulness>>(
    () => getListenUsefulnessFilters(learningDirection)
  );
  const [mixedCounts, setMixedCounts] = useState(() => getListenMixedCounts(learningDirection));
  /** The counts on screen, in Content source order, for the kinds ticked. */
  const mixedKinds = ([
    ["words", ui("Words at a time"), ui("words"), ui("How many words you hear before they come round again")],
    ["sentences", ui("Sentences at a time"), ui("sentences"), ui("How many sentences and phrases you hear before they come round again")],
    ["passages", ui("Paragraphs at a time"), ui("paragraphs"), ui("How many paragraphs you hear before they come round again")],
  ] as const).filter(([kind]) => contentKinds.includes(kind));
  /** What one round adds up to: the ticked kinds only. */
  const mixedTotal = mixedKinds.reduce((sum, [kind]) => sum + mixedCounts[kind], 0);
  useEffect(() => { setMixedCounts(getListenMixedCounts(learningDirection)); }, [learningDirection, profile?.id]);
  // Grade writes made elsewhere (the tracker's "never review" star, lesson
  // grades) must reach this queue: it stays mounted across tab switches, so
  // without a revision it kept playing items the learner had removed. While
  // the view is active its own review actions already handle the live queue
  // via hiddenIds, so foreign writes are folded in when the view is next
  // opened instead of yanking the playhead mid-session.
  const [gradesRevision, setGradesRevision] = useState(0);
  const activeRef = useRef(active);
  const gradesDirtyRef = useRef(false);
  useEffect(() => {
    const onGradesUpdated = () => {
      if (activeRef.current) {
        gradesDirtyRef.current = true;
        return;
      }
      setGradesRevision((revision) => revision + 1);
    };
    window.addEventListener("grades-updated", onGradesUpdated);
    return () => window.removeEventListener("grades-updated", onGradesUpdated);
  }, []);
  useEffect(() => {
    activeRef.current = active;
    if (active && gradesDirtyRef.current) {
      gradesDirtyRef.current = false;
      setGradesRevision((revision) => revision + 1);
    }
  }, [active]);
  /**
   * The queue is built when Listen is first opened, not when it is mounted.
   *
   * This view stays mounted whichever screen you are on, so that playback
   * survives navigating away — which also meant it built a 20,019-item queue
   * on every start and every language change, for a screen nobody was looking
   * at. Measured on a language switch: 2,182ms of a 3,195ms frozen frame, and
   * the same again at startup.
   *
   * Once opened it stays open as far as this is concerned, so the queue lives
   * on behind the mini player exactly as it did before. `active` is enough on
   * its own — nothing plays without the view having been opened to press it.
   */
  const [everOpened, setEverOpened] = useState(active);
  useEffect(() => {
    if (active) setEverOpened(true);
  }, [active]);

  // The meaning is baked into the queue, not read off the card at render
  // time, so changing the app language has to rebuild it. Subscribed here
  // rather than leaning on the root: re-rendering alone would move the labels
  // and the voice to the new language and leave the lines themselves in the
  // old one, which is the one state worse than not following the setting.
  const appLanguage = useInterfaceLanguage();
  const courseLanguage = targetLanguage(learningDirection);
  const meaningLanguage = meaningLanguageFor(courseLanguage, appLanguage);

  /**
   * The meaning's table, if it is one that has to be fetched.
   *
   * The catalogue is built with every table this setup needs already in hand,
   * so on a cold start there is nothing to wait for here. Switching the app's
   * language while Listen is OPEN is the case this covers: the queue rebuilds
   * on the new meaning language immediately, and a card whose translation has
   * not arrived is dropped — so without this the screen goes empty for as long
   * as the download takes and then fills in, which reads as a fault.
   */
  /**
   * Flipping British/American rebuilds the queue.
   *
   * The conversion happens as the queue is built, so without this the setting
   * would take effect on the next thing that happened to invalidate it —
   * which reads as the switch not working.
   */
  const [englishVariantRevision, setEnglishVariantRevision] = useState(0);
  useEffect(() => {
    const onVariant = () => setEnglishVariantRevision((n) => n + 1);
    window.addEventListener(ENGLISH_VARIANT_EVENT, onVariant);
    return () => window.removeEventListener(ENGLISH_VARIANT_EVENT, onVariant);
  }, []);
  const [translationsRevision, setTranslationsRevision] = useState(0);
  useEffect(() => {
    if (meaningLanguage !== "fr" && meaningLanguage !== "pl" && meaningLanguage !== "es") return undefined;
    if (isTranslationLoaded(meaningLanguage)) return undefined;
    let live = true;
    const onLoaded = () => { if (live) setTranslationsRevision((n) => n + 1); };
    window.addEventListener(TRANSLATIONS_LOADED_EVENT, onLoaded);
    void ensureTranslations(meaningLanguage);
    return () => {
      live = false;
      window.removeEventListener(TRANSLATIONS_LOADED_EVENT, onLoaded);
    };
  }, [meaningLanguage]);

  const baseQueue = useMemo<ListenItem[]>(
    () => (everOpened
      ? buildListenQueue(apiParts, loadGradeStore(profile), {
        contentSource: contentKinds,
        direction: learningDirection,
        order: queueOrder,
        within: queueWithin,
        returnGap,
        returnScope,
        levels: levelFilter,
        usefulness: usefulnessFilter,
      })
      : []),
    [everOpened, apiParts, contentKey, englishVariantRevision, gradesRevision, learningDirection, levelFilter, meaningLanguage, profile, queueOrder, queueWithin, returnGap, returnScope, translationsRevision, usefulnessFilter]
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const queue = useMemo(
    () => {
      const visible = baseQueue.filter((candidate) => !hiddenIds.has(candidate.id));
      return interleaves
        ? arrangeListenMixedQueue(visible, mixedCounts, listenMixGroupFor(queueOrder))
        : visible;
    },
    // queueOrder is read through listenMixGroupFor: switching to or from
    // easiest-first changes whether the deal is grouped, and without the
    // dependency the queue would keep the previous order's arrangement.
    [baseQueue, interleaves, hiddenIds, mixedCounts, queueOrder]
  );
  const [loopItems, setLoopItems] = useState(() => getListenLoopItems(learningDirection));
  const [loopPasses, setLoopPasses] = useState(() => getListenLoopPasses(learningDirection));
  const [playhead, setPlayhead] = useState(() => {
    const storedId = getListenCurrentItemId(learningDirection, profile, contentKinds, queueOrder, queueWithin);
    const storedIndex = baseQueue.findIndex((candidate) => candidate.id === storedId);
    return listenPlayheadForQueueIndex(
      storedIndex >= 0 ? storedIndex : 0,
      baseQueue.length,
      getListenLoopItems(learningDirection),
      getListenLoopPasses(learningDirection)
    );
  });
  const [playing, setPlaying] = useState(false);
  /**
   * Read back rather than started at false.
   *
   * Opening a lesson is a page navigation, so this component is destroyed
   * and rebuilt around it. Starting closed meant a session the learner had
   * not closed disappeared the moment they went to do the thing the app is
   * for.
   */
  const [sessionActivated, setSessionActivated] = useState(() => readListenSession().live);
  const [backgroundPlayback, setBackgroundPlayback] = useState(
    () => getListenBackgroundPlayback(profile)
  );
  const [petBilingualCaptions, setPetBilingualCaptions] = useState(
    () => getListenPetBilingualCaptions(profile)
  );
  // Where the background player has been dragged to. The saved value is a
  // fraction of the viewport; dragPixels is the live position during a drag
  // and is cleared on resize so the fraction takes over again.
  const miniPlayerRef = useRef<HTMLElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [miniPlayerPosition, setMiniPlayerPosition] = useState<MiniPlayerPosition | null>(
    () => loadMiniPlayerPosition(profile)
  );
  const [dragPixels, setDragPixels] = useState<{ left: number; top: number } | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [targetRepeats, applyTargetRepeats] = useState(() => getListenTargetRepeats(learningDirection));
  const [meaningRepeats, applyMeaningRepeats] = useState(() => getListenMeaningRepeats(learningDirection));
  const [languageOrder, setLanguageOrder] = useState(() => getListenLanguageOrder(learningDirection));
  const [nextCardDelayMs, setNextCardDelayMs] = useState(getListenNextCardDelayMs);
  const [languageGapMs, setLanguageGapMs] = useState(getListenLanguageGapMs);
  const [yourTurn, setYourTurn] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(getAudioSettings);
  const [graded, setGraded] = useState<"know" | "difficult" | null>(null);
  /** The voice failed on this card: being asked again, or given up on. */
  const [voiceTrouble, setVoiceTrouble] = useState<"retrying" | "failed" | null>(null);
  const [silentRetry, setSilentRetry] = useState(0);
  const silentRetriesRef = useRef(0);
  /**
   * Which items this sitting has marked, and what the record looked like
   * first. Two jobs: the buttons stay lit for a mark you made, so stepping
   * back to a card shows what you decided about it rather than a blank pair
   * of buttons; and pressing a lit one takes the mark off again, which is
   * the same restore the Undo link performs.
   */
  const [sessionMarks, setSessionMarks] = useState<Map<string, { verdict: "know" | "difficult"; undo: ListenReviewChange }>>(
    () => new Map()
  );
  const [testing, setTesting] = useState(false);
  /** Where the bar is being dragged to, before the drag is let go of. */
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const [jumpBox, setJumpBox] = useState("");
  const [reviewPanel, setReviewPanel] = useState<"menu" | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ListenItem | null>(null);
  const [reviewNotice, setReviewNotice] = useState<ListenReviewNotice | null>(null);
  const timedHiddenIdsRef = useRef<Set<string>>(new Set());
  const runRef = useRef(0);
  const gradeAdvanceTimerRef = useRef<number | null>(null);
  const reviewCloseTimerRef = useRef<number | null>(null);
  const reviewWasPlayingRef = useRef(false);
  const mediaCommandRef = useRef<(command: ListenMediaCommand) => void>(() => {});
  const {
    selectedKey: selectedPetKey,
    selectedPet,
    speak: petSpeak,
    visibleKeys: visiblePetKeys,
  } = useCodexPets();

  const effectiveLoopItems = Math.min(Math.max(1, queue.length), interleaves ? mixedTotal : loopItems);
  const queueIndex = listenQueueIndexForPlayhead(
    playhead,
    queue.length,
    effectiveLoopItems,
    loopPasses
  );
  const loopPass = listenLoopPassForPlayhead(playhead, queue.length, effectiveLoopItems, loopPasses);
  const item = queue.length ? queue[queueIndex] : null;
  const nextItem = queue.length ? queue[(queueIndex + 1) % queue.length] : null;

  /**
   * What this sitting has actually played, oldest first.
   *
   * The test asks about these rather than about the queue, which is 23,000
   * long and mostly unheard. Ids only — the queue rebuilds when a setting
   * changes, and holding the objects would test yesterday's copy of a card.
   */
  const [heardIds, setHeardIds] = useState<string[]>([]);
  useEffect(() => {
    if (!item) return;
    setHeardIds((current) => (current[current.length - 1] === item.id
      ? current
      : [...current.filter((id) => id !== item.id), item.id].slice(-LISTEN_TEST_MAX_QUESTIONS * 3)));
  }, [item?.id]);
  const heardItems = useMemo(() => {
    const byId = new Map(queue.map((entry) => [entry.id, entry]));
    return heardIds.map((id) => byId.get(id)).filter((entry): entry is ListenItem => Boolean(entry));
  }, [heardIds, queue]);

  // Listen's two slots are named after the only two languages it ever had:
  // `de` and `en`. Neither name is a language any more — the first slot is
  // the language being LEARNED, the second is what it means in whatever the
  // app is written in, and the labels, the voices and the mute state all ask
  // what is in each slot rather than reading the name.
  //
  // The first slot is the target in every course now. The English course used
  // to be the exception: it kept its German first, so the big line at the top
  // of the card was the one language the learner was not there to learn, and
  // the translation was the small line underneath it. This has to agree with
  // buildListenQueue, which fills the slots with the text.
  const slotLanguage: { de: CourseLanguage; en: CourseLanguage } =
    { de: courseLanguage, en: meaningLanguage };
  const targetSlot = courseSide(slotLanguage.de);
  const meaningSlot = courseSide(slotLanguage.en);
  const targetLang = targetSlot.voice;
  const meaningLang = meaningSlot.voice;

  /**
   * The word-by-word reading of this card, where there is one to give.
   *
   * German into English only: the word bank behind it holds German words with
   * English meanings, so a French or Polish meaning has nothing to build the
   * line out of, and an English course would be glossing the language the
   * learner already speaks.
   */
  const literalLine = useMemo(
    () => (slotLanguage.de === "de" && slotLanguage.en === "en" && item
      ? literalGloss(item.de, item.en)
      : null),
    [item, slotLanguage.de, slotLanguage.en]
  );
  const turnLiterals = useMemo(
    () => (slotLanguage.de === "de" && slotLanguage.en === "en"
      ? (item?.turns ?? []).map((turn) => literalGloss(turn.de, turn.en))
      : []),
    [item, slotLanguage.de, slotLanguage.en]
  );

  /**
   * Fetch the next card's audio while this one is still playing.
   *
   * Every clip is generated by Microsoft on first request and cached after
   * that: measured against this machine's own server, a clip nobody has asked
   * for yet takes between half a second and three quarters of one to arrive,
   * and the same clip afterwards takes two milliseconds. Listen plays a queue
   * in a known order, so that wait is entirely avoidable — it was being paid
   * at the start of every new card, which on a one-word card is a longer
   * silence than the word.
   *
   * Both languages, because both are spoken. Failures are ignored by
   * preloadTts itself: this is a head start, and a card that has to fetch its
   * own audio is the behaviour that already existed.
   *
   * AT THE RATE PLAYBACK WILL ASK FOR, which is the whole trick. The rate is
   * part of the cache key, so warming 0.88 while the plan plays 0.92 and 0.95
   * fills the cache with entries nobody reads — the fetch still happens, at
   * the start of the card, which is exactly what this was written to stop.
   * The constants come from the plan itself now rather than being typed again
   * here, because typing them again here is how they came apart.
   *
   * And the card in front of you, not only the one after it. Warming solely
   * the next card leaves the first one of a sitting to fetch its own audio,
   * which is the one moment a learner is definitely watching.
   */
  useEffect(() => {
    const warm = (item: typeof nextItem) => {
      if (!item) return;
      if (item.de) preloadTts(item.de, LISTEN_TARGET_RATE, targetLang);
      if (item.en) preloadTts(item.en, LISTEN_MEANING_RATE, meaningLang);
    };
    if (playing) warm(nextItem);
    else warm(item);
  }, [item, meaningLang, nextItem, playing, targetLang]);
  const masterMuted = isMasterAudioSilent(audioSettings);
  const englishMuted = isTtsLanguageMuted(AUDIO_LANGUAGE[slotLanguage.en]);
  const germanMuted = isTtsLanguageMuted(AUDIO_LANGUAGE[slotLanguage.de]);
  const petCaptionsAvailable = Boolean(selectedPet)
    && selectedPetKey !== "off"
    && visiblePetKeys.includes(selectedPetKey);

  useEffect(() => {
    runRef.current += 1;
    stopTts();
    setPlaying(false);
    setSessionActivated(false);
    applyTargetRepeats(getListenTargetRepeats(learningDirection));
    applyMeaningRepeats(getListenMeaningRepeats(learningDirection));
    setLanguageOrder(getListenLanguageOrder(learningDirection));
    setLoopItems(getListenLoopItems(learningDirection));
    setMixedCounts(getListenMixedCounts(learningDirection));
    setLoopPasses(getListenLoopPasses(learningDirection));
    setBackgroundPlayback(getListenBackgroundPlayback(profile));
    setPetBilingualCaptions(getListenPetBilingualCaptions(profile));
    setContentKinds(getListenContentKinds(learningDirection));
    setQueueOrder(getListenQueueOrder(learningDirection));
  }, [learningDirection, profile?.id]);

  useEffect(() => {
    setHiddenIds(new Set());
    timedHiddenIdsRef.current.clear();
    const storedId = getListenCurrentItemId(learningDirection, profile, contentKinds, queueOrder, queueWithin);
    const restoredCounts = getListenMixedCounts(learningDirection);
    const restoredQueue = interleaves
      ? arrangeListenMixedQueue(baseQueue, restoredCounts, listenMixGroupFor(queueOrder))
      : baseQueue;
    const storedIndex = restoredQueue.findIndex((candidate) => candidate.id === storedId);
    setPlayhead(listenPlayheadForQueueIndex(
      storedIndex >= 0 ? storedIndex : 0,
      restoredQueue.length,
      interleaves
        ? restoredCounts.words + restoredCounts.sentences
        : getListenLoopItems(learningDirection),
      getListenLoopPasses(learningDirection)
    ));
  }, [apiParts, baseQueue, contentKey, interleaves, learningDirection, profile?.id, queueOrder, queueWithin]);

  useEffect(() => {
    const releaseDueItems = () => {
      const heldIds = timedHiddenIdsRef.current;
      if (!heldIds.size) return;
      const grades = loadGradeStore(profile);
      const now = Date.now();
      const released = [...heldIds].filter((id) => {
        const record = grades[id];
        const dueAt = Date.parse(record?.dueAt ?? "");
        const snoozedUntil = Date.parse(record?.snoozedUntil ?? "");
        return ![dueAt, snoozedUntil].some((until) => Number.isFinite(until) && now < until);
      });
      if (!released.length) return;
      released.forEach((id) => heldIds.delete(id));
      setHiddenIds((current) => {
        const next = new Set(current);
        released.forEach((id) => next.delete(id));
        return next;
      });
    };
    const timer = window.setInterval(releaseDueItems, 60_000);
    return () => window.clearInterval(timer);
  }, [profile?.id]);

  useEffect(() => {
    if (!item) return;
    setListenCurrentItemId(item.id, learningDirection, profile, contentKinds, queueOrder, queueWithin);
  }, [contentKey, item?.id, learningDirection, profile?.id, queueOrder, queueWithin]);

  useEffect(() => {
    const sync = () => setAudioSettings(getAudioSettings());
    window.addEventListener(AUDIO_SETTINGS_EVENT, sync);
    return () => window.removeEventListener(AUDIO_SETTINGS_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!reviewNotice) return undefined;
    const timer = window.setTimeout(() => setReviewNotice(null), reviewNotice.undo ? 8000 : 4500);
    return () => window.clearTimeout(timer);
  }, [reviewNotice]);

  useEffect(() => {
    if (!playing || !item) return undefined;
    const run = ++runRef.current;
    let advanceTimer: number | null = null;
    let heardSpeech = false;
    const markSpeechStarted = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail !== true) return;
      heardSpeech = true;
      silentRetriesRef.current = 0;
      setVoiceTrouble(null);
    };
    window.addEventListener(TTS_SPEAKING_EVENT, markSpeechStarted);

    const mirrorOnPet = (text: string, voiceLang: CodexPetVoiceLanguage) => {
      if (!petCaptionsAvailable) return;
      const caption = formatListenPetCaption(item, text, petBilingualCaptions);
      petSpeak(caption, {
        durationMs: Math.max(2600, Math.min(7000, caption.length * 72)),
        mood: "greeting",
        silent: true,
        verbatim: true,
        voiceLang,
      });
    };

    const sequence: SeqItem[] = buildListenSpeechPlan({
      de: item.de,
      en: item.en,
      meaningLang,
      meaningRepeats,
      targetRepeats,
      languageGapMs,
      languageOrder,
      targetLang,
      turns: item.turns,
    }).map((clip) => ({
      ...clip,
      onStart: () => mirrorOnPet(clip.text, clip.side === "target" ? targetLang : meaningLang),
      onPause: (holding: boolean) => setYourTurn(holding && runRef.current === run),
    }));
    void ttsSequence(sequence).then(() => {
      window.removeEventListener(TTS_SPEAKING_EVENT, markSpeechStarted);
      if (runRef.current !== run) return;
      if (!heardSpeech) {
        // Nothing was meant to be heard (every voice muted): stop, as before.
        // Otherwise the voice failed, and the card is asked for again before
        // the player gives up on it — advancing instead would race silently
        // through the queue for as long as the service is down.
        const audible = sequence.some((clip) => getTtsAudioVolume(clip.lang) > 0);
        const attempt = silentRetriesRef.current;
        if (audible && attempt < LISTEN_SILENT_RETRY_MS.length) {
          silentRetriesRef.current = attempt + 1;
          setVoiceTrouble("retrying");
          advanceTimer = window.setTimeout(() => {
            if (runRef.current !== run) return;
            setSilentRetry((current) => current + 1);
          }, LISTEN_SILENT_RETRY_MS[attempt]);
          return;
        }
        silentRetriesRef.current = 0;
        setVoiceTrouble(audible ? "failed" : null);
        setPlaying(false);
        return;
      }
      advanceTimer = window.setTimeout(() => {
        if (runRef.current !== run) return;
        setGraded(null);
        setPlayhead((current) => current + 1);
      }, nextCardDelayMs);
    });

    return () => {
      window.removeEventListener(TTS_SPEAKING_EVENT, markSpeechStarted);
      if (advanceTimer != null) window.clearTimeout(advanceTimer);
      // Pausing during the gap must take the prompt down with it, or the card
      // sits there telling a stopped player it is their turn.
      setYourTurn(false);
      stopTts();
    };
  }, [playing, playhead, silentRetry, targetRepeats, meaningRepeats, languageOrder, languageGapMs, nextCardDelayMs, item?.id, meaningLang, targetLang, queue.length, petBilingualCaptions, petCaptionsAvailable, petSpeak]);

  useEffect(() => () => {
    runRef.current += 1;
    if (gradeAdvanceTimerRef.current != null) {
      window.clearTimeout(gradeAdvanceTimerRef.current);
      gradeAdvanceTimerRef.current = null;
    }
    stopTts();
  }, []);

  const cancelGradeAdvance = () => {
    if (gradeAdvanceTimerRef.current == null) return;
    window.clearTimeout(gradeAdvanceTimerRef.current);
    gradeAdvanceTimerRef.current = null;
  };

  const forgetVoiceTrouble = () => {
    silentRetriesRef.current = 0;
    setVoiceTrouble(null);
  };

  const pause = () => {
    runRef.current += 1;
    stopTts();
    forgetVoiceTrouble();
    setPlaying(false);
  };

  const cancelReviewMenuClose = () => {
    if (reviewCloseTimerRef.current == null) return;
    window.clearTimeout(reviewCloseTimerRef.current);
    reviewCloseTimerRef.current = null;
  };

  const closeReviewPanel = (resumePlayback = true) => {
    cancelReviewMenuClose();
    setReviewPanel(null);
    setReviewTarget(null);
    if (resumePlayback && reviewWasPlayingRef.current) setPlaying(true);
    reviewWasPlayingRef.current = false;
  };

  const scheduleReviewPanelClose = () => {
    cancelReviewMenuClose();
    reviewCloseTimerRef.current = window.setTimeout(() => {
      reviewCloseTimerRef.current = null;
      closeReviewPanel();
    }, 180);
  };

  useEffect(() => () => {
    if (reviewCloseTimerRef.current != null) window.clearTimeout(reviewCloseTimerRef.current);
  }, []);

  const beginPlayback = () => {
    reviewWasPlayingRef.current = false;
    closeReviewPanel(false);
    forgetVoiceTrouble();
    setSessionActivated(true);
    setPlaying(true);
  };

  /** Everything a move has to undo before the card changes under it. */
  const leaveCurrentItem = () => {
    cancelGradeAdvance();
    runRef.current += 1;
    stopTts();
    setGraded(null);
    forgetVoiceTrouble();
    reviewWasPlayingRef.current = false;
    closeReviewPanel(false);
  };

  /**
   * Straight to a position in the queue.
   *
   * The arrows move one card and the queue is twenty-three thousand long, so
   * reaching anything you remember passing meant holding an arrow down. This
   * is the same primitive resume uses; it wraps, so 0 and the last item are
   * one step apart in either direction.
   */
  const jumpToQueueIndex = (index: number) => {
    if (queue.length === 0) return;
    leaveCurrentItem();
    setPlayhead(listenPlayheadForQueueIndex(index, queue.length, effectiveLoopItems, loopPasses));
  };

  const step = (direction: 1 | -1) => {
    leaveCurrentItem();
    setPlayhead((current) => {
      if (direction > 0) return current + 1;
      if (current > 0) return current - 1;
      return listenPlayheadForQueueIndex(
        Math.max(0, queue.length - 1),
        queue.length,
        effectiveLoopItems,
        loopPasses
      );
    });
  };

  const dismissBackgroundPlayer = () => {
    pause();
    setSessionActivated(false);
  };

  /**
   * Arrow keys move through the queue.
   *
   * The
   * buttons were the only way, which means a hand on the mouse for something
   * you do every few seconds while listening.
   *
   * Left and right only, and only on the Listen screen. Up and down are left
   * alone because they scroll the page, and a key pressed inside a text box
   * or on a focused control belongs to that control — a right arrow in the
   * volume slider should move the volume, not the queue.
   */
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // instanceof rather than a cast: a key event can arrive with the window
      // itself as its target, and window has no closest() to call.
      const target = event.target;
      if (target instanceof Element
        && target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      step(event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * Dragging the background player.
   *
   * Pointer events rather than mouse events, so a touchscreen and a pen work
   * without a second code path, and setPointerCapture keeps the drag alive
   * when the cursor outruns the element. The grab offset is taken once at
   * pointer-down so the player does not jump its own corner under the cursor.
   */
  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    // The controls are the point of the player; only the shell drags.
    if ((event.target as HTMLElement).closest("button, input, a, [role='slider']")) return;
    const element = miniPlayerRef.current;
    if (!element || event.button !== 0) return;
    const box = element.getBoundingClientRect();
    dragOffsetRef.current = { x: event.clientX - box.left, y: event.clientY - box.top };
    setDragSize({ width: box.width, height: box.height });
    // Where it already is, in pixels, so the first move continues from there
    // rather than from wherever the stored fraction rounds to.
    setDragPixels({ left: box.left, top: box.top });
    setDragging(true);
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return undefined;
    const element = miniPlayerRef.current;
    if (!element) return undefined;

    const move = (event: PointerEvent) => {
      const size = dragSize ?? { width: element.offsetWidth, height: element.offsetHeight };
      const maxLeft = Math.max(0, window.innerWidth - size.width);
      const maxTop = Math.max(0, window.innerHeight - size.height);
      setDragPixels({
        left: Math.min(maxLeft, Math.max(0, event.clientX - dragOffsetRef.current.x)),
        top: Math.min(maxTop, Math.max(0, event.clientY - dragOffsetRef.current.y)),
      });
    };
    const end = () => {
      setDragging(false);
      const size = dragSize ?? { width: element.offsetWidth, height: element.offsetHeight };
      setDragPixels((pixels) => {
        if (pixels) {
          const fraction = miniPlayerFraction(
            pixels,
            size,
            { width: window.innerWidth, height: window.innerHeight }
          );
          setMiniPlayerPosition(fraction);
          saveMiniPlayerPosition(fraction, profile);
        }
        return pixels;
      });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, dragSize, profile]);

  // A resized window must not strand the player off the edge, so the stored
  // fraction is re-read against the new viewport rather than kept in pixels.
  useEffect(() => {
    if (dragging) return undefined;
    const settle = () => setDragPixels(null);
    window.addEventListener("resize", settle);
    return () => window.removeEventListener("resize", settle);
  }, [dragging]);

  const miniPlayerStyle = (() => {
    if (dragPixels) {
      return { left: `${dragPixels.left}px`, top: `${dragPixels.top}px`, right: "auto", bottom: "auto" } as const;
    }
    if (!miniPlayerPosition) return undefined;
    const element = miniPlayerRef.current;
    const size = {
      width: element?.offsetWidth || 680,
      height: element?.offsetHeight || 96,
    };
    const { left, top } = miniPlayerPixels(miniPlayerPosition, size, {
      width: typeof window === "undefined" ? 1280 : window.innerWidth,
      height: typeof window === "undefined" ? 800 : window.innerHeight,
    });
    return { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" } as const;
  })();

  mediaCommandRef.current = (command) => {
    if (command === "previous") step(-1);
    else if (command === "next") step(1);
    else if (command === "pause") pause();
    else if (command === "play") beginPlayback();
    else if (playing) pause();
    else beginPlayback();
  };

  useEffect(() => {
    if (active || backgroundPlayback) return;
    pause();
  }, [active, backgroundPlayback]);

  /**
   * Tell the rest of the app what Listen is doing.
   *
   * Two things read this. A lesson asks whether to keep quiet before speaking
   * a word on its own, and this component asks on its next page load whether
   * there was a session to come back to.
   *
   * Only written when background play is on: a session that is not allowed to
   * outlive this screen has nothing to say to anything on another one.
   */
  useEffect(() => {
    const live = sessionActivated && backgroundPlayback;
    writeListenSession({ live, playing: live && playing });
  }, [backgroundPlayback, playing, sessionActivated]);

  const mediaAvailable = Boolean(item)
    && (active || (backgroundPlayback && sessionActivated));

  useEffect(() => {
    if (!desktop?.onListenMediaCommand) return undefined;
    return desktop.onListenMediaCommand((command) => mediaCommandRef.current(command));
  }, []);

  useEffect(() => {
    desktop?.setListenMediaState?.({
      available: mediaAvailable,
      playing: mediaAvailable && playing,
      title: item?.en,
      subtitle: item?.de,
    });
  }, [item?.de, item?.en, mediaAvailable, playing]);

  useEffect(() => () => {
    desktop?.setListenMediaState?.({ available: false, playing: false });
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return undefined;
    const invoke = (command: ListenMediaCommand) => () => mediaCommandRef.current(command);
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ["previoustrack", invoke("previous")],
      ["nexttrack", invoke("next")],
      ["play", invoke("play")],
      ["pause", invoke("pause")],
    ];
    handlers.forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    });
    return () => {
      handlers.forEach(([action]) => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* already gone */ }
      });
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = !mediaAvailable
        ? "none"
        : playing ? "playing" : "paused";
      navigator.mediaSession.metadata = mediaAvailable && item && typeof MediaMetadata !== "undefined"
        ? new MediaMetadata({
            album: ui("Listen"),
            artist: item.de,
            artwork: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
            title: item.en,
          })
        : null;
    } catch { /* browser media controls are an enhancement */ }
  }, [item?.de, item?.en, mediaAvailable, playing]);

  /** The mark this sitting has on the item currently on screen, if any. */
  const itemMark = item ? sessionMarks.get(item.id)?.verdict ?? null : null;

  const clearMark = (target: ListenItem) => {
    const existing = sessionMarks.get(target.id);
    if (!existing) return;
    undoListenReviewChange(existing.undo, profile);
    setSessionMarks((current) => {
      const next = new Map(current);
      next.delete(target.id);
      return next;
    });
    setReviewNotice({
      message: uiFmt("Took the mark off “{item}”.", { item: target.de }),
    });
  };

  const grade = (verdict: "know" | "difficult") => {
    if (!item || gradeAdvanceTimerRef.current != null) return;
    reviewWasPlayingRef.current = false;
    closeReviewPanel(false);
    // Pressing the mark that is already on takes it off, and stays on the
    // card — the point of an unmark is that you did not mean to move on.
    if (sessionMarks.get(item.id)?.verdict === verdict) {
      setGraded(null);
      clearMark(item);
      return;
    }
    const fresh = recordListenGrade(item, verdict, profile);
    // Re-marking an item keeps the ORIGINAL snapshot, not the one taken after
    // the first mark — otherwise Undo restores the earlier mark instead of
    // the state before any of this.
    const undo = sessionMarks.get(item.id)?.undo ?? fresh;
    const target = { ...item, aliases: [...item.aliases] };
    setSessionMarks((current) => {
      const next = new Map(current);
      next.set(item.id, { verdict, undo });
      return next;
    });
    setReviewNotice({
      message: uiFmt("“{item}” marked as {verdict}.", {
        item: item.de,
        verdict: ui(verdict === "know" ? "Know it" : "Struggle"),
      }),
      undo: { change: undo, item: target },
    });
    setGraded(verdict);
    runRef.current += 1;
    stopTts();
    gradeAdvanceTimerRef.current = window.setTimeout(() => {
      gradeAdvanceTimerRef.current = null;
      setGraded(null);
      setPlayhead((current) => current + 1);
    }, 350);
  };

  const openReviewPanel = () => {
    cancelReviewMenuClose();
    if (reviewPanel) return;
    if (!item) return;
    // A review action must never chase autoplay onto the next card. Stop the
    // current sequence and keep an immutable target until the menu closes.
    cancelGradeAdvance();
    reviewWasPlayingRef.current = playing;
    pause();
    setReviewTarget({ ...item, aliases: [...item.aliases] });
    setReviewPanel("menu");
  };

  const applyReviewLevel = (level: ListenReviewLevel, label: string) => {
    const target = reviewTarget;
    if (!target) return;
    const change = setListenReviewLevel(target, level, profile);
    setReviewNotice({
      message: uiFmt("“{item}” set to {level}.", { item: target.de, level: ui(label) }),
      undo: { change, item: target },
    });
    reviewWasPlayingRef.current = false;
    closeReviewPanel(false);
    if (typeof level === "number" || level === "permanent") {
      // Timed levels finish the current item until its scheduled review date;
      // Never review removes it permanently. Drop either choice from this
      // queue too, which slides the next item into place immediately. Future
      // sessions apply the same due-date rule in buildListenQueue.
      cancelGradeAdvance();
      setHiddenIds((current) => new Set(current).add(target.id));
      if (typeof level === "number") timedHiddenIdsRef.current.add(target.id);
    }
  };

  const undoReviewLevel = () => {
    const pending = reviewNotice?.undo;
    if (!pending) return;
    undoListenReviewChange(pending.change, profile);
    // Undo and the lit button are two faces of the same mark, so taking it
    // back here has to unlight the button as well.
    setSessionMarks((current) => {
      if (!current.has(pending.item.id)) return current;
      const next = new Map(current);
      next.delete(pending.item.id);
      return next;
    });
    timedHiddenIdsRef.current.delete(pending.item.id);
    setHiddenIds((current) => {
      if (!current.has(pending.item.id)) return current;
      const next = new Set(current);
      next.delete(pending.item.id);
      return next;
    });
    setReviewNotice({
      message: uiFmt("Undid the level change for “{item}”.", { item: pending.item.de }),
    });
  };

  const putOff = (days: number, label: string) => {
    const target = reviewTarget;
    if (!target) return;
    cancelGradeAdvance();
    snoozeListenItem(target, days, profile);
    setReviewNotice({ message: uiFmt("Put off until {when}.", { when: ui(label) }) });
    reviewWasPlayingRef.current = false;
    closeReviewPanel(false);
    timedHiddenIdsRef.current.add(target.id);
    setHiddenIds((current) => new Set(current).add(target.id));
  };

  const commitTargetRepeats = (count: number) => {
    const next = setListenTargetRepeats(count, learningDirection);
    applyTargetRepeats(next);
    return next;
  };

  const commitMeaningRepeats = (count: number) => {
    const next = setListenMeaningRepeats(count, learningDirection);
    applyMeaningRepeats(next);
    return next;
  };

  const commitLoopItems = (count: number) => {
    const next = setListenLoopItems(count, learningDirection);
    setLoopItems(next);
    setPlayhead(listenPlayheadForQueueIndex(queueIndex, queue.length, next, loopPasses));
    return next;
  };

  const commitMixedCounts = (counts: { words: number; sentences: number; passages: number }) => {
    const currentId = item?.id ?? "";
    const next = setListenMixedCounts(counts, learningDirection);
    const visible = baseQueue.filter((candidate) => !hiddenIds.has(candidate.id));
    const nextQueue = arrangeListenMixedQueue(visible, next, listenMixGroupFor(queueOrder));
    const nextIndex = Math.max(0, nextQueue.findIndex((candidate) => candidate.id === currentId));
    setMixedCounts(next);
    setPlayhead(listenPlayheadForQueueIndex(
      nextIndex,
      nextQueue.length,
      // The loop is as long as the kinds being played add up to — counting a
      // kind that is not ticked would put the playhead on a card the queue
      // does not contain.
      contentKinds.reduce((sum, kind) => sum + next[kind], 0),
      loopPasses
    ));
    return next;
  };

  const commitLoopPasses = (count: number) => {
    const next = setListenLoopPasses(count, learningDirection);
    setLoopPasses(next);
    setPlayhead(listenPlayheadForQueueIndex(queueIndex, queue.length, effectiveLoopItems, next));
    return next;
  };

  const chooseLanguageOrder = (order: ListenLanguageOrder) => {
    setLanguageOrder(setListenLanguageOrder(order, learningDirection));
  };

  /**
   * Tick a kind on or off, refusing to leave nothing playing.
   *
   * Turning off the last one would empty the queue, which is not a setting
   * anybody means — so the press does nothing rather than silently choosing
   * something else on the learner's behalf.
   */
  const toggleContentKind = (kind: ListenContentKind) => {
    const on = contentKinds.includes(kind);
    if (on && contentKinds.length === 1) return;
    const next = on
      ? contentKinds.filter((entry) => entry !== kind)
      : LISTEN_CONTENT_KINDS.filter((entry) => entry === kind || contentKinds.includes(entry));
    setContentKinds(setListenContentKinds(next, learningDirection));
  };

  const chooseAllContentKinds = () => {
    setContentKinds(setListenContentKinds(LISTEN_CONTENT_KINDS, learningDirection));
  };

  const chooseReturnGap = (gap: ListenReturnGap) => {
    setReturnGap(setListenReturnGap(gap, learningDirection));
  };

  const chooseReturnScope = (scope: ListenReturnScope) => {
    setReturnScope(setListenReturnScope(scope, learningDirection));
  };

  const chooseQueueWithin = (within: ListenQueueWithin) => {
    setQueueWithin(setListenQueueWithin(within, learningDirection));
  };

  const chooseQueueOrder = (order: ListenQueueOrder) => {
    setQueueOrder(setListenQueueOrder(order, learningDirection));
    // Newest first cannot also be what leads each pack — every card in a
    // pack shares its pack — so that button is not offered, and a stored
    // choice that has just become the order would leave the row with
    // nothing lit and the queue quietly using the default anyway.
    if ((order as string) === queueWithin) {
      setQueueWithin(setListenQueueWithin(DEFAULT_LISTEN_QUEUE_WITHIN, learningDirection));
    }
  };

  /**
   * Tick and untick, rather than pick one.
   *
   * An empty set is every level, so unticking the last box returns to
   * playing everything instead of emptying the queue — "none selected" and
   * "no filter" are the same statement, and treating them differently would
   * leave a control whose only escape is the button that clears both.
   */
  const toggleLevelFilter = (level: CefrStep) => {
    const next = new Set(levelFilter);
    if (next.has(level)) next.delete(level); else next.add(level);
    setLevelFilter(setListenLevelFilters(next, learningDirection));
  };

  const toggleUsefulnessFilter = (band: ConversationUsefulness) => {
    const next = new Set(usefulnessFilter);
    if (next.has(band)) next.delete(band); else next.add(band);
    setUsefulnessFilter(setListenUsefulnessFilters(next, learningDirection));
  };

  const commitDelaySeconds = (seconds: number) => {
    const nextMs = setListenNextCardDelayMs(seconds * 1000);
    setNextCardDelayMs(nextMs);
    return nextMs / 1000;
  };

  const commitLanguageGapSeconds = (seconds: number) => {
    const nextMs = setListenLanguageGapMs(seconds * 1000);
    setLanguageGapMs(nextMs);
    return nextMs / 1000;
  };

  const chooseBackgroundPlayback = (enabled: boolean) => {
    setBackgroundPlayback(setListenBackgroundPlayback(enabled, profile));
  };

  const choosePetBilingualCaptions = (enabled: boolean) => {
    setPetBilingualCaptions(setListenPetBilingualCaptions(enabled, profile));
  };

  if (!item) {
    // A filter can empty the queue, and this return sits ABOVE the panel that
    // holds the filter buttons — so the honest message matters more than
    // usual. Told to wait for content that is already loaded, with the only
    // controls that would undo it no longer on screen, there is no way back
    // except clearing storage. The narrowing says so and offers the way out.
    const narrowed = levelFilter.size > 0 || usefulnessFilter.size > 0;
    return active ? (
      <section className="card p-6 text-center">
        <Headphones className="mx-auto h-8 w-8 text-[var(--text-3)]" />
        <p className="mt-3 text-sm font-black text-[var(--text-1)]">
          {narrowed ? ui("Nothing matches those filters") : ui("Nothing to listen to yet")}
        </p>
        <p className="mt-1 text-xs font-semibold text-[var(--text-3)]">
          {narrowed
            ? ui("There is nothing at that level and usefulness together. Widen either one and the queue comes back.")
            : ui("Once the course content is loaded, everything you are learning becomes listenable here.")}
        </p>
        {/*
          One way out per filter, not one way out of both.

          Thirteen of the forty-two level-and-usefulness pairs are genuinely
          empty — every B1-and-up level crossed with the beginner bands — and
          the only button here cleared BOTH filters. A learner who had chosen
          B2 and then tapped a usefulness band lost the B2 as well, and had to
          find it again in the panel below. The empty state names what it is
          about to widen, and widens only that; clearing everything stays as
          the last option, for when both were the problem.
        */}
        {narrowed ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {levelFilter.size > 0 ? (
              <button
                className="min-h-10 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-xs font-black text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                data-testid="listen-clear-level-filter"
                onClick={() => setLevelFilter(setListenLevelFilters([], learningDirection))}
                type="button"
              >
                {ui("All levels")}
              </button>
            ) : null}
            {usefulnessFilter.size > 0 ? (
              <button
                className="min-h-10 rounded-xl border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-xs font-black text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                data-testid="listen-clear-usefulness-filter"
                onClick={() => setUsefulnessFilter(setListenUsefulnessFilters([], learningDirection))}
                type="button"
              >
                {ui("All usefulness levels")}
              </button>
            ) : null}
            {levelFilter.size > 0 && usefulnessFilter.size > 0 ? (
              <button
                className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-xs font-black text-[var(--text-2)]"
                data-testid="listen-clear-filters"
                onClick={() => {
                  setLevelFilter(setListenLevelFilters([], learningDirection));
                  setUsefulnessFilter(setListenUsefulnessFilters([], learningDirection));
                }}
                type="button"
              >
                {ui("Play everything again")}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    ) : null;
  }

  if (!active) {
    if (!backgroundPlayback || !sessionActivated || typeof document === "undefined") return null;
    return createPortal(
      <aside
        ref={miniPlayerRef}
        aria-label={ui("Listen player")}
        className="listen-mini-player"
        data-dragging={dragging ? "true" : "false"}
        data-playing={playing ? "true" : "false"}
        data-testid="listen-background-player"
        onPointerDown={beginDrag}
        style={miniPlayerStyle}
      >
        {/*
          A handle, so the player looks draggable before anybody tries it.
          Dragging works anywhere on the shell too — beginDrag ignores the
          controls — but a grip is the part people reach for.
        */}
        <span
          aria-hidden="true"
          className="listen-mini-player__grip"
          title={ui("Drag to move")}
        >
          <GripVertical />
        </span>
        <button className="listen-mini-player__copy" onClick={onOpen} type="button">
          <span className="listen-mini-player__art" aria-hidden="true">
            <Headphones />
          </span>
          <span className="listen-mini-player__text">
            <small>
              <Minimize2 />
              {/* Shrinks and ellipses so the count beside it never gets
                  pushed out: which item you are on is the part you cannot
                  work out from anywhere else in the collapsed player. */}
              <span className="listen-mini-player__state">
                {ui(playing ? "Playing in the background" : "Listen is paused")}
              </span>
              {queue.length > 0 && (
                <span
                  className="listen-mini-player__pos"
                  title={uiFmt("{position} of {total}", {
                    position: uiNumber(queueIndex + 1),
                    total: uiNumber(queue.length),
                  })}
                >
                  · {uiNumber(queueIndex + 1)} / {uiNumber(queue.length)}
                </span>
              )}
            </small>
            <strong lang="de">{item.de}</strong>
            <span lang="en">{item.en}</span>
          </span>
        </button>
        <div className="listen-mini-player__controls">
          {/*
            The same speaker every other screen has, rather than a mute button
            and a volume slider that only this player had.

            The two controls here did what they said and stopped there: the one
            thing a listening session actually wants adjusting mid-play is how
            fast a language is read, and that lived three screens away in
            settings. The shared control carries the master and per-language
            speeds with it, opens on hover, and behaves the way the speaker in
            the top bar already taught everybody it behaves.
          */}
          <div className="listen-mini-player__volume">
            <MuteButton iconClassName="h-4 w-4" />
          </div>
          <button aria-label={ui("Previous item")} className="listen-mini-player__step" onClick={() => step(-1)} type="button">
            <ChevronLeft />
          </button>
          <button
            aria-label={ui(playing ? "Pause" : "Play audio")}
            className="is-primary"
            onClick={playing ? pause : beginPlayback}
            type="button"
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button aria-label={ui("Next item")} className="listen-mini-player__step" onClick={() => step(1)} type="button">
            <ChevronRight />
          </button>
          <button aria-label={ui("Close Listen player")} onClick={dismissBackgroundPlayer} type="button">
            <X />
          </button>
        </div>
      </aside>,
      document.body
    );
  }

  // The test takes the whole page rather than sitting under the player: the
  // player is a wall of controls and settings, and none of it is any help
  // while you are trying to remember what a word meant.
  if (testing) {
    return (
      <div className="listen-view mx-auto w-full max-w-3xl space-y-4">
        <ListenTest heard={heardItems} onClose={() => setTesting(false)} pool={queue} />
      </div>
    );
  }

  return (
    <div className="listen-view mx-auto w-full max-w-7xl space-y-4">
      <section className="listen-shell">
        {/* One frame around the two things that are the same thing: what is
            playing, and what it says. The card used to be a second bordered
            box inside this one, which drew a line between the heading and the
            card it heads. A rule does that job without a second frame. */}
        <div className="listen-panel card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-dim)] text-[var(--accent)]">
              <Headphones className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-[var(--text-1)]">{ui("Listen")}</h1>
              <p className="text-xs font-semibold text-[var(--text-3)]">
                {ui("Both languages repeat in small learning loops while you do something else.")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-black text-[var(--text-2)]">
            <span>
              {languageOrder === "meaning-first"
                ? uiFmt("{meaning} {en}×, then {target} {de}×", {
                  de: targetRepeats, en: meaningRepeats,
                  meaning: ui(meaningSlot.label), target: ui(targetSlot.label),
                })
                : uiFmt("{target} {de}×, then {meaning} {en}×", {
                  de: targetRepeats, en: meaningRepeats,
                  meaning: ui(meaningSlot.label), target: ui(targetSlot.label),
                })}
            </span>
            {languageGapMs > 0 && (
              <>
                <span aria-hidden="true" className="text-[var(--text-3)]">·</span>
                <span>{uiFmt("{seconds}s for you", { seconds: uiNumber(languageGapMs / 1000) })}</span>
              </>
            )}
            <span aria-hidden="true" className="text-[var(--text-3)]">·</span>
            <span>{interleaves
              ? uiFmt("{mix} at a time, heard {passes}×", { mix: mixedKinds.map(([kind, , suffix]) => `${mixedCounts[kind]} ${suffix}`).join(" + "), passes: loopPasses })
              : uiFmt("{items} cards at a time, heard {passes}×", { items: effectiveLoopItems, passes: loopPasses })}</span>
          </div>
        </div>

        <div
          className={cn(
            "listen-card relative mx-1 mt-5 border-t border-[var(--border)] pt-6 text-center sm:mx-3 sm:pt-8"
          )}
        >
          {/* The voice, drawn from the voice. These are the real frequency
              bands of the clip being spoken — the same reading the guided
              session uses — rather than a loop that runs whether or not
              anything is playing. Flanking the card because that is where the
              room is; they are decoration and are hidden from the reader.
              Listening always, rather than only while the queue is running:
              tapping a single word speaks too, and gating this on the player
              meant the row sat still through the one kind of playback you are
              looking straight at when you start it. Nothing arrives while
              nothing is spoken, so listening costs nothing then. */}
          <TtsWaveform active bars={44} className="listen-wave listen-wave--left" />
          <TtsWaveform active bars={44} className="listen-wave listen-wave--right" />
          {/* The level sits in the line that already says what this card is,
              because the default order is now a walk up through the levels and
              there was no way to see where in that walk you were. A CEFR label
              is the same word in every language, so it is printed rather than
              translated; a pack with no level simply omits it instead of
              printing a gap. */}
          <p className="text-[11px] font-black uppercase tracking-wide text-[var(--accent)]">
            {/* Three separate ui() calls rather than one around a nested
                ternary: the coverage sweep reads the argument of each call,
                and a third branch inside one of them is a string it never
                sees — so it would ship untranslated and nothing would say so. */}
            {item.kind === "word" ? ui("Word")
              : item.kind === "passage" ? ui("Paragraph")
              : ui("Sentence")}
            {item.levelLabel ? <> · {item.levelLabel}</> : item.rung ? <> · {cefrRungLabel(item.rung)}</> : null}
            {" · "}{queueIndex + 1} / {queue.length}
            {loopPasses > 1 && <> · {uiFmt("Learning pass {pass} of {passes}", { pass: loopPass, passes: loopPasses })}</>}
          </p>
          {/* A word at a time, with the same popover the lesson uses: the
              meaning, then Hear it and Practice this word. Listen plays a line
              twice and moves on, so the one word that blocked the sentence
              would otherwise stay blocked — and knowing what it meant is only
              half of it, since the next thing you want is to keep it.
              Tapping a word pauses the loop rather than talking over it. */}
          {/* A conversation is shown as the conversation it is.
              Both sides joined into one paragraph read as a monologue with
              the turns rubbed out, which is the half of a dialogue worth
              hearing. Each turn keeps its own line, its speaker and its
              meaning underneath, so the eye follows the same back-and-forth
              the two voices are reading. */}
          {item.turns && item.turns.length > 1 ? (
            <div className="listen-turns">
              {item.turns.map((turn, turnIndex) => (
                <div
                  className={cn("listen-turn", turn.side === "b" && "is-b")}
                  key={`${turn.side}-${turnIndex}`}
                >
                  <span aria-hidden="true" className="listen-turn-who">
                    {turn.side === "b" ? "B" : "A"}
                  </span>
                  <p className="listen-turn-said" lang={targetSlot.htmlLang}>
                    <TappableSentence text={turn.de} lang={targetLang} meaningText={turn.en} onWordAudio={pause} />
                  </p>
                  <p className="listen-turn-means" lang={meaningSlot.htmlLang}>{turn.en}</p>
                  {/* Every turn gets the same word-by-word reading the single
                      sentence gets — a dialogue is where German's order is
                      furthest from English's, so leaving it off here would
                      drop the line exactly where it earns the most. */}
                  {turnLiterals[turnIndex] ? (
                    <p className="listen-literal listen-turn-literal" lang="en">
                      <b>{ui("Literally")}</b>
                      {turnLiterals[turnIndex]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="listen-sentence text-2xl font-black leading-snug tracking-tight text-[var(--text-1)] sm:text-3xl" lang={targetSlot.htmlLang}>
                <TappableSentence text={item.de} lang={targetLang} meaningText={item.en} onWordAudio={pause} />
              </p>
              <p className="text-base font-bold leading-relaxed text-[var(--accent)]" lang={meaningSlot.htmlLang}>
                {item.en}
              </p>
              {/* The same sentence read word by word, in German's order. The
                  translation above says what the sentence means and hides how
                  it is built; this line puts the words back where German has
                  them, which is the half a listener cannot hear. It is derived
                  from the same word bank a tap uses, so nothing here is a
                  second translation that could drift from the first, and it
                  stays away where every word would have to be guessed at. */}
              {literalLine ? (
                <p className="listen-literal" lang="en">
                  <b>{ui("Literally")}</b>
                  {literalLine}
                </p>
              ) : null}
            </>
          )}
          {/* How the same sentence is WRITTEN, when the card teaches how it is
              said. The course teaches the spoken form because that is what
              people say — "Ich hab das nicht ganz verstanden" — and in print
              it is "habe". Somebody who only ever hears it has no idea how to
              spell it, which is the half of the language Listen cannot teach
              on its own. The lesson has shown this for a while; this is the
              same line, in the mode where it is most needed. */}
          {item.long && item.long.trim() !== item.de.trim() ? (
            <p className="flex justify-center">
              <span className="written-note" lang={targetSlot.htmlLang}>
                <b>{ui("Written")}</b>
                {item.long}
              </span>
            </p>
          ) : null}
          {/* Which of the word's meanings this card is on. A heard word brings
              no context with it, so "weiter" spoken aloud and glossed "further"
              leaves the learner who was thinking of "carry on" unable to tell
              whether they were wrong. Two or three words settle it while the
              card is still up; the use note underneath explains it afterwards. */}
          {item.kind === "word" && item.senseTag ? (
            <p className="flex justify-center">
              <span className="sense-note">
                {uiFmt("Meaning here: {sense}", { sense: item.senseTag })}
              </span>
            </p>
          ) : null}
          {yourTurn ? (
            <p
              aria-live="polite"
              className="listen-your-turn"
              data-testid="listen-your-turn"
              style={{ "--gap-duration": `${languageGapMs}ms` } as React.CSSProperties}
            >
              {ui(YOUR_TURN_LABEL[languageOrder === "meaning-first" ? slotLanguage.de : slotLanguage.en])}
              <span aria-hidden="true" className="listen-your-turn__bar">
                <span className="listen-your-turn__fill" />
              </span>
            </p>
          ) : null}
          {/* Register warning. Like the use note below it, this is not
              word-only: the 762 items it can appear on are mostly
              sentences, and "Ich komm." is exactly the card that needs it. */}
          {item.tierNote ? (
            <p className="flex justify-center">
              <span
                className="register-note"
                title={ui("Not everyday neutral German — use in the right company")}
              >
                {uiOr(item.tierNote, "Besonderer Sprachgebrauch")}
              </span>
            </p>
          ) : null}
          {/* The note, on a sentence as well as on a word. Listen is where
              a card arrives with the least context — no pack around it, no
              scene, often no screen — and 12,490 sentences carry a note that
              was being withheld exactly there. Length was the worry and it
              does not hold: a sentence note runs 83 characters at the median
              against a word's 61, and 147 against 133 at the ninetieth, so it
              is the same line or two in the same box. */}
          {item.use ? (
            <p className="mx-auto max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold leading-relaxed text-[var(--text-3)]">
              {usageNote(item.use)}
            </p>
          ) : null}
          {item.kind === "word" && (item.synonyms?.length ?? 0) > 0 ? (
            <p
              className="mx-auto max-w-3xl text-sm font-semibold leading-relaxed text-[var(--text-3)]"
              title={ui("Same meaning — the most common word leads this card.")}
            >
              <span className="font-black text-sky-600">{ui("Also")}: </span>
              {(item.synonyms ?? []).map((syn, index) => (
                <span key={syn.de}>
                  {index > 0 && <span aria-hidden="true"> · </span>}
                  <span className="font-bold text-[var(--text-2)]" lang="de">{syn.de}</span>
                  {syn.label && <span> ({ui(syn.label)})</span>}
                </span>
              ))}
            </p>
          ) : null}

          <div
            aria-labelledby="listen-review-heading"
            className="listen-card-review border-t border-[var(--border)]"
            onBlurCapture={(event) => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
              scheduleReviewPanelClose();
            }}
            onMouseEnter={cancelReviewMenuClose}
            onMouseLeave={scheduleReviewPanelClose}
            role="group"
          >
            <h2 className="sr-only" id="listen-review-heading">{ui("Review this item")}</h2>
            <p className="text-[11px] font-semibold text-[var(--text-3)]">
              {ui("Hover over Know it, or open its menu, for exact levels and Put off.")}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <div
                className="inline-flex"
                data-testid="listen-know-options"
                onFocusCapture={openReviewPanel}
                onMouseEnter={openReviewPanel}
              >
                <button
                  aria-pressed={itemMark === "know"}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-l-xl border border-r-0 px-4 text-sm font-black transition-colors",
                    graded === "know" || itemMark === "know"
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/18 dark:text-emerald-300"
                  )}
                  onClick={() => grade("know")}
                  title={itemMark === "know" ? ui("Marked as known. Press to take the mark off.") : undefined}
                  type="button"
                >
                  <Check className="h-4 w-4" /> {ui(itemMark === "know" ? "Known" : "Know it")}
                </button>
                <button
                  aria-expanded={reviewPanel === "menu"}
                  aria-haspopup="menu"
                  aria-label={ui("More Know it options")}
                  className={cn(
                    "inline-grid h-11 w-9 place-items-center rounded-r-xl border text-sm font-black transition-colors",
                    graded === "know" || itemMark === "know"
                      ? "border-emerald-500 border-l-white/30 bg-emerald-500 text-white"
                      : "border-emerald-500/30 border-l-emerald-500/15 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/18 dark:text-emerald-300"
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (reviewPanel) closeReviewPanel();
                    else openReviewPanel();
                  }}
                  title={ui("More Know it options")}
                  type="button"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", reviewPanel && "rotate-180")} />
                </button>
              </div>
              <button
                aria-pressed={itemMark === "difficult"}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black transition-colors",
                  graded === "difficult" || itemMark === "difficult"
                    ? "border-rose-500 bg-rose-500 text-white"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/18 dark:text-rose-300"
                )}
                onClick={() => grade("difficult")}
                title={itemMark === "difficult" ? ui("Marked as a struggle. Press to take the mark off.") : undefined}
                type="button"
              >
                <X className="h-4 w-4" /> {ui(itemMark === "difficult" ? "Struggling" : "Struggle")}
              </button>
            </div>

            {reviewPanel === "menu" && (
              <div
                aria-label={ui("More Know it options")}
                /* Floating, not in the flow: as a block it made the card
                   taller than its space and put a scrollbar on it. */
                className="absolute inset-x-0 top-full z-30 mx-auto mt-2 w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left shadow-[0_12px_30px_var(--shadow)]"
                data-testid="listen-review-menu"
                onMouseEnter={cancelReviewMenuClose}
                role="menu"
              >
                <section aria-labelledby="listen-review-level-title">
                  <strong className="block text-xs font-black text-[var(--text-1)]" id="listen-review-level-title">{ui("Set level")}</strong>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {REVIEW_LEVELS.map((option) => (
                      <button
                        className={cn(
                          "rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]",
                          option.value === "struggle" && "hover:border-rose-400 hover:bg-rose-500/10"
                        )}
                        key={String(option.value)}
                        onClick={() => applyReviewLevel(option.value, option.label)}
                        role="menuitem"
                        type="button"
                      >
                        <strong className="block text-xs font-black text-[var(--text-1)]">{ui(option.label)}</strong>
                        <small className="mt-1 block text-[10px] font-semibold leading-snug text-[var(--text-3)]">{ui(option.note)}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section aria-labelledby="listen-review-snooze-title" className="mt-3 border-t border-[var(--border)] pt-3">
                  <strong className="flex items-center gap-1.5 text-xs font-black text-[var(--text-1)]" id="listen-review-snooze-title">
                    <CalendarClock className="h-3.5 w-3.5 text-[var(--accent)]" /> {ui("Put off")}
                  </strong>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {SNOOZE_CHOICES.map((choice) => (
                      <button
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]"
                        key={choice.days}
                        onClick={() => putOff(choice.days, choice.label)}
                        role="menuitem"
                        type="button"
                      >
                        <strong className="block text-xs font-black text-[var(--text-1)]">{ui(choice.label)}</strong>
                        <small className="mt-1 block text-[10px] font-semibold leading-snug text-[var(--text-3)]">{ui(choice.note)}</small>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {voiceTrouble && (
              <div className="mt-4 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-center text-xs font-black text-[var(--text-2)]" data-testid="listen-voice-trouble" role="status">
                {voiceTrouble === "retrying"
                  ? ui("The voice did not come through. Trying this card again…")
                  : ui("The voice could not be reached, so Listen paused here. Press Play audio to try again.")}
              </div>
            )}

            {reviewNotice && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-xl bg-[var(--accent-dim)] px-3 py-2 text-center text-xs font-black text-[var(--accent)]" role="status">
                <span>{reviewNotice.message}</span>
                {reviewNotice.undo && (
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-current/25 bg-[var(--surface)] px-2.5 py-1 text-xs font-black transition hover:-translate-y-px"
                    onClick={undoReviewLevel}
                    type="button"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> {ui("Undo")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button aria-label={ui("Back")} className="ghost-btn h-11 w-11" onClick={() => step(-1)} type="button">
            <ChevronLeft className="mx-auto h-5 w-5" />
          </button>
          {playing ? (
            <button className="listen-play-button inline-flex h-11 min-w-40 items-center justify-center gap-2 px-6" onClick={pause} type="button">
              <Pause className="h-4 w-4" /> {ui("Pause")}
            </button>
          ) : (
            <button className="listen-play-button inline-flex h-11 min-w-40 items-center justify-center gap-2 px-6" onClick={beginPlayback} type="button">
              <Play className="h-4 w-4" /> {ui("Play audio")}
            </button>
          )}
          <button aria-label={ui("Next")} className="ghost-btn h-11 w-11" onClick={() => step(1)} type="button">
            <ChevronRight className="mx-auto h-5 w-5" />
          </button>
          {/* Listening tells you nothing about what stuck, so this asks. It
              pauses first: the test is silent, and audio carrying on
              underneath it would be reading the answers out. */}
          <button
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-black text-[var(--text-1)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]"
            data-testid="listen-test-open"
            onClick={() => { pause(); setTesting(true); }}
            type="button"
          >
            <ClipboardCheck className="h-4 w-4" />
            {ui("Test me")}
          </button>
        </div>

        {/* Coarse and exact, because they are different jobs. The bar covers
            the whole queue at about forty items a pixel, which is right for
            "somewhere around a third of the way in" and useless for landing
            on a particular card; the box is for the card you can name. The
            bar commits on release rather than on every pixel, or dragging it
            would synthesise a few hundred clips on the way past. */}
        {queue.length > 1 && (
          <div className="listen-scrub mt-4" data-testid="listen-scrub">
            <input
              aria-label={ui("Move through the queue")}
              aria-valuetext={uiFmt("{position} of {total}", {
                position: uiNumber((scrubAt ?? queueIndex) + 1),
                total: uiNumber(queue.length),
              })}
              className="listen-scrub__bar"
              max={queue.length - 1}
              min={0}
              onChange={(event) => setScrubAt(Number(event.target.value))}
              onKeyUp={() => { if (scrubAt !== null) { jumpToQueueIndex(scrubAt); setScrubAt(null); } }}
              onPointerUp={() => { if (scrubAt !== null) { jumpToQueueIndex(scrubAt); setScrubAt(null); } }}
              step={1}
              type="range"
              value={scrubAt ?? queueIndex}
            />
            <form
              className="listen-scrub__jump"
              onSubmit={(event) => {
                event.preventDefault();
                const wanted = Number(jumpBox);
                if (!Number.isFinite(wanted)) return;
                // Shown one-based, held zero-based, and clamped rather than
                // refused: typing 99999 means "the end".
                jumpToQueueIndex(Math.min(Math.max(1, Math.round(wanted)), queue.length) - 1);
                setJumpBox("");
              }}
            >
              <label className="listen-scrub__label" htmlFor="listen-jump">{ui("Go to")}</label>
              <input
                className="listen-scrub__input"
                id="listen-jump"
                inputMode="numeric"
                onChange={(event) => setJumpBox(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder={String(queueIndex + 1)}
                type="text"
                value={jumpBox}
              />
              <span className="listen-scrub__total">/ {uiNumber(queue.length)}</span>
              <button className="listen-scrub__go" disabled={!jumpBox} type="submit">
                {ui("Go")}
              </button>
            </form>
          </div>
        )}

        {(masterMuted || englishMuted || germanMuted) && (
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-xs font-bold text-amber-800 dark:text-amber-200" role="status">
            {ui(masterMuted
              ? "All app audio is muted. Use the sliders below to turn it back on."
              : englishMuted && germanMuted
                ? "Both language voices are muted and will be skipped."
                : MUTED_VOICE_LABEL[englishMuted ? slotLanguage.en : slotLanguage.de])}
          </div>
        )}

        {/* Both settings panels fold away behind their headers — the player is
            the page; the knobs are a drawer you open when you want them.
            settings-board is what keeps the two headers side by side when one
            of them opens: the panel takes the full width underneath the pair
            rather than the header taking it and changing places. */}
        <div className="settings-board mt-3 grid items-start gap-x-4 lg:grid-cols-2">
          <SettingsCategory
            description={ui("Which items Listen plays, in what order, and how often they come back.")}
            icon={ListMusic}
            title={ui("What you hear")}
          >
            <fieldset className="mt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Content source")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                {ui("Tick any of the three. Listen draws from every one you leave on.")}
              </p>
              {/*
                Ticks rather than one choice.

                Three kinds and only one pick meant the three useful answers
                were the three single ones, and every pair was unreachable —
                adding paragraphs to a two-way picker took words-and-sentences
                away, which is not what adding a thing should do. All is kept
                beside them as the one press that turns everything on, since
                that is the setting people actually reach for.

                Four across on a wide pane, two-by-two once it narrows: four
                columns at phone width break the labels mid-word.
              */}
              <div
                aria-label={ui("Content source")}
                className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 sm:grid-cols-4"
                role="group"
              >
                {([[
                  "sentences", "Sentences",
                ], [
                  "words", "Words",
                ], [
                  "passages", "Paragraphs",
                ]] as const).map(([value, label]) => {
                  const selected = contentKinds.includes(value);
                  // The last one left cannot be turned off, and says so rather
                  // than looking pressable and doing nothing.
                  const locked = selected && contentKinds.length === 1;
                  return (
                    <button
                      aria-checked={selected}
                      aria-disabled={locked}
                      className={cn(
                        "min-h-10 rounded-xl border px-2 py-2 text-xs font-black transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                          : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]",
                        locked && "cursor-default"
                      )}
                      data-testid={`listen-source-${value}`}
                      key={value}
                      onClick={() => toggleContentKind(value)}
                      role="checkbox"
                      title={locked ? ui("Listen needs at least one of these on.") : undefined}
                      type="button"
                    >
                      {ui(label)}
                    </button>
                  );
                })}
                <button
                  className={cn(
                    "min-h-10 rounded-xl border px-2 py-2 text-xs font-black transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                    contentKinds.length === LISTEN_CONTENT_KINDS.length
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                      : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                  )}
                  data-testid="listen-source-mixed"
                  onClick={chooseAllContentKinds}
                  type="button"
                >
                  {ui("All")}
                </button>
              </div>
            </fieldset>
            <fieldset className="mt-4 border-t border-[var(--border)] pt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Queue order")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                {ui("Easiest first works through the course by level — all of A1, then A2, then B1 — with the most useful card leading each level. Most common first teaches the phrases and words people are most likely to use, whatever level they are. Reviews & struggles first plays what is due and what you have marked as hard before anything new. Least heard first plays what you have heard fewest times, so nothing is skipped for long. Newest first plays the packs added most recently, so new content is heard instead of waiting behind thousands of commoner items. Longest first plays the biggest pieces first — whole passages, then sentences, then single words. Similar sentences together plays sentences that start the same way in a run — every “Ich möchte …”, then every “Kannst du …” — so one shape is drilled before the next. Conversation order plays the course's dialogues as exchanges — a question, then the answer that fits it, then what comes next — before anything that stands alone.")}
              </p>
              <div
                aria-label={ui("Queue order")}
                className="mt-2 grid grid-cols-1 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 sm:grid-cols-2"
                role="radiogroup"
              >
                {([[
                  "level", "Easiest first (A1 → C1)",
                ], [
                  "common", "Most common first",
                ], [
                  "learning", "Reviews & struggles first",
                ], [
                  "least-heard", "Least heard first",
                ], [
                  "newest", "Newest first",
                ], [
                  "longest", "Longest first",
                ], [
                  "similar", "Similar sentences together",
                ], [
                  "conversation", "Conversation order",
                ]] as const).map(([value, label]) => {
                  const selected = queueOrder === value;
                  return (
                    <button
                      aria-checked={selected}
                      className={cn(
                        "min-h-10 rounded-xl border px-2 py-2 text-[11px] font-black leading-tight transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                          : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                      )}
                      data-testid={`listen-queue-${value}`}
                      key={value}
                      onClick={() => chooseQueueOrder(value)}
                      role="radio"
                      type="button"
                    >
                      {ui(label)}
                    </button>
                  );
                })}
              </div>
              {listenQueueHasGroups(queueOrder) ? (
                <>
                  <p className="mt-3 text-xs font-black text-[var(--text-2)]">{ui(WITHIN_LEGEND[queueOrder] ?? "Then within each group")}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                    {ui("The order above decides which cards come first as a group. This decides which card leads each group — so A1 can be taught most common first, or hardest first, and A2 still waits until A1 is done.")}
                  </p>
                  <div
                    aria-label={ui(WITHIN_LEGEND[queueOrder] ?? "Then within each group")}
                    className="mt-2 grid grid-cols-1 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 sm:grid-cols-2"
                    role="radiogroup"
                  >
                    {WITHIN_CHOICES
                      // An order cannot lead its own groups: every card in a
                      // pack shares its pack, so "newest within newest" would
                      // be a control that reads as a choice and does nothing.
                      .filter(([value]) => value !== (queueOrder as string))
                      .map(([value, label]) => {
                        const selected = queueWithin === value;
                        return (
                          <button
                            aria-checked={selected}
                            className={cn(
                              "min-h-10 rounded-xl border px-2 py-2 text-[11px] font-black leading-tight transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                              selected
                                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                                : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                            )}
                            data-testid={`listen-queue-within-${value}`}
                            key={value}
                            onClick={() => chooseQueueWithin(value)}
                            role="radio"
                            type="button"
                          >
                            {ui(label)}
                          </button>
                        );
                      })}
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[11px] font-semibold text-[var(--text-3)]">
                  {ui("Most common first ranks every card on its own, so there is no group left to order.")}
                </p>
              )}
            </fieldset>
            <fieldset className="mt-4 border-t border-[var(--border)] pt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Level")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                {ui("Order decides what comes first and still plays everything. This decides what is in the queue at all, so you can work through one level and stop.")}
              </p>
              {/* Checkboxes, not radios: several levels can be on at once,
                  and none on means every level rather than none. */}
              <div
                aria-label={ui("Level")}
                className="mt-2 grid grid-cols-3 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 sm:grid-cols-4"
                role="group"
              >
                <button
                  aria-pressed={levelFilter.size === 0}
                  className={cn(
                    "min-h-10 rounded-xl border px-2 py-2 text-[11px] font-black transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                    levelFilter.size === 0
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                      : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                  )}
                  data-testid="listen-level-all"
                  onClick={() => setLevelFilter(setListenLevelFilters([], learningDirection))}
                  type="button"
                >
                  {ui("All levels")}
                </button>
                {CEFR_STEPS.map((value) => {
                  const selected = levelFilter.has(value);
                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "min-h-10 rounded-xl border px-2 py-2 text-[11px] font-black transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                          : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                      )}
                      data-testid={`listen-level-${value}`}
                      key={value}
                      onClick={() => toggleLevelFilter(value)}
                      type="button"
                    >
                      {cefrStepLabel(value)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="mt-4 border-t border-[var(--border)] pt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Usefulness")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                {ui("The same bands the word and sentence trackers narrow by, so asking for one here and there means the same thing.")}
              </p>
              <div
                aria-label={ui("Usefulness")}
                className="mt-2 grid grid-cols-1 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 sm:grid-cols-2"
                role="group"
              >
                {USEFULNESS_FILTERS.map((option) => {
                  // "all" is the OFF switch for the whole group, not a band —
                  // it clears the set rather than joining it.
                  const isAll = option.key === "all";
                  const selected = isAll
                    ? usefulnessFilter.size === 0
                    : usefulnessFilter.has(option.key as ConversationUsefulness);
                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "min-h-10 rounded-xl border px-2 py-2 text-[11px] font-black leading-tight transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                          : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                      )}
                      data-testid={`listen-usefulness-${option.key}`}
                      key={option.key}
                      onClick={() => {
                        if (isAll) setUsefulnessFilter(setListenUsefulnessFilters([], learningDirection));
                        else toggleUsefulnessFilter(option.key as ConversationUsefulness);
                      }}
                      type="button"
                    >
                      {ui(option.label)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {/* Filtering by PACK already exists and already applies here —
                buildListenQueue drops paused packs before it builds anything.
                It lives on the Learn screen, where the whole pack list can be
                searched and paused in bulk, and rebuilding a second copy of
                that here would be two lists to keep agreeing. What was
                missing is that nothing said it reaches Listen. */}
            <fieldset className="mt-4 border-t border-[var(--border)] pt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Packs")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                {ui("Any pack you pause on the Learn screen is left out of Listen too — nothing from it is played, and unpausing brings it straight back.")}
              </p>
            </fieldset>
            <div className="mt-4 rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent-dim)] p-3.5">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--surface)] text-[var(--accent)] shadow-sm">
                  <Repeat2 className="h-4 w-4" />
                </span>
                <span>
                  <strong className="block text-xs font-black text-[var(--text-1)]">{ui("Learning loop")}</strong>
                  <small className="mt-0.5 block text-[11px] font-semibold leading-snug text-[var(--text-3)]">
                    {ui("A few cards at a time, each heard more than once before the next few start.")}
                  </small>
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {/*
                  One number per kind the learner is playing. Each may take
                  whatever the others leave of the twelve, so the controls
                  cannot be driven into a loop that does not add up.
                */}
                {interleaves ? mixedKinds.map(([kind, label, suffix, note]) => (
                  <NumberSetting
                    key={kind}
                    label={label}
                    max={Math.max(1, LISTEN_MIXED_TOTAL - (mixedTotal - mixedCounts[kind]))}
                    min={1}
                    note={note}
                    onCommit={(value) => commitMixedCounts({ ...mixedCounts, [kind]: value })[kind]}
                    suffix={suffix}
                    testId={`listen-loop-${kind}`}
                    value={mixedCounts[kind]}
                  />
                )) : <NumberSetting label={ui("Cards at a time")} max={12} min={1} note={ui("How many cards you hear before they come round again")} onCommit={commitLoopItems} suffix={ui("cards")} testId="listen-loop-items" value={loopItems} />}
                <NumberSetting
                  label={ui("Times you hear each card")}
                  max={6}
                  min={1}
                  note={ui("How many times those cards play before the next ones start")}
                  onCommit={commitLoopPasses}
                  suffix="×"
                  testId="listen-loop-passes"
                  value={loopPasses}
                />
              </div>
              <p className="mt-3 text-[11px] font-semibold leading-snug text-[var(--text-2)]" data-testid="listen-loop-example">
                {interleaves
                  ? uiFmt(
                    "Right now: {mix} = {total} cards at a time, each heard {passes}×. The first {total} play {passes} times over, then the next {total} do the same.",
                    {
                      mix: mixedKinds.map(([kind, , suffix]) => `${mixedCounts[kind]} ${suffix}`).join(" + "),
                      total: mixedTotal,
                      passes: loopPasses,
                    }
                  )
                  : uiFmt(
                    "Right now: {total} cards at a time, each heard {passes}×. The first {total} play {passes} times over, then the next {total} do the same.",
                    { total: loopItems, passes: loopPasses }
                  )}
                {loopPasses === 1 ? " " + ui("At 1× each card plays once and nothing comes round again.") : ""}
              </p>
            </div>
            <fieldset className="mt-4 border-t border-[var(--border)] pt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Coming back")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold leading-snug text-[var(--text-3)]">
                {ui("Hearing something once is not learning it. This decides how long Micheon waits before playing you something you have already heard. The loop above repeats a set inside one sitting; this is about the next sitting.")}
              </p>
              <p className="mt-2 text-xs font-black text-[var(--text-2)]">{ui("What has to wait")}</p>
              <div
                aria-label={ui("What has to wait")}
                className="mt-1.5 grid grid-cols-1 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 sm:grid-cols-3"
                role="radiogroup"
              >
                {RETURN_SCOPE_CHOICES.map(([value, label]) => {
                  const selected = returnScope === value;
                  return (
                    <button
                      aria-checked={selected}
                      className={cn(
                        "min-h-10 rounded-xl border px-2 py-2 text-[11px] font-black leading-tight transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                          : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                      )}
                      data-testid={`listen-return-scope-${value}`}
                      key={value}
                      onClick={() => chooseReturnScope(value)}
                      role="radio"
                      type="button"
                    >
                      {ui(label)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs font-black text-[var(--text-2)]">{ui("How long it waits")}</p>
              <div
                aria-label={ui("How long it waits")}
                className="mt-1.5 grid grid-cols-1 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 sm:grid-cols-2"
                role="radiogroup"
              >
                {RETURN_GAP_CHOICES.map(([value, label]) => {
                  const selected = returnGap === value;
                  return (
                    <button
                      aria-checked={selected}
                      className={cn(
                        "min-h-10 rounded-xl border px-2 py-2 text-[11px] font-black leading-tight transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                          : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                      )}
                      data-testid={`listen-return-gap-${value}`}
                      key={value}
                      onClick={() => chooseReturnGap(value)}
                      role="radio"
                      type="button"
                    >
                      {ui(label)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] font-semibold leading-snug text-[var(--text-2)]" data-testid="listen-return-explained">
                {ui(RETURN_GAP_EXPLAINED[returnGap] ?? "")}
              </p>
              <p className="mt-2 text-[11px] font-semibold leading-snug text-[var(--text-3)]">
                {ui("Nothing is ever taken out of the queue — a card that is still waiting simply plays after everything else. On the whole course that is thousands of cards away; on a narrow filter it means you will still hear it, just last.")}
              </p>
            </fieldset>
            <div className="mt-4">
              <NumberSetting
                label={ui("Next card delay")}
                max={30}
                min={0}
                note={ui("Pause after both languages finish")}
                onCommit={commitDelaySeconds}
                step={0.1}
                suffix={ui("sec")}
                testId="listen-next-card-delay"
                value={nextCardDelayMs / 1000}
              />
            </div>
          </SettingsCategory>

          <SettingsCategory
            description={ui("Voice levels, speed, and how each card is spoken. Saved automatically.")}
            icon={Volume2}
            title={ui("How it sounds")}
          >
            <div className="listen-audio-stack">
              <ListenVolumeRow
                label={ui("Master volume")}
                muteLabel={ui("Mute all audio")}
                muted={masterMuted}
                onChange={setMasterAudioVolume}
                onToggleMuted={toggleAudioMuted}
                testId="listen-master"
                unmuteLabel={ui("Unmute all audio")}
                value={audioSettings.masterVolume}
              />
              {/* Named after the SLOT, not the language: "listen-german" is
                  the row for whatever the first slot plays, which in the
                  French course is the French. Two rows rather than three,
                  because two are all this player ever speaks. */}
              <ListenVolumeRow
                label={ui(VOICE_LABEL[slotLanguage.de])}
                muteLabel={ui(MUTE_VOICE_LABEL[slotLanguage.de])}
                muted={germanMuted}
                onChange={(value) => setTtsLanguageVolume(AUDIO_LANGUAGE[slotLanguage.de], value)}
                onToggleMuted={() => toggleTtsLanguageMuted(AUDIO_LANGUAGE[slotLanguage.de])}
                testId="listen-german"
                unmuteLabel={ui(UNMUTE_VOICE_LABEL[slotLanguage.de])}
                value={audioSettings[VOLUME_SETTING[slotLanguage.de]]}
              />
              <ListenVolumeRow
                label={ui(VOICE_LABEL[slotLanguage.en])}
                muteLabel={ui(MUTE_VOICE_LABEL[slotLanguage.en])}
                muted={englishMuted}
                onChange={(value) => setTtsLanguageVolume(AUDIO_LANGUAGE[slotLanguage.en], value)}
                onToggleMuted={() => toggleTtsLanguageMuted(AUDIO_LANGUAGE[slotLanguage.en])}
                testId="listen-english"
                unmuteLabel={ui(UNMUTE_VOICE_LABEL[slotLanguage.en])}
                value={audioSettings[VOLUME_SETTING[slotLanguage.en]]}
              />
            </div>
            <div className="listen-speech-speed-card">
              <SpeechSpeedControl
                description={uiFmt("Set both voices together or tune {first} and {second} separately.", {
                  first: ui(targetSlot.label), second: ui(meaningSlot.label),
                })}
                testId="listen-speech-speed"
              />
            </div>
            <fieldset className="mt-4 border-t border-[var(--border)] pt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Language order")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                {ui("Which side of the card you hear first. Meaning first lets you have a go at saying it before you hear it said, which is practice; German first makes you work out what it means, which is a test.")}
              </p>
              <div
                aria-label={ui("Language order")}
                className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5"
                role="radiogroup"
              >
                {([
                  ["meaning-first", FIRST_LABEL[slotLanguage.en]],
                  ["target-first", FIRST_LABEL[slotLanguage.de]],
                ] as const).map(([value, label]) => {
                  const active = languageOrder === value;
                  return (
                    <button
                      aria-checked={active}
                      className={cn(
                        "min-h-10 rounded-xl border px-3 py-2 text-xs font-black transition-[background-color,border-color,color,transform,box-shadow] duration-150",
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                          : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                      )}
                      data-testid={`listen-order-${value}`}
                      key={value}
                      onClick={() => chooseLanguageOrder(value)}
                      role="radio"
                      type="button"
                    >
                      {ui(label)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {/* These three had no heading of their own. They sat straight
                under the language order and read as part of it, which is
                nearly true and not true enough: the order decides which
                language opens a card, these decide how often each one is
                said and how long the gap between them is. */}
            <fieldset className="mt-4 border-t border-[var(--border)] pt-4">
              <legend className="text-xs font-black text-[var(--text-2)]">{ui("Repeats and pauses")}</legend>
              <p className="mt-0.5 text-[11px] font-semibold text-[var(--text-3)]">
                {ui("How often each language is spoken on a card, and the gap between them.")}
              </p>
              <div className="mt-2 space-y-2">
                <NumberSetting
                  label={ui(REPEATS_LABEL[slotLanguage.de])}
                  max={10}
                  min={1}
                  note={ui("Times spoken on every card")}
                  onCommit={commitTargetRepeats}
                  suffix="×"
                  testId="listen-target-repeats"
                  value={targetRepeats}
                />
                <NumberSetting
                  label={ui(REPEATS_LABEL[slotLanguage.en])}
                  max={10}
                  min={1}
                  note={ui("Times spoken on every card")}
                  onCommit={commitMeaningRepeats}
                  suffix="×"
                  testId="listen-meaning-repeats"
                  value={meaningRepeats}
                />
                <NumberSetting
                  label={ui("Pause between languages")}
                  max={30}
                  min={0}
                  note={ui(SAY_IT_FIRST_LABEL[languageOrder === "meaning-first" ? slotLanguage.de : slotLanguage.en])}
                  onCommit={commitLanguageGapSeconds}
                  step={0.5}
                  suffix={ui("sec")}
                  testId="listen-language-gap"
                  value={languageGapMs / 1000}
                />
              </div>
            </fieldset>
          </SettingsCategory>
        </div>

        {/* Session-wide switches: they govern Listen as a whole rather than a
            single card's content or voice, so they sit under both columns
            instead of padding out whichever column had room. */}
        <div className="listen-session-row">
          <label className="listen-background-toggle" data-testid="listen-background-toggle">
            <input
              checked={backgroundPlayback}
              onChange={(event) => chooseBackgroundPlayback(event.target.checked)}
              type="checkbox"
            />
            <span className="listen-background-toggle__copy">
              <strong>{ui("Keep playing around Micheon")}</strong>
              <small>{ui("Continue when you open Home, Practice, Settings, or another app section.")}</small>
            </span>
            <span aria-hidden="true" className="listen-background-toggle__switch"><i /></span>
          </label>
          <label className="listen-background-toggle" data-testid="listen-pet-bilingual-toggle">
            <input
              checked={petBilingualCaptions}
              onChange={(event) => choosePetBilingualCaptions(event.target.checked)}
              type="checkbox"
            />
            <span className="listen-background-toggle__copy">
              <strong>{ui("Show both languages on the pet")}</strong>
              <small>{uiFmt("Keep {target} and {meaning} together in the pet bubble. Turn this off to show only the line currently being spoken.", {
                target: ui(courseSides().target.label),
                meaning: ui(courseSides().meaning.label),
              })}</small>
            </span>
            <span aria-hidden="true" className="listen-background-toggle__switch"><i /></span>
          </label>
        </div>

        <p className="listen-footnote mt-4">
          <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-3)]" />
          {ui("Repeated listening builds familiarity, but it does not mark an item mastered. Lessons still check whether you can recall and spell it.")}
        </p>
      </section>
    </div>
  );
}
