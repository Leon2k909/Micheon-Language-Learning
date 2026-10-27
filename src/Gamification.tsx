import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronDown,
  WholeWord,
  CalendarDays,
  Camera,
  Check,
  X,
  Search,
  RotateCcw,
  Flame,
  Pencil,
  ShieldCheck,
  Target,
  Trophy,
  LogOut,
  Zap,
  Languages,
  MoonStar,
  Star,
  Paintbrush,
  Palette,
  Pipette,
  Monitor,
  HardDrive,
  PawPrint,
  Eye,
  Contrast,
  UserRound,
} from "lucide-react";
import { loadScopedJson, saveScopedJson, setAuthUser, UserProfile } from "@/lib/profileStorage";
import { onVocabLibraryOpen } from "@/lib/vocabFilterRequest";
import { loadActivitySessions } from "@/lib/activity";
import { weekRhythm, type WeekDay } from "@/lib/weekRhythm";

/** Read an image file, downscale it, and return a small JPEG data URL for local storage. */
async function fileToAvatarDataUrl(file: File, max = 256): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}
import { detectEnglishVariant, englishVariantLabel, getEnglishVariant, resolveEnglishVariant, setEnglishVariant, type EnglishVariant } from "@/lib/englishVariant";
import { FluencyMeter } from "@/components/FluencyMeter";
import { MasteryCard } from "@/components/lab/MasteryCard";
import { getFluency, countKnownVocab } from "@/lib/fluency";
import { DEFAULT_THEME, THEME_CHANGE_EVENT, getThemePreference, setTheme, systemTheme, type ThemePreference } from "@/lib/theme";
import {
  ACCENT_CHANGE_EVENT,
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  getAccentColour,
  isDefaultAccent,
  normaliseHex,
  resetAccentColour,
  setAccentColour,
} from "@/lib/accentColour";
import {
  CUSTOM_COLOURS_CHANGE_EVENT,
  PAINTABLE_BY_TOKEN,
  clearCustomColour,
  currentThemeName,
  getCustomColours,
  resetCustomColours,
  setCustomColour,
} from "@/lib/customColours";
import { ColourInspector } from "@/components/settings/ColourInspector";
import { getEffects, type Effects } from "@/lib/effects";
import { getLearningDirection, type LearningDirection } from "@/lib/direction";
import { getInterfaceLanguage, setInterfaceLanguage, type InterfaceLanguage } from "@/lib/interfaceLanguage";
import { VoicePicker } from "@/components/VoicePicker";
import { UpdateStatusCard } from "@/components/UpdateStatusCard";
import { SettingsCategory, SettingsCategoryLayout } from "@/components/SettingsCategory";
import { InterestsSetting } from "@/components/settings/InterestsSetting";
import { LessonStagesSetting } from "@/components/settings/LessonStagesSetting";
import { getMeaningLenience, setMeaningLenience, type MeaningLenience } from "@/lib/meaningLenience";
import { getMeaningPlacement, setMeaningPlacement, type MeaningPlacement } from "@/lib/meaningPlacement";
import { AppLanguagePicker } from "@/components/AppLanguagePicker";
import { DataAndStorage } from "@/components/DataAndStorage";
import { BROWSER_EXTENSION_ICON, BrowserExtension } from "@/components/BrowserExtension";
import { AppZoomControl } from "@/components/AppZoomControl";
import { applyHighContrast, getHighContrast } from "@/lib/highContrast";
import { WindowsAppSettings } from "@/components/WindowsAppSettings";
import { CreditsCard } from "@/components/CreditsCard";
import { LearningModePicker } from "@/components/LearningModePicker";
import { FlashcardModePicker } from "@/components/FlashcardModePicker";
import { getFlashcardFace, getFlashcardMode, setFlashcardFace, setFlashcardMode, type FlashcardFace, type FlashcardMode } from "@/lib/flashcardMode";
import { ActivityCard } from "@/components/lab/ActivityCard";
import { cn } from "@/lib/utils";
import { SpeechSpeedControl } from "@/components/SpeechSpeedControl";
import { getLearningMode, setLearningMode, type LearningMode } from "@/lib/learningMode";
import {
  clearGuidedCustomBackground,
  getGuidedBackground,
  getGuidedCustomBackground,
  saveGuidedCustomBackground,
  setGuidedBackground as saveGuidedBackground,
  type GuidedBackground,
} from "@/lib/guidedBackground";
import { ui, uiFmt, uiNumber } from "@/lib/i18n";

const CodexPetPicker = lazy(() => import("@/components/codexPets/CodexPetPicker")
  .then((module) => ({ default: module.CodexPetPicker })));
const loadVocabTrackerModule = () => import("@/components/lab/VocabTracker");
const VocabTracker = lazy(() => loadVocabTrackerModule()
  .then((module) => ({ default: module.VocabTracker })));
const WordsTracker = lazy(() => import("@/components/lab/WordsTracker").then((m) => ({ default: m.WordsTracker })));

function scheduleProfileIdleWork(task: () => void, timeout = 1200): () => void {
  const idleWindow = window as Window & typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(task, { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(task, 120);
  return () => window.clearTimeout(timer);
}

/**
 * The scenery behind a guided lesson: value, name, and what it looks like.
 *
 * One list, read twice — the dropdown's options and the line under it that
 * describes whichever is chosen. "custom" is not here: it exists only once an
 * image has been put there, and the row below the dropdown owns that.
 */
const GUIDED_SCENES = [
  ["monkey", "Monkey world", "Default — a calm lesson landscape with the monkey beside you."],
  ["garden", "Flower garden", "A walled rose garden at sunset."],
  ["bubbles", "Speech bubbles", "A hello in many languages, over a watercolour world."],
  ["atlas", "Globe and flight path", "A plane over the world map, its routes drawn in light."],
  ["dawn", "Soft dawn", "Mist over a lake as the sun comes up."],
  ["plain", "Plain canvas", "The cleanest option for distraction-free study."],
] as const satisfies ReadonlyArray<readonly [GuidedBackground, string, string]>;

const PROFILE_FOLDS_KEY = "profile-folds";

/**
 * A block of this page that starts closed.
 *
 * The page used to carry everything it has at once — over three thousand
 * pixels of it — so anything past the top meant scrolling through all of it to
 * reach. Each block is a heading you open now, and how you left them is
 * remembered per profile, so whichever one you actually use stays open.
 *
 * Closed by default is not only tidier: what is inside these is loaded when it
 * is revealed, so a block nobody opens costs nothing to draw either.
 */
function ProfileFold({
  children,
  className,
  icon: Icon,
  id,
  onOpenRequest,
  subtitle,
  title,
  user,
}: {
  children: React.ReactNode;
  /** Goes on the heading, so a jump from elsewhere lands on it either way. */
  className?: string;
  icon: React.ComponentType<{ className?: string }>;
  id: string;
  /** Subscribes an "open yourself" signal, for blocks something navigates to. */
  onOpenRequest?: (open: () => void) => () => void;
  subtitle: string;
  title: string;
  user: UserProfile | null;
}) {
  const [open, setOpen] = useState(() => {
    const stored = loadScopedJson<Record<string, boolean>>(PROFILE_FOLDS_KEY, {}, user);
    return stored?.[id] === true;
  });

  const remember = (next: boolean) => {
    const stored = loadScopedJson<Record<string, boolean>>(PROFILE_FOLDS_KEY, {}, user);
    saveScopedJson(PROFILE_FOLDS_KEY, { ...(stored || {}), [id]: next }, user);
  };

  useEffect(() => {
    if (!onOpenRequest) return undefined;
    return onOpenRequest(() => setOpen(true));
  }, [onOpenRequest]);

  return (
    <section className={cn("card overflow-hidden", className)}>
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-5 text-left sm:p-6"
        onClick={() => { setOpen((was) => { remember(!was); return !was; }); }}
        type="button"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-dim)] text-[var(--accent)]">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-black tracking-tight text-[var(--text-1)]">{title}</span>
          <span className="mt-0.5 block text-xs font-semibold text-[var(--text-3)]">{subtitle}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--text-3)] transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-[var(--border)] p-5 sm:p-6">{children}</div>}
    </section>
  );
}

function ProfileSectionLoading({ embedded = false, label }: { embedded?: boolean; label: string }) {
  return (
    <div
      aria-label={label}
      className={cn(
        "flex min-h-[190px] flex-col justify-center overflow-hidden p-5 sm:p-6",
        embedded ? "rounded-[24px] bg-[var(--surface-2)]" : "card"
      )}
      role="status"
    >
      <div className="h-4 w-36 rounded-full bg-[var(--surface-3)] motion-safe:animate-pulse" />
      <div className="mt-3 h-3 w-64 max-w-full rounded-full bg-[var(--surface-3)] motion-safe:animate-pulse" />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <span
            aria-hidden="true"
            className="h-14 rounded-[16px] bg-[var(--surface)] motion-safe:animate-pulse"
            key={item}
          />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function DeferredProfileSection({
  children,
  className,
  fallback,
  minHeight = 240,
  onReveal,
}: {
  children: React.ReactNode;
  className?: string;
  fallback: React.ReactNode;
  minHeight?: number;
  onReveal?: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (revealed) return undefined;
    const anchor = anchorRef.current;
    if (!anchor) return undefined;

    const reveal = () => {
      onReveal?.();
      setRevealed(true);
    };
    if (!("IntersectionObserver" in window)) {
      reveal();
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      reveal();
      // Reach well ahead of the scroll so a heavy section is already
      // loading by the time it appears, instead of starting on arrival.
    }, { rootMargin: "2400px 0px", threshold: 0.01 });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [onReveal, revealed]);

  return (
    <div className={className} ref={anchorRef} style={revealed ? undefined : { minHeight }}>
      {revealed ? children : fallback}
    </div>
  );
}

export type GamificationStats = {
  totalXp: number;
  sessionsCompleted: number;
  totalReviews: number;
  streak: number;
  externalWords: number;
};

type Stats = GamificationStats;

type Level = { level: number; label: string; xpRequired: number };

const LEVELS: Level[] = [
  { level: 1, label: "Getting started", xpRequired: 0 },
  { level: 2, label: "Warming up", xpRequired: 100 },
  { level: 3, label: "Finding a rhythm", xpRequired: 300 },
  { level: 4, label: "In the groove", xpRequired: 650 },
  { level: 5, label: "Committed", xpRequired: 1100 },
  { level: 6, label: "Dedicated", xpRequired: 1800 },
  { level: 7, label: "Relentless", xpRequired: 2800 },
  { level: 8, label: "Unstoppable", xpRequired: 4200 },
  // Level 8 used to be the ceiling, which meant the most committed learners hit
  // the top and then had nothing left to climb. The ladder now runs to 20, with
  // the gaps widening so late levels stay meaningful rather than trickling past.
  { level: 9, label: "Fluent in the making", xpRequired: 6000 },
  { level: 10, label: "Conversational", xpRequired: 8200 },
  { level: 11, label: "Holding your own", xpRequired: 11000 },
  { level: 12, label: "Comfortable", xpRequired: 14500 },
  { level: 13, label: "Quick on your feet", xpRequired: 18500 },
  { level: 14, label: "Thinking in German", xpRequired: 23000 },
  { level: 15, label: "Hard to catch out", xpRequired: 28000 },
  { level: 16, label: "At home in the language", xpRequired: 34000 },
  { level: 17, label: "Reading between the lines", xpRequired: 41000 },
  { level: 18, label: "Rarely surprised", xpRequired: 49000 },
  { level: 19, label: "Near-native", xpRequired: 58000 },
  { level: 20, label: "Native level", xpRequired: 70000 },
];

export const MILESTONES = [
  {
    id: "first_session",
    label: "First lesson",
    desc: "Complete one guided lesson.",
    target: 1,
    unit: "lesson",
    current: (s: Stats) => s.sessionsCompleted,
    check: (s: Stats) => s.sessionsCompleted >= 1,
  },
  {
    id: "streak_3",
    label: "Three-day streak",
    desc: "Return for three separate days.",
    target: 3,
    unit: "days",
    current: (s: Stats) => s.streak,
    check: (s: Stats) => s.streak >= 3,
  },
  {
    id: "reviews_50",
    label: "50 review items",
    desc: "Build recognition through recall.",
    target: 50,
    unit: "reviews",
    current: (s: Stats) => s.totalReviews,
    check: (s: Stats) => s.totalReviews >= 50,
  },
  {
    id: "xp_500",
    label: "500 XP",
    desc: "Show steady practice momentum.",
    target: 500,
    unit: "XP",
    current: (s: Stats) => s.totalXp,
    check: (s: Stats) => s.totalXp >= 500,
  },
  {
    id: "words_200",
    label: "200 tracked words",
    desc: "Combine lessons and word-bank items.",
    target: 200,
    unit: "words",
    current: (s: Stats) => countKnownVocab(undefined, s.externalWords),
    check: (s: Stats) => countKnownVocab(undefined, s.externalWords) >= 200,
  },
  {
    id: "week",
    label: "Seven-day rhythm",
    desc: "Keep a full week of returns.",
    target: 7,
    unit: "days",
    current: (s: Stats) => s.streak,
    check: (s: Stats) => s.streak >= 7,
  },
  {
    id: "lessons_10",
    label: "10 lessons complete",
    desc: "Build a dependable learning routine.",
    target: 10,
    unit: "lessons",
    current: (s: Stats) => s.sessionsCompleted,
    check: (s: Stats) => s.sessionsCompleted >= 10,
  },
  {
    id: "reviews_250",
    label: "250 review items",
    desc: "Strengthen useful language through recall.",
    target: 250,
    unit: "reviews",
    current: (s: Stats) => s.totalReviews,
    check: (s: Stats) => s.totalReviews >= 250,
  },
  {
    id: "xp_2500",
    label: "2,500 XP",
    desc: "Keep making steady progress across activities.",
    target: 2500,
    unit: "XP",
    current: (s: Stats) => s.totalXp,
    check: (s: Stats) => s.totalXp >= 2500,
  },
  {
    id: "words_1000",
    label: "1,000 tracked words",
    desc: "Grow a broad base for everyday conversation.",
    target: 1000,
    unit: "words",
    current: (s: Stats) => countKnownVocab(undefined, s.externalWords),
    check: (s: Stats) => countKnownVocab(undefined, s.externalWords) >= 1000,
  },
  {
    id: "streak_30",
    label: "30-day streak",
    desc: "Return regularly for a full month.",
    target: 30,
    unit: "days",
    current: (s: Stats) => s.streak,
    check: (s: Stats) => s.streak >= 30,
  },
  {
    id: "lessons_100",
    label: "100 lessons complete",
    desc: "Turn regular practice into lasting experience.",
    target: 100,
    unit: "lessons",
    current: (s: Stats) => s.sessionsCompleted,
    check: (s: Stats) => s.sessionsCompleted >= 100,
  },
] as const;

export function getLevelInfo(xp: number) {
  let cur = LEVELS[0];
  let nxt: Level | null = LEVELS[1];
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (xp >= LEVELS[i].xpRequired) {
      cur = LEVELS[i];
      nxt = LEVELS[i + 1] ?? null;
    }
  }
  const into = xp - cur.xpRequired;
  const needed = nxt ? nxt.xpRequired - cur.xpRequired : 1;
  const pct = nxt ? Math.min(100, Math.round((into / needed) * 100)) : 100;
  return { cur, nxt, pct, into, needed };
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${color} ${color.includes("--ink") ? "text-[var(--ink-text)]" : "text-white"}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-5 text-3xl font-black tracking-tight text-[var(--text-1)]">{value}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--text-3)]">{label}</p>
    </div>
  );
}

/**
 * What lives inside each settings category.
 *
 * Search has to find "dark mode" or "tyre" or "streak" without the learner
 * knowing which drawer it is in, and the categories are collapsed by default
 * so their contents are not in the DOM to search. This is that index, kept
 * beside the categories it describes.
 */
const SETTINGS_SEARCH_INDEX: Record<string, string> = {
  Appearance: "theme dark mode light night colour color accent green button brand lesson background scenery monkey garden dawn plain canvas wallpaper zoom bigger smaller text size",
  Accessibility: "high contrast motion reduce animation calmer speech speed slower faster voice rate readable",
  "Desktop app & updates": "startup launch login boot close button tray minimise minimize quit update version install check",
  // Flashcards were a category of their own once. The search terms came into
  // this one along with the setting, so typing flip or front still lands on
  // the drawer it now lives in.
  "Learning options": "learning style direction german english words learned elsewhere external vocabulary count mode flashcard card side front back reveal flip order behaviour meaning translation english on card underneath bigger size placement interests interested topics subjects cooking kitchen football sport skip last priority deprioritise deprioritize stages stage steps route long route fifteen 15 custom repeat repeats again drill lesson length type translate recall",
  "Language & voice": "audio audioeinstellungen ton sound sprache stimme english spelling british american tyre tire colour spoken voice speaker accent app language german deutsch tts",
  "Pet & mascot": "pet mascot monkey desk companion talk frequency messages tips questions greetings mute hide",
  "Data & storage": "data storage space disk size used delete remove clear erase wipe cache reset progress download install uninstall language pack privacy gdpr export import transfer backup",
  "Browser extension": "chrome edge brave extension addon plugin browser download highlight gloss youtube dub captions",
  Activity: "activity streak xp sessions week milestones progress stats statistics",
};

/** Fold accents and case so "farbe" and "Färbe" both match. */
function foldSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function ProgressSummaryCard({
  cur,
  stats,
  words,
  earned,
  vocab,
}: {
  cur: Level;
  stats: Stats;
  words: number;
  earned: number;
  vocab: number;
}) {
  const fluency = getFluency(vocab);

  return (
    <section className="card flex min-w-0 flex-col justify-between overflow-hidden p-5 sm:p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--accent-dim)] px-3 py-1 text-xs font-black text-[var(--accent)]">
            {ui(fluency.cur.label)}
          </span>
          <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-black text-[var(--text-2)]">
            {ui("Practice Lv")} {cur.level}
          </span>
        </div>
        {/* One card, not two. "Your German progress" and "Vocabulary mastery"
            sat side by side answering the same question with the same number,
            so they are merged — and it is Mastery, not VOCABULARY mastery,
            because the count has always included sentences and phrases as
            well as words. */}
        <h1 className="mt-5 text-3xl font-black leading-tight tracking-tight text-[var(--text-1)]">
          {ui("Your mastery")}
        </h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-2)]">
          {ui("Every word, phrase and sentence you can recall — your whole fluency level in one place.")}
        </p>
      </div>

      <div className="mt-6">
        <FluencyMeter vocab={vocab} />
      </div>

      <div className="mt-5">
        <MasteryCard vocab={vocab} embedded />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { label: "XP", value: uiNumber(stats.totalXp) },
          { label: ui("Words"), value: uiNumber(words) },
          { label: ui("Milestones"), value: `${uiNumber(earned)}/${uiNumber(MILESTONES.length)}` },
        ].map((item) => (
          <div className="rounded-[18px] bg-[var(--surface-2)] p-3" key={item.label}>
            <p className="text-lg font-black leading-none text-[var(--text-1)]">{item.value}</p>
            <p className="mt-1 text-[11px] font-semibold text-[var(--text-3)]">{item.label}</p>
          </div>
        ))}
      </div>

    </section>
  );
}

/**
 * One mark per day of the week. Filled where she practised, ringed on today,
 * faded for the days still ahead — so a Tuesday reads as a week in progress
 * rather than a week with five holes in it.
 */
function WeekDayMarks({ days, tone }: { days: WeekDay[]; tone: string }) {
  return (
    <div aria-hidden="true" className="flex items-end gap-[3px]">
      {days.map((day) => (
        <span
          className="w-[7px] rounded-full"
          key={day.dayStart}
          style={{
            height: day.sessions > 0 ? 24 : 10,
            background: day.sessions > 0 ? tone : "var(--surface-3)",
            opacity: day.isFuture ? 0.3 : 1,
            boxShadow: day.isToday ? `0 0 0 2px color-mix(in srgb, ${tone} 45%, transparent)` : undefined,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Sessions per day, scaled to the busiest day rather than to a fixed ceiling,
 * so a quiet week still has a shape instead of being a flat line.
 */
function WeekBars({ busiest, days, tone }: { busiest: number; days: WeekDay[]; tone: string }) {
  const top = Math.max(1, busiest);
  return (
    <div aria-hidden="true" className="flex items-end gap-[3px]">
      {days.map((day) => (
        <span
          className="w-[7px] rounded-full"
          key={day.dayStart}
          style={{
            height: day.sessions === 0 ? 5 : Math.round(8 + (day.sessions / top) * 20),
            background: day.sessions > 0 ? tone : "var(--surface-3)",
            opacity: day.isFuture ? 0.3 : 1,
          }}
        />
      ))}
    </div>
  );
}

/**
 * What is behind you and the one you are walking towards. Only the last few
 * steps are drawn: a row of twelve dots is decoration, not a figure.
 */
function MilestoneTrack({ earned, tone, total }: { earned: number; tone: string; total: number }) {
  const steps = 5;
  const last = Math.max(steps, Math.min(total, earned + 1));
  const first = last - steps + 1;
  return (
    <div aria-hidden="true" className="flex items-center">
      {Array.from({ length: steps }, (_, i) => {
        const step = first + i;
        const done = step <= earned;
        const current = step === earned + 1;
        return (
          <React.Fragment key={step}>
            {i > 0 && (
              <span className="h-[2px] w-2.5" style={{ background: done ? tone : "var(--surface-3)" }} />
            )}
            <span
              className="grid h-[18px] w-[18px] place-items-center rounded-full"
              style={{
                background: done ? tone : "var(--surface-3)",
                color: done ? "var(--accent-text)" : "var(--text-3)",
                boxShadow: current ? `0 0 0 3px color-mix(in srgb, ${tone} 32%, transparent)` : undefined,
              }}
            >
              {done ? <Check className="h-2.5 w-2.5" /> : <Star className="h-2.5 w-2.5" />}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ActivitySidePanel({ earned, user, words }: { earned: number; user: UserProfile | null; words: number }) {
  // Recomputed when a lesson lands, so finishing one moves the week without a
  // reload — and on a plain interval too, because a week that ends at midnight
  // on Sunday has to start again while the app is still open.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("activity-updated", refresh);
    const midnight = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("activity-updated", refresh);
      window.clearInterval(midnight);
    };
  }, []);
  const week = useMemo(() => weekRhythm(loadActivitySessions(user)), [user, revision]);

  const rows = [
    {
      art: <WeekDayMarks days={week.days} tone="var(--orange)" />,
      icon: CalendarDays,
      key: "days",
      label: ui("Days this week"),
      tone: "var(--orange)",
      value: `${uiNumber(week.daysPractised)}/7`,
    },
    {
      art: <WeekBars busiest={week.busiestDay} days={week.days} tone="var(--yellow)" />,
      icon: BookOpen,
      key: "sessions",
      label: ui("Sessions"),
      tone: "var(--yellow)",
      value: uiNumber(week.sessions),
    },
    {
      art: <MilestoneTrack earned={earned} tone="var(--accent)" total={MILESTONES.length} />,
      icon: Trophy,
      key: "milestones",
      label: ui("Milestones"),
      tone: "var(--accent)",
      value: `${uiNumber(earned)}/${uiNumber(MILESTONES.length)}`,
    },
  ];

  return (
    <aside className="card flex min-w-0 flex-col justify-between p-5 sm:p-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-[var(--text-1)]">{ui("This week")}</p>
            <p className="mt-1 text-xs font-semibold text-[var(--text-3)]">{ui("Quick read on your practice rhythm.")}</p>
            <p className="mt-0.5 text-[11px] font-bold text-[var(--text-3)]">{ui("Starts again every Monday.")}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-dim)] text-[var(--accent)]">
            <CalendarDays className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {rows.map((row) => {
            const RowIcon = row.icon;
            return (
              <div
                className="relative flex min-w-0 items-center gap-3 rounded-[18px] p-3.5 sm:gap-4"
                key={row.key}
                style={{
                  background: `linear-gradient(135deg, color-mix(in srgb, ${row.tone} 13%, var(--surface-2)) 0%, var(--surface-2) 62%)`,
                  border: `1px solid color-mix(in srgb, ${row.tone} 18%, transparent)`,
                }}
              >
                <span
                  className="absolute right-3 top-3 h-2 w-2 rounded-full"
                  style={{ background: row.tone }}
                />
                <span
                  className="grid h-11 w-11 flex-none place-items-center rounded-full"
                  style={{
                    background: `color-mix(in srgb, ${row.tone} 18%, transparent)`,
                    color: row.tone,
                    boxShadow: `0 0 0 1px color-mix(in srgb, ${row.tone} 26%, transparent)`,
                  }}
                >
                  <RowIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--text-3)]">{row.label}</p>
                  <p className="mt-0.5 text-2xl font-black leading-none tracking-tight text-[var(--text-1)]">
                    {row.value}
                  </p>
                </div>
                <div className="ml-auto hidden flex-none pl-2 sm:block">{row.art}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-[20px] p-4 text-[var(--feature-ink)]" style={{ background: "var(--feature-gradient)" }}>
        <p className="text-[11px] font-black uppercase tracking-wide">{ui("Words tracked")}</p>
        <p className="mt-1 text-3xl font-black tracking-tight">{uiNumber(words)}</p>
        <p className="mt-3 text-xs font-semibold">
          {ui("Keep short daily blocks going before adding longer review sessions.")}
        </p>
      </div>
    </aside>
  );
}

export default function GamificationPanel({
  stats,
  user,
  onUpdateStats,
  profileOnly = false,
  progressOnly = false,
  apiParts = {},
  onRequestCatalogue,
  onSwitchCourse,
  activeCourseName = "German",
}: {
  stats: Stats;
  user: UserProfile;
  onUpdateStats?: (next: Partial<Stats>) => void;
  profileOnly?: boolean;
  progressOnly?: boolean;
  apiParts?: Record<string, any>;
  onRequestCatalogue?: () => void;
  onSwitchCourse?: () => void;
  activeCourseName?: string;
}) {
  const [externalInput, setExternalInput] = useState(stats.externalWords.toString());
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(user.name);
  const [effects, setEffects] = useState<Effects>(getEffects);
  const [highContrast, setHighContrastState] = useState<boolean>(getHighContrast);
  const [direction] = useState<LearningDirection>(getLearningDirection);
  const [interfaceLanguage, setInterfaceLanguageState] = useState<InterfaceLanguage>(getInterfaceLanguage);
  const [learningMode, setLearningModeState] = useState<LearningMode>(getLearningMode);
  const [flashcardMode, setFlashcardModeState] = useState<FlashcardMode>(() => getFlashcardMode());
  const [flashcardFace, setFlashcardFaceState] = useState<FlashcardFace>(() => getFlashcardFace());
  const [meaningLenience, setMeaningLenienceState] = useState<MeaningLenience>(() => getMeaningLenience());
  const [meaningPlacement, setMeaningPlacementState] = useState<MeaningPlacement>(() => getMeaningPlacement());
  const [englishVariant, setEnglishVariantState] = useState<EnglishVariant>(() => getEnglishVariant(user));
  const [settingsQuery, setSettingsQuery] = useState("");
  const settingsSearchRef = useRef<HTMLInputElement | null>(null);
  const settingsTerms = useMemo(
    () => foldSearch(settingsQuery).split(/\s+/).filter(Boolean),
    [settingsQuery]
  );
  /** Does this category match what has been typed? */
  const matchesSearch = (title: string, description: string) => {
    if (!settingsTerms.length) return true;
    // Category titles are localised before they arrive here, while the search
    // aliases are deliberately keyed by their stable English IDs. Resolve the
    // translated title back to that ID so German searches still see aliases
    // such as "Audio" and the English terms remain useful too.
    const canonicalTitle = Object.keys(SETTINGS_SEARCH_INDEX).find(
      (candidate) => candidate === title || ui(candidate) === title
    ) ?? title;
    const haystack = foldSearch([
      canonicalTitle,
      ui(canonicalTitle),
      title,
      description,
      SETTINGS_SEARCH_INDEX[canonicalTitle] ?? "",
    ].join(" "));
    return settingsTerms.every((term: string) => haystack.includes(term));
  };
  const searchHits = useMemo(
    () => (settingsTerms.length
      ? Object.keys(SETTINGS_SEARCH_INDEX).filter((title) => matchesSearch(title, ""))
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settingsTerms]
  );
  const [accentColour, setAccentColourState] = useState(() => getAccentColour());
  useEffect(() => {
    const sync = () => setAccentColourState(getAccentColour());
    window.addEventListener(ACCENT_CHANGE_EVENT, sync);
    window.addEventListener("storage-sync-completed", sync);
    return () => {
      window.removeEventListener(ACCENT_CHANGE_EVENT, sync);
      window.removeEventListener("storage-sync-completed", sync);
    };
  }, []);
  const [inspecting, setInspecting] = useState(false);
  const [paintedParts, setPaintedParts] = useState<Record<string, string | undefined>>(
    () => (typeof window === "undefined" ? {} : getCustomColours())
  );
  useEffect(() => {
    const sync = () => setPaintedParts(getCustomColours());
    window.addEventListener(CUSTOM_COLOURS_CHANGE_EVENT, sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage-sync-completed", sync);
    return () => {
      window.removeEventListener(CUSTOM_COLOURS_CHANGE_EVENT, sync);
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage-sync-completed", sync);
    };
  }, []);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());
  // Another window (or the OS, while on "system") can change the theme; keep
  // the chosen option in step rather than showing a stale selection.
  useEffect(() => {
    const sync = () => setThemePreferenceState(getThemePreference());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage-sync-completed", sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage-sync-completed", sync);
    };
  }, []);
  const [guidedBackground, setGuidedBackgroundState] = useState<GuidedBackground>(() => getGuidedBackground());
  const [guidedCustomBackground, setGuidedCustomBackground] = useState<string | null>(() => getGuidedCustomBackground());
  const [guidedBackgroundError, setGuidedBackgroundError] = useState("");

  const resolvedEnglishVariant = resolveEnglishVariant(englishVariant);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const guidedBackgroundInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(user.avatar);

  const onAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarPreview(dataUrl);
      setAuthUser({ ...user, avatar: dataUrl });
      window.location.reload();
    } catch {
      /* ignore unreadable image */
    }
  };

  const removeAvatar = () => {
    setAvatarPreview(undefined);
    setAuthUser({ ...user, avatar: undefined });
    window.location.reload();
  };
  const { cur } = getLevelInfo(stats.totalXp ?? 0);
  const vocab = countKnownVocab(user, stats.externalWords || 0);
  const earned = MILESTONES.filter((item) => item.check(stats)).length;
  const catalogueReady = Object.keys(apiParts).length > 0;
  const [trackerRequested, setTrackerRequested] = useState(false);
  const [trackerPrepared, setTrackerPrepared] = useState(false);
  const requestVocabTracker = useCallback(() => {
    setTrackerRequested(true);
    onRequestCatalogue?.();
  }, [onRequestCatalogue]);
  // Sätze / Wörter as one tabbed section rather than two cards stacked down
  // the page — the request was specifically not to have to scroll past one
  // to reach the other. Sätze stays the default tab (it always has been the
  // section people land on), so the reveal-triggered heavy index prep below
  // is unaffected: the tab bar cannot be clicked before the section has
  // scrolled into view in the first place, and by then that prep is already
  // under way for the tab that is showing. Wörter's own catalogue build is
  // far cheaper and simply happens on mount when its tab is chosen — it no
  // longer waits on Sätze's heavy prep the way the old stacked layout did.
  const [trackerTab, setTrackerTab] = useState<"sentences" | "words">("sentences");
  // Either standalone panel can be the one holding the tracker, so the two
  // idle-work hooks below warm it for both rather than for settings alone.
  const panelOnly = profileOnly || progressOnly;

  // Preload only the small tracker component while the browser is idle. The
  // multi-megabyte lesson catalogue stays deferred until its section is
  // actually reached.
  useEffect(() => {
    if (!panelOnly) return undefined;
    return scheduleProfileIdleWork(() => {
      void loadVocabTrackerModule();
    });
  }, [panelOnly]);

  // Once the learner reaches the tracker, build its immutable indexes during
  // browser idle time before mounting the interactive list. This avoids a
  // visible main-thread hitch in the middle of a scroll.
  useEffect(() => {
    if (!panelOnly || !trackerRequested || !catalogueReady) return undefined;
    let cancelled = false;
    setTrackerPrepared(false);
    const cancelIdle = scheduleProfileIdleWork(() => {
      void loadVocabTrackerModule().then((module) => {
        if (cancelled) return;
        module.prepareVocabTrackerData(apiParts);
        setTrackerPrepared(true);
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [apiParts, catalogueReady, panelOnly, trackerRequested]);

  const saveName = () => {
    if (!newName.trim()) return;
    setAuthUser({ ...user, name: newName.trim() });
    setIsEditingName(false);
    window.location.reload();
  };

  const signOut = () => {
    setAuthUser(null);
    window.location.reload();
  };

  const toggleEffects = () => {
    const next: Effects = effects === "lite" ? "full" : "lite";
    setEffects(next);
    setEffects(next);
  };

  const toggleHighContrast = () => {
    const next = !highContrast;
    applyHighContrast(next);
    setHighContrastState(next);
  };

  const updateEnglishVariant = (value: EnglishVariant) => {
    setEnglishVariantState(value);
    setEnglishVariant(value, user);
  };

  const updateLearningMode = (value: LearningMode) => {
    setLearningMode(value);
    setLearningModeState(value);
  };

  const updateGuidedBackground = (value: GuidedBackground) => {
    saveGuidedBackground(value);
    setGuidedBackgroundState(getGuidedBackground());
    setGuidedBackgroundError("");
  };

  const onGuidedBackgroundFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setGuidedBackgroundError("");
    try {
      await saveGuidedCustomBackground(file);
      const saved = getGuidedCustomBackground();
      setGuidedCustomBackground(saved);
      setGuidedBackgroundState(getGuidedBackground());
      if (!saved) setGuidedBackgroundError(ui("We couldn't save that image on this device. Try a smaller one."));
    } catch (error) {
      setGuidedBackgroundError(error instanceof Error ? error.message : ui("We couldn't prepare that image."));
    }
  };

  const removeGuidedBackgroundImage = () => {
    clearGuidedCustomBackground();
    setGuidedCustomBackground(null);
    setGuidedBackgroundState(getGuidedBackground());
    setGuidedBackgroundError("");
  };

  // Single dropdown covering "what's your language": pick an English variant to
  // learn German as an English speaker, or pick German to flip the app and learn
  // English as a German speaker.
  const LANGUAGE_SELECT_VALUE = englishVariant;

  /** The interface. Which language the app itself is written in. */
  const updateInterfaceLanguage = (next: InterfaceLanguage) => {
    setInterfaceLanguage(next);
    setInterfaceLanguageState(next);
  };

  const updateLanguageSelection = (value: string) => {
    updateEnglishVariant(value as EnglishVariant);
  };

  // What the account menu's "Your progress" opens. Mastery, this week, the
  // totals and the vocabulary tracker used to sit at the bottom of the
  // settings page — several screens below the last thing anyone would call a
  // setting, and nowhere near the menu entry named after them.
  if (progressOnly) {
    return (
      <div className="space-y-5">
        {/* Named so the sidebar's Vocabulary row can land on the tracker
            rather than at the top of the page holding it. The class is the
            handle; nothing about the section itself changes. */}
        {/* The anchor rides on the fold's heading rather than on the content:
            the sidebar's own row and the home page's fading line both jump
            here, and a jump has to land on something that exists whether the
            block is open or not. Both ask it to open on the way. */}
        {/* overflow-clip, not the fold's usual overflow-hidden — twMerge lets
            this one card override it. Both clip the same way, but `hidden`
            makes the card a scroll container, and a scroll container is what
            position:sticky measures against: the tracker's filter row computed
            as sticky and then never stuck, because the box it was sticking
            inside does not scroll. `clip` clips without creating one. The
            shell above already does this — .np-window and .new-ui-prototype
            are both `clip` for the same reason. */}
        <ProfileFold
          className="np-vocabulary-anchor overflow-clip"
          icon={WholeWord}
          id="vocabulary"
          onOpenRequest={onVocabLibraryOpen}
          subtitle={ui("Every sentence and word you are tracking.")}
          title={ui("Vocabulary library")}
          user={user}
        >
        <DeferredProfileSection
          fallback={<ProfileSectionLoading label={ui("Loading vocabulary library")} />}
          minHeight={360}
          onReveal={requestVocabTracker}
        >
          {/* One card, one tab bar, one piece of content at a time — Sätze
              and Wörter used to be two full cards stacked down the page,
              which meant scrolling past one to reach the other even though
              they're the same kind of thing. The tab bar owns the card's
              chrome; VocabTracker/WordsTracker each render only their INNER
              content now (see the comment atop WordsTracker.tsx) so nesting
              them here does not double up a border/shadow inside another. */}
          <section className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={ui("Tracker")}>
              {([
                ["sentences", "Sentences"],
                ["words", "Words"],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={trackerTab === tab}
                  onClick={() => setTrackerTab(tab)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-black transition-colors",
                    trackerTab === tab
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)]"
                  )}
                >
                  {ui(label)}
                </button>
              ))}
            </div>
            {catalogueReady ? (
              <Suspense fallback={<ProfileSectionLoading label={ui("Loading vocabulary library")} />}>
                {trackerTab === "sentences" ? (
                  trackerPrepared
                    ? <VocabTracker apiParts={apiParts} user={user} />
                    : <ProfileSectionLoading label={ui("Loading vocabulary library")} />
                ) : (
                  <WordsTracker apiParts={apiParts} user={user} />
                )}
              </Suspense>
            ) : (
              <ProfileSectionLoading label={ui("Loading vocabulary library")} />
            )}
          </section>
        </DeferredProfileSection>
        </ProfileFold>

        <ProfileFold
          icon={Trophy}
          id="progress"
          subtitle={ui("Mastery, this week and your milestones.")}
          title={ui("Your progress")}
          user={user}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <ProgressSummaryCard cur={cur} earned={earned} stats={stats} words={vocab} vocab={vocab} />
            <ActivitySidePanel earned={earned} user={user} words={vocab} />
          </div>
        </ProfileFold>

        <ProfileFold
          icon={BarChart3}
          id="totals"
          subtitle={ui("XP, lessons, days learned and words tracked.")}
          title={ui("Totals")}
          user={user}
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard color="bg-[var(--accent)]" icon={BarChart3} label={ui("Total XP")} value={uiNumber(stats.totalXp)} />
            <StatCard color="bg-[var(--mint)]" icon={BookOpen} label={ui("Lessons done")} value={uiNumber(stats.sessionsCompleted)} />
            <StatCard color="bg-[var(--orange)]" icon={Flame} label={ui("Day streak")} value={uiNumber(stats.streak)} />
            <StatCard color="bg-[var(--ink)]" icon={Target} label={ui("Words tracked")} value={uiNumber(vocab)} />
          </div>
        </ProfileFold>

        {/* Collapsed like the folds above it: worth having, not worth the top
            third of the screen. */}
        <SettingsCategory
          description={`${earned} ${ui("of")} ${MILESTONES.length} ${ui("reached")}`}
          icon={Trophy}
          title={ui("Milestones")}
        >
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MILESTONES.map((item) => {
              const ok = item.check(stats);
              return (
                <motion.div
                  className={cn(
                    "rounded-[20px] border p-4",
                    ok ? "border-[var(--accent)] bg-[var(--accent-dim)]" : "border-[var(--border)] bg-[var(--surface-2)]"
                  )}
                  key={item.id}
                  whileHover={{ y: -2 }}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-full", ok ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--text-3)]")}>
                      {ok ? <Check className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-black text-[var(--text-1)]">{ui(item.label)}</p>
                      <p className="text-xs font-semibold text-[var(--text-3)]">{ui(item.desc)}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </SettingsCategory>
      </div>
    );
  }

  if (profileOnly) {
    return (
      <div className="space-y-5">
        <section className="card overflow-hidden p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black text-[var(--accent)]">{ui("Account")}</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text-1)]">{ui("Profile settings")}</h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[var(--text-3)]">
                {ui("Manage your contact details, learning preferences, and words you have already learned.")}
              </p>
            </div>
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[var(--accent-dim)] text-xl font-black text-[var(--accent)]">
              {avatarPreview ? <img src={avatarPreview} alt="" className="h-full w-full object-cover" /> : (user.name?.[0]?.toUpperCase() ?? "?")}
            </div>
          </div>
        </section>

        <section className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-dim)] text-[var(--accent)]">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[var(--text-3)]">{ui("Current course")}</p>
              <p className="mt-0.5 text-lg font-black text-[var(--text-1)]">{ui(activeCourseName)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSwitchCourse}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-black text-white transition-opacity hover:opacity-90"
          >
            {ui("Switch course")}
          </button>
        </section>

        <SettingsCategoryLayout
          search={(
                <>
                  <label className="settings-search block">
                    <Search aria-hidden="true" className="settings-search__icon" />
                    <input
                      aria-label={ui("Search settings")}
                      className="settings-search__input"
                      onChange={(event) => setSettingsQuery(event.target.value)}
                      /* Short on purpose: the box is narrow on a small window
                         and the full phrase was cut off mid-word. The
                         aria-label above keeps it, so a screen reader still
                         hears what is being searched. */
                      placeholder={ui("Search\u2026")}
                      ref={settingsSearchRef}
                      type="search"
                      value={settingsQuery}
                    />
                    {settingsQuery && (
                      <button
                        aria-label={ui("Clear search")}
                        className="settings-search__clear"
                        onClick={() => {
                          setSettingsQuery("");
                          settingsSearchRef.current?.focus();
                        }}
                        type="button"
                      >
                        <X aria-hidden="true" />
                      </button>
                    )}
                  </label>
                {settingsTerms.length > 0 && (
                  <p className="mt-2 text-xs font-semibold text-[var(--text-3)]">
                    {searchHits.length === 0
                      ? ui("Nothing matches that. Try “theme”, “voice”, or “pet”.")
                      : `${searchHits.length} ${searchHits.length === 1 ? ui("section") : ui("sections")} ${ui("match")}`}
                  </p>
                )}
                </>
          )}
        >
              {/* Account details used to sit above everything, permanently, while
                  the things you might actually be looking for were behind a search
                  box. It is a category like the rest now. */}
              <SettingsCategory
                description={ui("Your photo, display name, and login email.")}
                forceOpen={settingsTerms.length > 0}
                hidden={!matchesSearch(ui("Account details"), ui("Your photo, display name, and login email."))}
                icon={UserRound}
                title={ui("Account details")}
                tone="account"
              >
              {/* No heading here. SettingsCategory draws the title and the
                  description itself; these two lines were left behind when
                  this stopped being a permanent block above the page and
                  became a category like the rest, so the panel said "Account
                  details — your photo, display name, and login email" twice
                  in a row. */}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  aria-label={ui("Change profile photo")}
                  className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent-dim)] text-xl font-black text-[var(--accent)] ring-2 ring-[var(--surface)]"
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    user.name?.[0]?.toUpperCase() ?? "?"
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera className="h-5 w-5" />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  {isEditingName ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                        onChange={(event) => setNewName(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && saveName()}
                        type="text"
                        value={newName}
                      />
                      <button className="accent-btn h-10 w-10" onClick={saveName} type="button">
                        <Check className="mx-auto h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-black text-[var(--text-1)]">{user.name}</p>
                        <p className="truncate text-xs font-semibold text-[var(--text-3)]">{user.email}</p>
                      </div>
                      <button
                        aria-label={ui("Edit profile name")}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--accent)]"
                        onClick={() => setIsEditingName(true)}
                        type="button"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => avatarInputRef.current?.click()} className="ghost-btn h-9 px-3 text-xs">
                  {ui(avatarPreview ? "Change photo" : "Upload photo")}
                </button>
                {avatarPreview && (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    className="h-9 rounded-xl px-3 text-xs font-bold text-rose-500 transition-colors hover:bg-rose-500/10"
                  >
                    {ui("Remove")}
                  </button>
                )}
                <span className="text-[11px] font-semibold text-[var(--text-3)]">{ui("Square images look best. They are stored on this device.")}</span>
              </div>
              </SettingsCategory>

                <SettingsCategory
                  description={ui("Theme, lesson background, and app zoom.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Appearance"), ui("Theme, lesson background, and app zoom."))}
                  icon={Palette}
                  title={ui("Appearance")}
                  tone="look"
                >
                  <div className="mt-3 rounded-[18px] bg-[var(--surface)] p-4">
                    <div className="flex items-start gap-2">
                      <MoonStar className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <div>
                        <p className="text-sm font-black text-[var(--text-1)]">{ui("App theme")}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                          {ui("Light for daytime study, dark for late evenings. Lessons keep their own background either way.")}
                        </p>
                      </div>
                    </div>
                    <div aria-label={ui("App theme")} className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup">
                      {([
                        ["light", "Light", "Sun"],
                        ["dark", "Dark", "Moon"],
                        ["system", "Match system", "Monitor"],
                      ] as const).map(([value, label]) => {
                        const active = themePreference === value;
                        return (
                          <button
                            aria-checked={active}
                            className={cn(
                              "rounded-[16px] border px-3 py-3 text-left transition-colors",
                              active
                                ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                                : "border-[color:var(--card-edge)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]"
                            )}
                            key={value}
                            onClick={() => {
                              setTheme(value);
                              setThemePreferenceState(value);
                            }}
                            role="radio"
                            type="button"
                          >
                            <span className={cn(
                              "block text-sm font-black",
                              active ? "text-[var(--accent-strong)]" : "text-[var(--text-1)]"
                            )}>
                              {ui(label)}
                            </span>
                            <span className="mt-0.5 block text-[11px] font-semibold text-[var(--text-3)]">
                              {value === "system"
                                ? `${ui("Currently")} ${ui(systemTheme() === "dark" ? "dark" : "light")}`
                                : value === DEFAULT_THEME ? ui("The default")
                                : value === "dark" ? ui("Easier on tired eyes") : ui("Best in a bright room")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3 rounded-[18px] bg-[var(--surface)] p-4">
                    <div className="flex items-start gap-2">
                      <Paintbrush className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <div>
                        <p className="text-sm font-black text-[var(--text-1)]">{ui("Accent colour")}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                          {ui("The colour of buttons, progress and anything selected. Micheon green is the default.")}
                        </p>
                      </div>
                    </div>
                    <div aria-label={ui("Accent colour")} className="mt-3 flex flex-wrap gap-2" role="radiogroup">
                      {ACCENT_PRESETS.map((preset) => {
                        const active = normaliseHex(accentColour) === preset.hex;
                        return (
                          <button
                            aria-checked={active}
                            aria-label={ui(preset.name)}
                            className={cn(
                              "settings-swatch",
                              active && "settings-swatch--active"
                            )}
                            key={preset.hex}
                            onClick={() => {
                              setAccentColour(preset.hex);
                              setAccentColourState(preset.hex);
                            }}
                            role="radio"
                            style={{ background: preset.hex }}
                            title={ui(preset.name)}
                            type="button"
                          >
                            {active && <Check aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="settings-swatch-custom">
                        <input
                          aria-label={ui("Pick any colour")}
                          onChange={(event) => {
                            setAccentColour(event.target.value);
                            setAccentColourState(event.target.value);
                          }}
                          type="color"
                          value={normaliseHex(accentColour) ?? DEFAULT_ACCENT}
                        />
                        <span>{ui("Pick any colour")}</span>
                      </label>
                      <button
                        className="settings-reset"
                        disabled={isDefaultAccent(accentColour)}
                        onClick={() => {
                          resetAccentColour();
                          setAccentColourState(DEFAULT_ACCENT);
                        }}
                        type="button"
                      >
                        <RotateCcw aria-hidden="true" />
                        {ui("Reset to green")}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-[18px] bg-[var(--surface)] p-4">
                    <div className="flex items-start gap-2">
                      <Pipette className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <div>
                        <p className="text-sm font-black text-[var(--text-1)]">{ui("Advanced: colour any part")}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                          {ui("Point at a part of the app and change its colour. Each colour is remembered separately for the light and dark themes.")}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        className="settings-reset"
                        onClick={() => setInspecting(true)}
                        type="button"
                      >
                        <Pipette aria-hidden="true" />
                        {ui("Pick a part of the app")}
                      </button>
                      <button
                        className="settings-reset"
                        disabled={Object.keys(paintedParts).length === 0}
                        onClick={() => {
                          resetCustomColours();
                          setPaintedParts({});
                        }}
                        type="button"
                      >
                        <RotateCcw aria-hidden="true" />
                        {ui("Reset every part")}
                      </button>
                    </div>
                    {Object.keys(paintedParts).length === 0 ? (
                      <p className="mt-3 text-xs font-semibold leading-5 text-[var(--text-3)]">
                        {ui("Nothing recoloured yet — the app is using its own palette.")}
                      </p>
                    ) : (
                      <div className="mt-2">
                        {Object.entries(paintedParts).map(([token, hex]) => {
                          const part = PAINTABLE_BY_TOKEN.get(token);
                          if (!part || !hex) return null;
                          return (
                            <div className="painted-part" key={token}>
                              <label className="painted-part__swatch">
                                <input
                                  aria-label={ui(part.name)}
                                  onChange={(event) => {
                                    setCustomColour(token, event.target.value);
                                    setPaintedParts(getCustomColours());
                                  }}
                                  type="color"
                                  value={hex}
                                />
                              </label>
                              <span className="painted-part__text">
                                <span className="painted-part__name">{ui(part.name)}</span>
                                <span className="painted-part__note">{ui(part.description)}</span>
                              </span>
                              <button
                                className="painted-part__clear"
                                onClick={() => {
                                  clearCustomColour(token);
                                  setPaintedParts(getCustomColours());
                                }}
                                type="button"
                              >
                                {ui("Undo")}
                              </button>
                            </div>
                          );
                        })}
                        <p className="mt-2 text-[11px] font-semibold text-[var(--text-3)]">
                          {currentThemeName() === "dark"
                            ? ui("These apply to the dark theme.")
                            : ui("These apply to the light theme.")}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 rounded-[18px] bg-[var(--surface)] p-4">
                    <div className="flex items-start gap-2">
                      <Palette className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <div>
                        <p className="text-sm font-black text-[var(--text-1)]">{ui("Guided lesson background")}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                          {ui("Choose the scenery behind your focused lesson. It never changes the lesson itself.")}
                        </p>
                      </div>
                    </div>
                    {/* One line instead of six tiles. Six of them took more of
                        this page than the setting is worth, and they will only
                        multiply. The description follows the choice so nothing
                        that was on those tiles is lost — you read one at a time
                        rather than all of them. */}
                    <select
                      aria-label={ui("Guided lesson background")}
                      className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                      onChange={(event) => updateGuidedBackground(event.target.value as GuidedBackground)}
                      value={guidedBackground}
                    >
                      {GUIDED_SCENES.map(([value, label]) => (
                        <option key={value} value={value}>{ui(label)}</option>
                      ))}
                      {/* Only once there is one to choose — the row below is
                          where an image is put there in the first place. */}
                      {guidedCustomBackground && <option value="custom">{ui("Your own image")}</option>}
                    </select>
                    <p className="mt-2 text-[11px] font-semibold leading-4 text-[var(--text-3)]">
                      {ui(GUIDED_SCENES.find(([value]) => value === guidedBackground)?.[2]
                        ?? "Use your saved image behind every guided lesson.")}
                    </p>
                    <div className={cn(
                      "mt-2 flex flex-wrap items-center gap-3 rounded-2xl border p-3",
                      guidedBackground === "custom"
                        ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                        : "border-[var(--border)] bg-[var(--surface-2)]"
                    )}>
                      <button
                        aria-pressed={guidedBackground === "custom"}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-3 text-left",
                          !guidedCustomBackground && "cursor-default"
                        )}
                        disabled={!guidedCustomBackground}
                        onClick={() => updateGuidedBackground("custom")}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="h-12 w-16 shrink-0 rounded-xl border border-black/5 bg-[var(--surface)] bg-cover bg-center shadow-sm"
                          style={guidedCustomBackground ? { backgroundImage: `url(${guidedCustomBackground})` } : undefined}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-black text-[var(--text-1)]">{ui("Your own image")}</span>
                          <span className="mt-0.5 block text-[11px] font-semibold leading-4 text-[var(--text-3)]">
                            {ui(guidedCustomBackground ? "Use your saved image behind every guided lesson." : "Choose a photo or illustration that puts you in the right mood.")}
                          </span>
                        </span>
                      </button>
                      <input ref={guidedBackgroundInputRef} accept="image/*" className="hidden" onChange={onGuidedBackgroundFile} type="file" />
                      <button
                        className="ghost-btn h-9 shrink-0 px-3 text-xs"
                        onClick={() => guidedBackgroundInputRef.current?.click()}
                        type="button"
                      >
                        {ui(guidedCustomBackground ? "Change image" : "Upload image")}
                      </button>
                      {guidedCustomBackground && (
                        <button
                          className="h-9 shrink-0 rounded-xl px-3 text-xs font-bold text-rose-500 transition-colors hover:bg-rose-500/10"
                          onClick={removeGuidedBackgroundImage}
                          type="button"
                        >
                          {ui("Remove")}
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] font-semibold leading-4 text-[var(--text-3)]">
                      {guidedBackgroundError || ui("Your image is compressed and stored only on this device.")}
                    </p>
                  </div>
                  <AppZoomControl />
                </SettingsCategory>

                <SettingsCategory
                  description={ui("High contrast, calmer motion, and speech speed.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Accessibility"), ui("High contrast, calmer motion, and speech speed."))}
                  icon={Eye}
                  title={ui("Accessibility")}
                  tone="access"
                >
                  <button
                    aria-pressed={highContrast}
                    aria-label={ui("Toggle high contrast")}
                    className="mt-3 flex w-full items-start justify-between gap-3 rounded-[18px] bg-[var(--surface)] px-4 py-3 text-left"
                    onClick={toggleHighContrast}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-black text-[var(--text-1)]">
                        <Contrast className="h-4 w-4" /> {ui("High contrast")}
                      </span>
                      <span className="mt-1 block text-xs font-semibold leading-5 text-[var(--text-3)]">
                        {ui("Stronger text and clearer edges in both light and dark mode.")}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs font-black",
                        highContrast ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--text-2)]"
                      )}
                    >
                      {ui(highContrast ? "On" : "Off")}
                    </span>
                  </button>

                  <button
                    aria-pressed={effects === "lite"}
                    aria-label={ui("Toggle reduced effects")}
                    className="mt-3 flex w-full items-start justify-between gap-3 rounded-[18px] bg-[var(--surface)] px-4 py-3 text-left"
                    onClick={toggleEffects}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-black text-[var(--text-1)]">
                        <Zap className="h-4 w-4" /> {ui("Reduce effects")}
                      </span>
                      <span className="mt-1 block text-xs font-semibold leading-5 text-[var(--text-3)]">
                        {ui("Turns off glows and continuous animations to save battery on slower devices.")}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs font-black",
                        effects === "lite" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--text-2)]"
                      )}
                    >
                      {ui(effects === "lite" ? "On" : "Off")}
                    </span>
                  </button>

                  <div className="mt-3 rounded-[18px] bg-[var(--surface)] p-4">
                    <SpeechSpeedControl
                      description={ui("Set both voices together or tune English and German separately. Changes also apply to lessons, games, and the companion.")}
                      testId="accessibility-speech-speed"
                    />
                  </div>
                </SettingsCategory>

                <SettingsCategory
                  description={ui("Startup, close button, and update checks.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Desktop app & updates"), ui("Startup, close button, and update checks."))}
                  icon={Monitor}
                  title={ui("Desktop app & updates")}
                  tone="desktop"
                >
                  <WindowsAppSettings />

                  {/* Account-adjacent status and progress controls balance this
                      column without hiding them among the learning-mode choices. */}
                  <UpdateStatusCard />
                </SettingsCategory>

                <SettingsCategory
                  description={ui("Learning style, flashcards, and words learned elsewhere.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Learning options"), ui("Learning style, flashcards, and words learned elsewhere."))}
                  icon={BookOpen}
                  title={ui("Learning options")}
                  tone="learn"
                >
                  <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
                    <p className="text-sm font-black text-[var(--text-1)]">{ui("External word count")}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                      {ui("Add words learned elsewhere so the app can show a more honest vocabulary total.")}
                    </p>
                    <input
                      className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                      min="0"
                      onChange={(event) => {
                        const valueString = event.target.value;
                        setExternalInput(valueString);
                        onUpdateStats?.({ externalWords: parseInt(valueString, 10) || 0 });
                      }}
                      placeholder="0"
                      type="number"
                      value={externalInput}
                    />
                  </div>

                  <LearningModePicker value={learningMode} onChange={updateLearningMode} />

                  {/* Where the card puts the language you already speak. The
                      meaning used to sit outside the board at a third of the
                      size, which is the smallest thing on screen and the one
                      that says what any of it means. */}
                  <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
                    <p className="text-sm font-black text-[var(--text-1)]">{ui("The meaning on a lesson card")}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                      {ui("On the card it sits under the sentence at a size you can read at a glance. Underneath keeps it small and out of the way, for practising without it.")}
                    </p>
                    <div
                      aria-label={ui("The meaning on a lesson card")}
                      className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5"
                      role="radiogroup"
                    >
                      {([
                        ["card", "On the card"],
                        ["below", "Underneath"],
                      ] as const).map(([value, label]) => {
                        const selected = meaningPlacement === value;
                        return (
                          <button
                            aria-checked={selected}
                            className={cn(
                              "min-h-10 rounded-xl border px-2 py-2 text-xs font-black transition-[background-color,border-color,color] duration-150",
                              selected
                                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                                : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                            )}
                            data-testid={`meaning-placement-${value}`}
                            key={value}
                            onClick={() => { setMeaningPlacementState(setMeaningPlacement(value)); }}
                            role="radio"
                            type="button"
                          >
                            {ui(label)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* How much drilling a lesson does is the learner's call. The
                      default picks per phrase; this is where the old long route
                      lives, and where any other route can be built. */}
                  <LessonStagesSetting />

                  {/* What you would rather not learn is as much a setting as
                      how you learn it, and it belongs beside the rest of what
                      shapes a lesson rather than only on the lesson list. */}
                  <InterestsSetting apiParts={apiParts} onRequestCatalogue={onRequestCatalogue} />

                  {/* Flashcards had a category to themselves, sitting between
                      the learning options above and the language settings below.
                      Two controls are not a section of the same rank as the rest,
                      and they answer the same question the options above answer:
                      how the learning is done. Inside one they keep their own
                      heading, which the standalone category used to draw for them. */}
                  <FlashcardModePicker
                    face={flashcardFace}
                    mode={flashcardMode}
                    onFaceChange={(next) => { setFlashcardFaceState(next); setFlashcardFace(next); }}
                    onModeChange={(next) => { setFlashcardModeState(next); setFlashcardMode(next); }}
                  />

                  {/* The two boxes in a lesson are asking different questions.
                      The target one is the answer; the meaning one only shows
                      the sentence was understood, in a language the learner
                      already has. Marking both to the same standard fails a
                      recall over a language nobody is being tested on. */}
                  <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
                    <p className="text-sm font-black text-[var(--text-1)]">{ui("Typos in the meaning box")}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                      {ui("Only affects the side you are not learning. The word you are being taught is always marked exactly.")}
                    </p>
                    <div
                      aria-label={ui("Typos in the meaning box")}
                      className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5"
                      role="radiogroup"
                    >
                      {([
                        ["forgiving", "Let small typos through"],
                        ["strict", "Mark it exactly"],
                      ] as const).map(([value, label]) => {
                        const selected = meaningLenience === value;
                        return (
                          <button
                            aria-checked={selected}
                            className={cn(
                              "min-h-10 rounded-xl border px-2 py-2 text-xs font-black transition-[background-color,border-color,color] duration-150",
                              selected
                                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] shadow-[0_3px_0_var(--accent-dark)]"
                                : "border-transparent bg-transparent text-[var(--text-2)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                            )}
                            data-testid={`meaning-lenience-${value}`}
                            key={value}
                            onClick={() => { setMeaningLenienceState(setMeaningLenience(value)); }}
                            role="radio"
                            type="button"
                          >
                            {ui(label)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </SettingsCategory>

                <SettingsCategory
                  description={ui("English spelling, app language, and the speaking voice.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Language & voice"), ui("English spelling, app language, and the speaking voice."))}
                  icon={Languages}
                  title={ui("Language & voice")}
                  tone="voice"
                >
                  {/* Two questions, two answers. Which language you are learning, and
                      which language the app is written in. Deriving the second from the
                      first meant a German speaker learning English could not have an
                      English app, and an English speaker learning German could not have
                      a German one -- both of which people actually wanted. */}
                  <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
                    <p className="text-sm font-black text-[var(--text-1)]">{ui("Languages")}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                      {ui("Which language the app itself is written in. Pick what you are LEARNING from the course card on the home page.")}
                    </p>
<label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-[var(--text-3)]">
                      {ui("App language")}
                    </label>
                    <AppLanguagePicker
                      autoLabel={direction === "learn-en" ? "Deutsch" : ui("English")}
                      onChange={updateInterfaceLanguage}
                      value={interfaceLanguage}
                    />
                  </div>
                  <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-[var(--text-1)]">{ui("English spelling and accent")}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                          {uiFmt("Auto uses your browser/keyboard language. Current: {variant}.", {
                            variant: ui(englishVariantLabel(resolvedEnglishVariant)),
                          })}
                        </p>
                      </div>
                      <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-black text-[var(--text-2)]">
                        {direction === "learn-en" ? "Deutsch" : resolvedEnglishVariant === "british" ? "practise" : "practice"}
                      </span>
                    </div>
                    <select
                      className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                      onChange={(event) => updateLanguageSelection(event.target.value)}
                      value={LANGUAGE_SELECT_VALUE}
                    >
                      <option value="auto">{ui("Auto-detect")} ({ui(englishVariantLabel(detectEnglishVariant()))})</option>
                      <option value="british">{ui("British English")}</option>
                      <option value="american">{ui("American English")}</option>
                                          </select>
                    {/* Sits with the accent setting: one picks how English is
                        written and which accent is spoken, the other picks who
                        speaks it. Separating them into two cards read as two
                        unrelated things. */}
                    <VoicePicker />
                  </div>
                </SettingsCategory>

            <DeferredProfileSection
              className="settings-list-group"
              // Keep a 1px observer target so this group still reveals when it
              // reaches the viewport, without bringing back the visible pill.
              fallback={<div aria-hidden="true" className="h-px w-full" />}
              minHeight={1}
            >
                <SettingsCategory
                  description={ui("Pick a desk pet and choose how often it talks.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Pet & mascot"), ui("Pick a desk pet and choose how often it talks."))}
                  icon={PawPrint}
                  title={ui("Pet & mascot")}
                  tone="pet"
                >
                  <Suspense fallback={<ProfileSectionLoading embedded label={ui("Loading pet settings")} />}>
                    <CodexPetPicker className="mt-0 border-t-0 pt-0" />
                  </Suspense>
                </SettingsCategory>

                <SettingsCategory
                  description={ui("Space used, and deleting what Micheon has saved.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Data & storage"), ui("Space used, and deleting what Micheon has saved."))}
                  icon={HardDrive}
                  title={ui("Data & storage")}
                  tone="data"
                >
                  <DataAndStorage />
                </SettingsCategory>

                <SettingsCategory
                  description={ui("A companion for Chrome, Edge and Brave that keeps teaching you as you browse.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Browser extension"), ui("A companion for Chrome, Edge and Brave that keeps teaching you as you browse."))}
                  icon={BROWSER_EXTENSION_ICON}
                  title={ui("Browser extension")}
                  tone="browser"
                >
                  <BrowserExtension />
                </SettingsCategory>

                {/* Used to sit permanently at the top of the page, above
                    everything else worth looking at. It is a category like
                    the rest now — still one search away, not the first
                    thing anyone sees. */}
                <SettingsCategory
                  description={ui("Your streak, sessions, and this week's activity.")}
                  forceOpen={settingsTerms.length > 0}
                  hidden={!matchesSearch(ui("Activity"), ui("Your streak, sessions, and this week's activity."))}
                  icon={Activity}
                  title={ui("Activity")}
                  tone="activity"
                >
                  <ActivityCard className="mt-3 min-w-0" progressStats={stats} />
                </SettingsCategory>
            </DeferredProfileSection>
        </SettingsCategoryLayout>

        <section className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="text-sm font-black text-[var(--text-1)]">{ui("Sign out")}</p>
            <p className="mt-1 text-xs font-semibold text-[var(--text-3)]">{ui("You'll return to the login screen. Progress stays saved on this device.")}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--red-bg)] px-4 py-2.5 text-sm font-black text-[var(--red-text)] transition-opacity hover:opacity-90"
          >
            <LogOut className="h-4 w-4" /> {ui("Sign out")}
          </button>
        </section>

        <CreditsCard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
        <ActivityCard className="min-w-0" progressStats={stats} />
        <ProgressSummaryCard cur={cur} earned={earned} stats={stats} words={vocab} vocab={vocab} />
        <ActivitySidePanel earned={earned} user={user} words={vocab} />
      </section>

      <section className="card overflow-hidden">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[24px] bg-[var(--surface-2)] p-5">
            <h2 className="text-xl font-black tracking-tight text-[var(--text-1)]">{ui("Profile settings")}</h2>
            <p className="mt-1 text-sm font-semibold text-[var(--text-3)]">{ui("Account details, learning preferences, and external word tracking.")}</p>
            <div className="mt-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--accent)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                {isEditingName ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                      onChange={(event) => setNewName(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && saveName()}
                      type="text"
                      value={newName}
                    />
                    <button className="accent-btn h-10 w-10" onClick={saveName} type="button">
                      <Check className="mx-auto h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-[var(--text-1)]">{user.name}</p>
                      <p className="truncate text-xs font-semibold text-[var(--text-3)]">{user.email}</p>
                    </div>
                    <button
                      aria-label={ui("Edit profile name")}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--accent)]"
                      onClick={() => setIsEditingName(true)}
                      type="button"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] bg-[var(--surface-2)] p-5">
            <LearningModePicker value={learningMode} onChange={updateLearningMode} />
            <FlashcardModePicker
              face={flashcardFace}
              mode={flashcardMode}
              onFaceChange={(next) => { setFlashcardFaceState(next); setFlashcardFace(next); }}
              onModeChange={(next) => { setFlashcardModeState(next); setFlashcardMode(next); }}
            />

            {/* Two questions, two answers. Which language you are learning, and
                which language the app is written in. Deriving the second from the
                first meant a German speaker learning English could not have an
                English app, and an English speaker learning German could not have
                a German one -- both of which people actually wanted. */}
            <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
              <p className="text-sm font-black text-[var(--text-1)]">{ui("Languages")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                {ui("Which language the app itself is written in. Pick what you are LEARNING from the course card on the home page.")}
              </p>
<label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-[var(--text-3)]">
                {ui("App language")}
              </label>
              <AppLanguagePicker
                autoLabel={direction === "learn-en" ? "Deutsch" : ui("English")}
                onChange={updateInterfaceLanguage}
                value={interfaceLanguage}
              />
            </div>
            <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-[var(--text-1)]">{ui("English spelling and accent")}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                    {uiFmt("Auto uses your browser/keyboard language. Current: {variant}.", {
                      variant: ui(englishVariantLabel(resolvedEnglishVariant)),
                    })}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-black text-[var(--text-2)]">
                  {direction === "learn-en" ? "Deutsch" : resolvedEnglishVariant === "british" ? "practise" : "practice"}
                </span>
              </div>
              <select
                className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                onChange={(event) => updateLanguageSelection(event.target.value)}
                value={LANGUAGE_SELECT_VALUE}
              >
                <option value="auto">{ui("Auto-detect")} ({ui(englishVariantLabel(detectEnglishVariant()))})</option>
                <option value="british">{ui("British English")}</option>
                <option value="american">{ui("American English")}</option>
                              </select>
            </div>

            <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
              <SpeechSpeedControl
                description={ui("Set both voices together or tune English and German separately. Changes also apply to lessons, games, and the companion.")}
                testId="language-speech-speed"
              />
            </div>

            <div className="mt-5 rounded-[18px] bg-[var(--surface)] p-4">
              <p className="text-sm font-black text-[var(--text-1)]">{ui("External word count")}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-3)]">
                {ui("Add words learned elsewhere so the app can show a more honest vocabulary total.")}
              </p>
              <input
                className="mt-3 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-bold text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                min="0"
                onChange={(event) => {
                  const valueString = event.target.value;
                  setExternalInput(valueString);
                  onUpdateStats?.({ externalWords: parseInt(valueString, 10) || 0 });
                }}
                placeholder="0"
                type="number"
                value={externalInput}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard color="bg-[var(--accent)]" icon={BarChart3} label={ui("Total XP")} value={uiNumber(stats.totalXp)} />
        <StatCard color="bg-[var(--mint)]" icon={BookOpen} label={ui("Lessons done")} value={uiNumber(stats.sessionsCompleted)} />
        <StatCard color="bg-[var(--orange)]" icon={Flame} label={ui("Day streak")} value={uiNumber(stats.streak)} />
        <StatCard color="bg-[var(--ink)]" icon={Target} label={ui("Words tracked")} value={uiNumber(vocab)} />
      </section>

      {/* Collapsed by default. Milestones are a nice-to-have, not something
          you come to this page to read, and at full width they pushed the
          things you DO come for off the bottom of the screen. */}
      <SettingsCategory
        description={`${earned} ${ui("of")} ${MILESTONES.length} ${ui("reached")}`}
        icon={Trophy}
        title={ui("Milestones")}
      >
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MILESTONES.map((item) => {
            const ok = item.check(stats);
            return (
              <div
                className={[
                  "rounded-[18px] border p-4",
                  ok ? "border-[var(--border)] bg-[var(--surface-2)]" : "border-[var(--border)] bg-[var(--surface)] opacity-55",
                ].join(" ")}
                key={item.id}
              >
                <div className="flex items-center gap-2">
                  <div className={ok ? "flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mint)] text-white" : "flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-3)] text-[var(--text-3)]"}>
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-black text-[var(--text-1)]">{ui(item.label)}</p>
                </div>
                <p className="mt-3 text-xs font-semibold leading-5 text-[var(--text-3)]">{ui(item.desc)}</p>
              </div>
            );
          })}
        </div>
      </SettingsCategory>
      {/* Rendered last and portalled to the body: the picker has to sit above
          the settings panel it was started from, and outline anything the
          pointer reaches — including the screens behind this one. */}
      {inspecting && (
        <ColourInspector
          onCancel={() => setInspecting(false)}
          onPick={(part, currentHex) => {
            setCustomColour(part.token, currentHex ?? "#888888");
            setPaintedParts(getCustomColours());
          }}
        />
      )}
    </div>
  );
}
