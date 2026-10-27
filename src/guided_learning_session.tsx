import React, { lazy, Suspense, useEffect, useState } from "react";

import { PlacementTest } from "@/components/PlacementTest";
import GuidedSession from "@/GuidedSession";
import { buildApiPartFromResolved } from "@/lib/api";
import { orderParts } from "@/lib/curriculum";
import { getSittingLevelFilters, getSittingPlan, passesSittingLevel, similarMates, sittingComparator } from "@/lib/sittingOrder";
import { buildExchangeIndex, exchangeChain, exchangeKey, exchangePlace } from "@/lib/exchanges";
import { buildBundledParts, buildTatoebaParts, filterPartsForLearningDirection } from "@/lib/contentBank";
import { buildCustomParts, isCustomPartKey, CUSTOM_CONTENT_EVENT } from "@/lib/customContent";
import { allPartBlueprints } from "@/lib/data";
import { getAuthUser, getScopedKey, loadScopedJson, saveScopedJson } from "@/lib/profileStorage";
import { Blueprint, Part } from "@/lib/types";
import { sentenceIdentityKey } from "@/lib/germanTextMatch";
import { replacePhraseSteps, secondShowingOf } from "@/lib/secondShowing";
import { buildCatalog, buildSession, deriveImplicitChains, dialogueIsEarned, isReinforcementEligible, lessonMixForBacklog, orderWithChains, pickPreviewReplacement, rankReinforcementCandidates, resolveChainScores, selectContinueLearningMix } from "@/session";
import { getLessonContent } from "@/lib/lessonContent";
import { buildWordCatalog, buildWordSitting, rankWordCatalog } from "@/lib/wordSession";
import { isDueForReview, isSnoozed, snoozeForDays, recordReinforcement, recordSameDayCheck, recordSameDayMiss, recordSuccess, recordStruggle, recordDeclaredKnown, recordPermanent, setStrengthLevel, type GradeRecord } from "@/lib/memoryStrength";
import { DIRECTION_CHANGE_EVENT, getLearningDirection, targetIsGerman } from "@/lib/direction";
import { translationLanguagesNeeded } from "@/lib/courseLanguages";
import { ensureTranslations } from "@/lib/translations";
import { frenchFor, frenchMeaningLanguage } from "@/lib/frenchCourse";
import { polishFor, polishMeaningLanguage } from "@/lib/polishCourse";
import { portugueseFor, portugueseMeaningLanguage } from "@/lib/portugueseCourse";
import { greekFor, greekMeaningLanguage } from "@/lib/greekCourse";
import { albanianFor, albanianMeaningLanguage } from "@/lib/albanianCourse";
import { spanishFor, spanishMeaningLanguage } from "@/lib/spanishCourse";
import { italianFor, italianMeaningLanguage } from "@/lib/italianCourse";
import {
  detectRegister, pickRegisterQuestion, recordRegisterAnswer,
  type Register, type RegisterState,
} from "@/lib/registerCheck";
import { computeAbility, itemDifficulty, itemPriority } from "@/lib/ability";
import { withoutMutedPacks } from "@/lib/mutedPacks";
import { getDeprioritizedPacks } from "@/lib/packInterest";
import { buildCorpusIndex, sentenceCommonality } from "@/lib/corpusFrequency";
import { conversationPriorityScore, nextFastTrackPart } from "@/lib/conversationPriority";

/** Fresh sentences per lesson — matches NEW_PER_LESSON inside buildSession. */
/**
 * How far behind the lead a pack-mate may be and still take a fresh slot.
 *
 * On the priority scale a band is 10,000,000 and vocabulary difficulty
 * contributes up to 5,000,000, so this is roughly a quarter of the difficulty
 * range — close enough to feel like the same lesson, far from enough to reach
 * the back of a pack.
 */
const PACK_MATE_SCORE_MARGIN = 1_200_000;

const NEW_PER_LESSON_TARGET = 3;
import { loadGradeStore, progressEntryForId, saveGradeStore, setCanonicalGradeRecord, statusForId } from "@/lib/activity";
import { getStreak, recordStreakDay } from "@/lib/streak";
import { useCodexPets } from "@/components/codexPets/CodexPetProvider";
import { useCodexPetCoaching } from "@/components/codexPets/useCodexPetCoaching";
import { ui } from "@/lib/i18n";
import { getCodexPetCadence } from "@/lib/codexPetCoaching";
import { getPrioritizedPetRecallItem } from "@/lib/petRecall";
import { finishLessonAndQueueNext } from "@/lib/lessonFlow";
import { stepsForLearningDirection } from "@/lib/learningDirectionStep";
import { useLearningMode } from "@/lib/learningMode";
import { countKnownVocab } from "@/lib/fluency";
import { ActiveStudyTimer, recordCompletedLearningSession } from "@/lib/learningTime";
import {
  adaptiveRepeatPriority,
  isAdaptiveReinforcementEligible,
  isAttemptedPracticeEligible,
  lastRunHadSpellingSlip,
  missedTwiceRunning,
  recordAnswerPerformance,
  type AnswerPerformance,
} from "@/lib/adaptivePractice";

type ProgressStats = {
  totalXp: number; sessionsCompleted: number;
  totalReviews: number; streak: number; externalWords: number;
};

const REGISTER_KEY = "register-checks";

/**
 * Slip one Sie-or-du situation question into a lesson, just before the finish
 * screen — but only when the lesson actually taught a sentence that commits to
 * a register, and only when a question is due. Typing a sentence right proves
 * nothing about knowing who to say it to.
 *
 * Skipped entirely whenever German is not what is being learned: the du/Sie
 * split is the thing a German speaker learning English already has, and the
 * question is read off the German sentence, which a French card no longer
 * carries — detectRegister() on "Tu viens ?" answers about the wrong language.
 */
/**
 * The Listen player, on the lesson screen.
 *
 * ListenView draws either the full Listen screen or, when it is not the
 * active view, a small draggable player — and nothing at all unless a
 * session is live. So the whole of what is wanted here is the same component
 * told it is not active.
 *
 * Lazy for the same reason it is lazy on the main screen: a learner who
 * never opens Listen should not pay for it, and least of all on the screen
 * they came here to use.
 */
const ListenView = lazy(() => import("@/components/listen/ListenView").then((m) => ({ default: m.ListenView })));

function BackgroundListen({ apiParts, learningDirection, profile }: {
  apiParts: Record<string, any>;
  learningDirection: any;
  profile: any;
}) {
  return (
    <ListenView
      active={false}
      apiParts={apiParts}
      learningDirection={learningDirection}
      onOpen={() => {
        // Tapping the player opens Listen properly, which means leaving the
        // lesson the way the Back button does rather than stacking one
        // full-screen surface on top of another.
        const url = new URL(window.location.href);
        url.searchParams.delete("guided");
        url.searchParams.set("tab", "listen");
        window.location.assign(url.toString());
      }}
      profile={profile}
    />
  );
}

function withRegisterCheck(steps: any[], user: any): any[] {
  if (!targetIsGerman()) return steps;
  const registers = Array.from(
    new Set(
      steps
        .filter((s) => s?.type === "sentence" && s.item?.de)
        .map((s) => detectRegister(s.item.de))
        .filter(Boolean) as Register[]
    )
  );
  const state = (loadScopedJson<RegisterState>(REGISTER_KEY, {}, user) as RegisterState) ?? {};
  const question = pickRegisterQuestion(registers, state);
  if (!question) return steps;

  const completeAt = steps.findIndex((s) => s?.type === "complete");
  const at = completeAt === -1 ? steps.length : completeAt;
  return [...steps.slice(0, at), { type: "register", question }, ...steps.slice(at)];
}

export default function GuidedLearningSession() {
  const user = getAuthUser()!;
  const guidedRequest = new URLSearchParams(window.location.search).get("guided");
  const {
    history: petHistory,
    selectedKey: selectedPetKey,
    selectedPet,
    speak: petSpeak,
    speech: petSpeech,
  } = useCodexPets();
  const { frequencies: petCoachingFrequencies } = useCodexPetCoaching();
  const [activePart, setActivePart] = useState(
    () => loadScopedJson<string>("active-part", "part1", user) || "part1"
  );
  const [showPlacementTest, setShowPlacementTest] = useState<boolean>(
    () => loadScopedJson("german-lab-placement-done", false, user) === false
  );
  const [showGuidedSession, setShowGuidedSession] = useState(false);
  const [sessionSteps, setSessionSteps] = useState<any[]>([]);
  const sessionStartRef = React.useRef<number | null>(null);
  const guidedAutoStartedRef = React.useRef(false);
  const startSessionRef = React.useRef<(partId?: string) => void>(() => {});
  // The part the current sitting was asked for (undefined = Continue
  // learning), so the sitting can be rebuilt the same way when the learner
  // changes how it is put together.
  const lastRequestedPartRef = React.useRef<string | undefined>(undefined);
  const activeStudyTimerRef = React.useRef<ActiveStudyTimer | null>(null);
  const sessionKnownBeforeRef = React.useRef<number | null>(null);
  const sessionLessonIdRef = React.useRef<string | undefined>(undefined);
  const [apiParts, setApiParts] = useState<Record<string, Part>>({});
  /**
   * Translation tables fetched, out of the number this course needs.
   *
   * The only part of preparing a lesson that can be measured. Everything
   * after it — assembling the packs, ordering them, building the sitting —
   * is synchronous and holds the thread, so nothing can animate during it,
   * and a German course taught in English fetches no tables at all. Where
   * there is nothing to count the screen shows no bar, rather than one
   * pulsing in place to look busy.
   */
  const [tablesLoaded, setTablesLoaded] = useState({ done: 0, total: 0 });
  const learningMode = useLearningMode();
  const [progressStats, setProgressStats] = useState<ProgressStats>(() => ({
    totalXp:           loadScopedJson("totalXp", 0, user) as number,
    sessionsCompleted: loadScopedJson("sessionsCompleted", 0, user) as number,
    totalReviews:      loadScopedJson("totalReviews", 0, user) as number,
    streak:            getStreak(user),
    externalWords:     loadScopedJson("externalWords", user.externalWordsLearned ?? 0, user) as number,
  }));
  // Scans every phrase in the course, so it is built once per pack list rather
  // than on every Continue learning press.
  const corpusIndex = React.useMemo(() => buildCorpusIndex(apiParts as any), [apiParts]);
  const catalog = React.useMemo(() => buildCatalog(apiParts), [apiParts, learningMode]);
  const [gradeRevision, setGradeRevision] = useState(0);
  const petSpeechRef = React.useRef(petSpeech);
  const petHistoryRef = React.useRef(petHistory);
  const petQuizIndex = React.useRef(0);
  // Flips between production ("say it in German") and recognition ("what does
  // this mean?") so recall practice covers both directions.
  const petQuizReverse = React.useRef(false);
  const petQuizItemsRef = React.useRef<ReturnType<typeof buildCatalog>>([]);
  petSpeechRef.current = petSpeech;
  petHistoryRef.current = petHistory;

  useEffect(() => () => {
    activeStudyTimerRef.current?.dispose();
    activeStudyTimerRef.current = null;
  }, []);

  const petQuizItems = React.useMemo(
    () => {
      const grades = loadGradeStore(user);
      const eligible = catalog.filter((item) => {
        const de = item.de?.trim() ?? "";
        const en = item.en?.trim() ?? "";
        return de.length >= 2 && en.length >= 2 && de.length <= 64 && en.length <= 64;
      });
      const recordFor = (item: (typeof eligible)[number]) => {
        // A loop rather than map().find(): this runs per item in a list of
        // thousands, and map allocates an array every time it is called.
        for (const id of [item.id, ...(item.aliases ?? [])]) {
          const record = grades[id];
          if (record) return record;
        }
        return undefined;
      };

      // The mascot is a memory coach, not a source of surprise curriculum:
      // revisit only material the learner has already encountered.
      //
      // Priority and date are worked out ONCE PER ITEM. The comparator used to
      // call recordFor up to four times per comparison, and this whole list is
      // rebuilt after every graded item in a lesson.
      const keyed = eligible
        .filter((item) => statusForId(grades, item.id, item.aliases) !== "new")
        // Putting something off means putting it off everywhere, not just
        // in lessons -- being quizzed on it by the pet is the same thing.
        .filter((item) => !isSnoozed(recordFor(item)))
        .map((item) => {
          const record = recordFor(item);
          return {
            item,
            priority: record?.lastGrade === "struggle" ? 0 : isDueForReview(record) ? 1 : 2,
            conversationPriority: conversationPriorityScore({
              partKey: item.partKey,
              kind: item.kind,
              commonality: sentenceCommonality(item.de, corpusIndex),
              lessonPriority: item.lessonPriority,
            }),
            updatedAt: Date.parse(record?.updatedAt ?? "") || 0,
          };
        });
      keyed.sort((a, b) =>
        a.priority - b.priority
        || a.conversationPriority - b.conversationPriority
        || a.updatedAt - b.updatedAt
      );
      return keyed.slice(0, 1200).map((entry) => entry.item);
    },
    [catalog, corpusIndex, gradeRevision, user]
  );
  petQuizItemsRef.current = petQuizItems;
  const petQuizAvailable = petQuizItems.length > 0;

  /**
   * How much of the course has never been seen.
   *
   * The lesson header could say where you were inside the sitting and nowhere
   * could say where the sitting was inside the course, so there was no answer
   * to the only question that makes a long course feel finite: how many more
   * of these. A percentage would not answer it either — the honest unit is
   * phrases you have not met, because that is what a sitting consumes.
   *
   * "Seen" means the tracker holds anything at all for it. A phrase you got
   * wrong is still a phrase you have met, and it comes back through review
   * rather than through this count; counting it as unseen would mean the
   * number went up when a lesson went badly.
   *
   * Recomputed when a grade lands, so finishing a sitting moves it.
   */
  const unseenPhrases = React.useMemo(
    () => {
      const grades = loadGradeStore(user);
      return catalog.reduce(
        (total, item) => total + (statusForId(grades, item.id, item.aliases) === "new" ? 1 : 0),
        0
      );
    },
    [catalog, gradeRevision, user]
  );
  const petEnabled = Boolean(selectedPet && selectedPetKey !== "off");

  useEffect(() => {
    const scopedGradeKey = getScopedKey(COMPLETED_KEY, user);
    const refreshGrades = () => setGradeRevision((revision) => revision + 1);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === scopedGradeKey) refreshGrades();
    };
    window.addEventListener("grades-updated", refreshGrades);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("grades-updated", refreshGrades);
      window.removeEventListener("storage", handleStorage);
    };
  }, [user]);

  useEffect(() => {
    const cadence = getCodexPetCadence("questions", petCoachingFrequencies.questions);
    if (!petEnabled || showPlacementTest || !petQuizAvailable || !cadence) {
      return undefined;
    }

    let questionTimer: number | undefined;
    let active = true;
    const direction = getLearningDirection();
    const learnsEnglish = direction === "learn-en";
    const learnsFrench = direction === "learn-fr";
    const learnsPolish = direction === "learn-pl";
    const learnsSpanish = direction === "learn-es";
    const learnsItalian = direction === "learn-it";
    const learnsPortuguese = direction === "learn-pt";
    const learnsGreek = direction === "learn-el";
    const learnsAlbanian = direction === "learn-sq";
    // The catalogue is German either way round, so a table-backed course has to
    // ask for its own text rather than for whichever column happens to be there.
    const meaningIsGerman = learnsEnglish
      || (learnsFrench && frenchMeaningLanguage() === "de")
      || (learnsPolish && polishMeaningLanguage() === "de")
      || (learnsSpanish && spanishMeaningLanguage() === "de")
      || (learnsItalian && italianMeaningLanguage() === "de")
      || (learnsPortuguese && portugueseMeaningLanguage() === "de")
      || (learnsGreek && greekMeaningLanguage() === "de")
      || (learnsAlbanian && albanianMeaningLanguage() === "de");

    const scheduleQuestion = (delayMs: number) => {
      if (!active) return;
      questionTimer = window.setTimeout(askQuestion, delayMs);
    };

    const askQuestion = () => {
      if (!active) return;
      if (petSpeechRef.current) {
        scheduleQuestion(15000);
        return;
      }

      const quizItems = petQuizItemsRef.current;
      if (quizItems.length === 0) {
        scheduleQuestion(cadence.intervalMs);
        return;
      }

      const recentlyAsked = new Set(
        petHistoryRef.current
          .filter((message) =>
            message.question?.itemId
            && Date.now() - message.createdAt < 30 * 60 * 1000
          )
          .map((message) => message.question!.itemId)
      );
      // A recent miss deliberately overrides the ordinary 30-minute duplicate
      // guard. It is asked on roughly three out of four opportunities and is
      // guaranteed after at most two different questions. Once remembered, it
      // returns in lighter reinforcement checks before leaving the focus queue.
      let item = getPrioritizedPetRecallItem(quizItems, recentlyAsked, user);
      if (!item) {
        for (let offset = 0; offset < quizItems.length; offset += 1) {
          const index = (petQuizIndex.current + offset) % quizItems.length;
          const candidate = quizItems[index];
          if (!recentlyAsked.has(candidate.id)) {
            item = candidate;
            petQuizIndex.current = index + 1;
            break;
          }
        }
      }
      if (!item) {
        scheduleQuestion(cadence.intervalMs);
        return;
      }

      // Alternate the direction: production ("how do you say X?") and
      // recognition ("what does X mean?") train different recall paths, and
      // seeing only one gets stale. Deterministic alternation, no coin flips.
      const reverse = petQuizReverse.current;
      petQuizReverse.current = !petQuizReverse.current;
      const french = learnsFrench ? frenchFor(item.de, item.fr) : null;
      const polish = learnsPolish ? polishFor(item.de) : null;
      const spanish = learnsSpanish ? spanishFor(item.de) : null;
      const italian = learnsItalian ? italianFor(item.de) : null;
      const portuguese = learnsPortuguese ? portugueseFor(item.de) : null;
      const greek = learnsGreek ? greekFor(item.de) : null;
      const albanian = learnsAlbanian ? albanianFor(item.de) : null;
      // A word the tables do not reach cannot be asked about in this course.
      if ((learnsFrench && !french) || (learnsPolish && !polish) || (learnsSpanish && !spanish) || (learnsItalian && !italian) || (learnsPortuguese && !portuguese) || (learnsGreek && !greek) || (learnsAlbanian && !albanian)) {
        scheduleQuestion(cadence.intervalMs);
        return;
      }
      const meaning = meaningIsGerman ? item.de : item.en;
      const target = learnsFrench ? french!
        : learnsPolish ? polish!
        : learnsSpanish ? spanish!
        : learnsItalian ? italian!
        : learnsPortuguese ? portuguese!
        : learnsGreek ? greek!
        : learnsAlbanian ? albanian!
        : learnsEnglish ? item.en
        : item.de;
      const askedLanguageDe = learnsFrench ? "Französisch"
        : learnsPolish ? "Polnisch"
        : learnsSpanish ? "Spanisch"
        : learnsItalian ? "Italienisch"
        : learnsPortuguese ? "Portugiesisch"
        : learnsGreek ? "Griechisch"
        : learnsAlbanian ? "Albanisch"
        : "Englisch";
      const askedLanguageEn = learnsFrench ? "French"
        : learnsPolish ? "Polish"
        : learnsSpanish ? "Spanish"
        : learnsItalian ? "Italian"
        : learnsPortuguese ? "Portuguese"
        : learnsGreek ? "Greek"
        : learnsAlbanian ? "Albanian"
        : "German";
      const question = meaningIsGerman
        ? (reverse
            ? `Weißt du noch, was „${target}“ bedeutet?`
            : `Erinnerst du dich, wie man „${meaning}“ auf ${askedLanguageDe} sagt?`)
        : (reverse
            ? `Do you remember what “${target}” means?`
            : `Do you remember how to say “${meaning}” in ${askedLanguageEn}?`);
      const answerLanguage = reverse
        ? (meaningIsGerman ? "de" : "en")
        : (learnsFrench ? "fr"
          : learnsPolish ? "pl"
          : learnsSpanish ? "es"
          : learnsPortuguese ? "pt"
          : learnsGreek ? "el"
          : learnsAlbanian ? "sq"
          : learnsEnglish ? "en"
          : "de");
      petSpeak(question, {
        durationMs: 20000,
        mood: "greeting",
        voiceLang: meaningIsGerman ? "de-DE" : "en-US",
        question: {
          aliases: item.aliases,
          answerLanguage,
          de: item.de,
          en: item.en,
          fr: french ?? undefined,
          pl: polish ?? undefined,
          es: spanish ?? undefined,
          pt: portuguese ?? undefined,
          el: greek ?? undefined,
          sq: albanian ?? undefined,
          itemId: item.id,
        },
      });
      scheduleQuestion(cadence.intervalMs);
    };

    scheduleQuestion(cadence.initialDelayMs);
    return () => {
      active = false;
      if (questionTimer) window.clearTimeout(questionTimer);
    };
  }, [
    petCoachingFrequencies.questions,
    petEnabled,
    petQuizAvailable,
    petSpeak,
    showPlacementTest,
    user,
  ]);

  useEffect(() => {
    // Reliability floor: blueprint lessons + bundled curated phrasebank +
    // bundled Tatoeba sentence library + the bundled frequency word bank
    // (2,500 most-common German words with EN/FR translations). All of this is
    // shipped with the app, so it works every time, fully offline, no flaky
    // remote fetches (the old remote sources were CORS-blocked or cold-started
    // and gave inconsistent counts).
    const resolved: Record<string, Part> = {};
    for (const [k, bp] of Object.entries(allPartBlueprints))
      resolved[k] = buildApiPartFromResolved(bp as Blueprint, {});
    // Hand-written packs only, served in hard-coded curriculum order (see
    // lib/curriculum.ts): everyday core first, niche/casual last. The old
    // auto-generated word-bank carrier parts are gone — every lesson
    // sentence is predefined by hand.
    // Tatoeba packs are the FINAL tier: real native-written sentences as
    // extra practice, unlocked only after the curated curriculum, each item
    // labelled ("Extra real-world practice").
    // The learner's own words go in last so they are packs like any other:
    // lessons, tracker, search and tests all read this one map, so nothing
    // downstream needs to know where a phrase came from.
    // The translation tables are fetched rather than bundled, so that
    // German-only learners never download them. Built before one lands, a
    // French or Polish catalogue silently comes out short: an entry the table
    // does not cover is dropped, not shown in German. The app's own language
    // counts as well as the course's — Listen explains a card in it, out of
    // the same tables.
    const rebuild = async () => {
      const needed = translationLanguagesNeeded();
      setTablesLoaded({ done: 0, total: needed.length });
      await Promise.all(needed.map((language) => ensureTranslations(language).then((result) => {
        setTablesLoaded((current) => ({ ...current, done: current.done + 1 }));
        return result;
      })));
      setApiParts(orderParts(filterPartsForLearningDirection({
        ...resolved,
        ...buildBundledParts(),
        ...buildTatoebaParts(),
        ...buildCustomParts(),
      })));
    };
    const onRebuild = () => { void rebuild(); };
    onRebuild();
    window.addEventListener(CUSTOM_CONTENT_EVENT, onRebuild);
    window.addEventListener(DIRECTION_CHANGE_EVENT, onRebuild);
    // Changing the app's language changes which table is needed, not just
    // which words are on the buttons.
    window.addEventListener("gl-interface-language-change", onRebuild);
    return () => {
      window.removeEventListener(CUSTOM_CONTENT_EVENT, onRebuild);
      window.removeEventListener(DIRECTION_CHANGE_EVENT, onRebuild);
      window.removeEventListener("gl-interface-language-change", onRebuild);
    };
  }, []);

  useEffect(() => {
    if (Object.keys(apiParts).length > 0 && !apiParts[activePart]) {
      const firstValid = Object.keys(apiParts)[0];
      if (firstValid) {
        setActivePart(firstValid);
        saveScopedJson("active-part", firstValid, user);
      }
    }
  }, [apiParts, activePart, user]);

  const updateStats = (next: Partial<ProgressStats>) => {
    const merged = { ...progressStats, ...next };
    setProgressStats(merged);
    Object.entries(merged).forEach(([k, v]) => saveScopedJson(k, v, user));
  };

  const COMPLETED_KEY = "session-completed";

  const loadCompleted = (): Record<string, GradeRecord> => {
    try {
      const raw = loadScopedJson<any>(COMPLETED_KEY, {}, user) ?? {};
      if (Array.isArray(raw)) return Object.fromEntries(raw.map((id: string) => [id, { lastGrade: "know" }]));
      return raw && typeof raw === "object" ? raw : {};
    } catch { return {}; }
  };

  const saveReviewGrades = (grades: Record<string, GradeRecord>) => {
    // Besides persistence, this emits grades-updated so the proactive pet's
    // review pool sees newly encountered items without waiting for a reload.
    saveGradeStore(grades, user);
  };

  // Manual changes made from a guided lesson are deliberately reversible. Keep
  // the exact previous record in memory for this session, rather than trying to
  // guess a prior review rung after the write has happened.
  const manualGradeUndoRef = React.useRef(new Map<string, GradeRecord | null>());

  const rememberGradeBeforeChange = (store: Record<string, GradeRecord>, itemId: string) => {
    const prior = progressEntryForId(store, itemId)?.record;
    manualGradeUndoRef.current.set(itemId, prior ? { ...prior } : null);
    return prior;
  };

  // Explicit skip button ("Know it") — a declaration of prior knowledge, not
  // a drill result, so it jumps most of the way up the ladder rather than
  // climbing one rung like an earned recall does. See recordDeclaredKnown.
  const markGrade = (itemId: string, grade: "know" | "struggle") => {
    try {
      const existing = loadCompleted();
      const prior = rememberGradeBeforeChange(existing, itemId);
      saveReviewGrades({
        ...existing,
        [itemId]: grade === "know"
          ? recordDeclaredKnown(prior)
          : recordStruggle(Date.now(), prior),
      });
    } catch {}
  };

  const setGuidedStrength = (itemId: string, level: number) => {
    try {
      const existing = loadCompleted();
      const prior = rememberGradeBeforeChange(existing, itemId);
      const next = setStrengthLevel(level, Date.now(), prior);
      if (next) existing[itemId] = next;
      else delete existing[itemId];
      saveReviewGrades(existing);
    } catch {}
  };

  const snoozeGuidedItem = (itemId: string, days: number) => {
    try {
      const existing = loadCompleted();
      const prior = rememberGradeBeforeChange(existing, itemId);
      existing[itemId] = snoozeForDays(days, Date.now(), prior);
      saveReviewGrades(existing);
    } catch {}
  };

  const setGuidedPermanent = (itemId: string) => {
    try {
      const existing = loadCompleted();
      const prior = rememberGradeBeforeChange(existing, itemId);
      existing[itemId] = recordPermanent(Date.now(), prior);
      saveReviewGrades(existing);
    } catch {}
  };

  const undoGuidedGrade = (itemId: string) => {
    if (!manualGradeUndoRef.current.has(itemId)) return false;
    try {
      const existing = loadCompleted();
      const prior = manualGradeUndoRef.current.get(itemId);
      if (prior) existing[itemId] = prior;
      else delete existing[itemId];
      saveReviewGrades(existing);
      manualGradeUndoRef.current.delete(itemId);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Hand a slot back and pull in a phrase you have not met.
   *
   * Split out from the grading so setting a level in the preview can reuse it:
   * choosing 'Mastered' must keep the level that was chosen, not overwrite it
   * with 'know' on the way past.
   */
  const swapPreviewItem = (itemId: string) => {
    setSessionSteps((current) => {
      const replaceAt = current.findIndex(
        (step) => step?.type === "sentence" && step.item?.id === itemId
      );
      if (replaceAt < 0) return current;

      const usedIds = new Set(
        current
          .filter((step) => step?.type === "sentence" && step.item?.id)
          .map((step) => String(step.item.id))
      );
      // Session steps may already be direction-swapped. Convert them back to
      // named language pairs and block both columns: Quick Match can be flipped
      // after the replacement is made. The candidates below are un-swapped
      // German entries, so a French card has to be read back through the
      // German it was built from — blocking on the French would match nothing
      // and let the same sentence appear twice.
      const swapDirection = getLearningDirection();
      const blockedPairs = current
        .filter((step, index) => index !== replaceAt && step?.type === "sentence")
        .map((step) => {
          if (swapDirection === "learn-en") {
            return { de: String(step.item?.en ?? ""), en: String(step.item?.de ?? "") };
          }
          if (swapDirection === "learn-fr" || swapDirection === "learn-pl" || swapDirection === "learn-es" || swapDirection === "learn-it" || swapDirection === "learn-pt" || swapDirection === "learn-ru" || swapDirection === "learn-el" || swapDirection === "learn-sq") {
            return { de: String(step.item?.originalDe ?? ""), en: String(step.item?.en ?? "") };
          }
          return { de: String(step.item?.de ?? ""), en: String(step.item?.en ?? "") };
        });
      const grades = loadGradeStore(user);
      // A word card is replaced by a WORD, a sentence card by a sentence.
      // The pool used to be the sentence catalogue unconditionally, so
      // mastering a word on the vocabulary flashcards handed back a sentence
      // — mid-preview, in a sitting the learner chose precisely because it
      // has no sentences in it.
      const outgoing = current[replaceAt];
      const swappingWord = outgoing?.item?.kind === "word";
      const candidates = swappingWord
        ? rankWordCatalog(buildWordCatalog(withoutMutedPacks(apiParts)), corpusIndex).filter((word) => {
            if (usedIds.has(word.id)) return false;
            const record = progressEntryForId(grades, word.id, word.aliases)?.record;
            return statusForId(grades, word.id, word.aliases) === "new" && !isSnoozed(record);
          })
        : catalog.filter((item) => {
            if (usedIds.has(item.id) || statusForId(grades, item.id, item.aliases) !== "new") return false;
            const record = progressEntryForId(grades, item.id, item.aliases)?.record;
            // The put-off floor applies here too: this is the pool a snoozed
            // card would sneak back through otherwise.
            if (isSnoozed(record)) return false;
            return !isAttemptedPracticeEligible(record);
          });
      // Pressing "Know it" on a base is a request for more of it, not a
      // request for something unrelated. If the card being replaced has an
      // extension waiting — "Passt das?" → "Passt das für dich?" — that
      // extension takes the freed slot before the general ranking gets a say.
      // The same prefix rule the lesson builder uses decides what counts,
      // applied to throwaway rows so the shared catalogue is never mutated.
      const outgoingItem = outgoing?.item;
      const chainKeyOf = (text: unknown) =>
        sentenceIdentityKey(String(text ?? "")).toLowerCase().replace(/\?+$/, "").trim();
      let chainedReplacement: any = null;
      if (!swappingWord && outgoingItem) {
        const baseKeys = new Set([
          chainKeyOf(outgoingItem.de),
          chainKeyOf(outgoingItem.originalDe ?? outgoingItem.de),
        ].filter(Boolean));
        const blockedText = new Set(blockedPairs.map((pair) => chainKeyOf(pair.de)));
        const rows: Array<{ de: string; originalDe?: string; buildsOn?: string; ref: any }> = [
          {
            de: String(outgoingItem.de ?? ""),
            originalDe: outgoingItem.originalDe ? String(outgoingItem.originalDe) : undefined,
            ref: null,
          },
          ...(candidates as any[]).map((candidate) => ({
            de: String(candidate.de ?? ""),
            originalDe: candidate.originalDe ? String(candidate.originalDe) : undefined,
            buildsOn: candidate.buildsOn ? String(candidate.buildsOn) : undefined,
            ref: candidate,
          })),
        ];
        deriveImplicitChains(rows);
        chainedReplacement = rows.find((row) =>
          row.ref
          && row.buildsOn
          && baseKeys.has(chainKeyOf(row.buildsOn))
          && !blockedText.has(chainKeyOf(row.de))
        )?.ref ?? null;
      }
      const replacement = chainedReplacement ?? pickPreviewReplacement(
        candidates,
        blockedPairs,
        activePart
      );

      if (!replacement) return current;

      let replacementStep: any = swappingWord
        // The spread keeps kind: "word" — losing it would send the new card
        // down the thirteen-stage sentence route.
        ? { type: "sentence", item: { ...replacement, mastery: "new" } }
        : {
        type: "sentence",
        item: {
          id: replacement.id,
          aliases: replacement.aliases,
          de: replacement.de,
          en: replacement.en,
          fr: replacement.fr,
          lookup: replacement.lookup,
          use: replacement.use,
          short: replacement.short,
          when: replacement.when,
          say: replacement.say,
          long: replacement.long,
          group: replacement.group,
          tierNote: replacement.tierNote,
          coachingLanguage: replacement.coachingLanguage,
          // An extension arriving because its base was just marked known runs
          // the short route: those words were taught seconds ago.
          ...(chainedReplacement ? { chainedFromLesson: true } : {}),
        },
      };
      // A replacement with no French leaves the preview card as it was: a
      // blank slot is worse than the card the learner asked to swap out.
      const [directed] = stepsForLearningDirection([replacementStep]);
      if (!directed) return current;
      replacementStep = directed;

      // Every copy of it, not just the first: the return two phrases later
      // would otherwise bring back the phrase that was just swapped out.
      return replacePhraseSteps(current, itemId, replacementStep);
    });
  };

  /** "Know it" on a preview card: grade it known, then take the fresh phrase. */
  const replaceKnownPreviewItem = (itemId: string) => {
    markGrade(itemId, "know");
    swapPreviewItem(itemId);
  };

  const markCompleted = (stepsToMark: any[], performance?: AnswerPerformance) => {
    try {
      const existing = loadCompleted();
      const next = { ...existing };
      const sessionStart = sessionStartRef.current ?? Date.now();
      // One climb per item per session: rechecks and dialogue lines repeat the
      // same id in the step list, and completion is a single recall event.
      const counted = new Set<string>();
      /**
       * An optional extra rep, banked according to what it was.
       *
       * `sameDay` is a phrase learned earlier today, offered back to find out
       * whether it stuck. Recalling it cleanly is worth half a rung — real
       * evidence, but weaker than surviving a night, so two of them make what
       * one next-day recall makes on its own. Missing it clears the banked
       * credit and nothing else: this is practice the learner did not have to
       * do, and resetting the ladder for it would make skipping the safer
       * move. Tomorrow's review still arrives on time and still decides.
       */
      const markReinforced = (id: string, aliases: string[] = [], sameDay = false) => {
        if (!id || counted.has(id)) return;
        counted.add(id);
        const prior = progressEntryForId(next, id, aliases)?.record;
        if (!prior?.lastGrade) return;
        const reinforcedAt = prior.reinforcedAt ? Date.parse(prior.reinforcedAt) : 0;
        if (Number.isFinite(reinforcedAt) && reinforcedAt >= sessionStart) {
          if (performance?.attempts) {
            setCanonicalGradeRecord(next, id, aliases, recordAnswerPerformance(prior, performance));
          }
          return;
        }
        const practised = recordAnswerPerformance(prior, performance);
        if (!sameDay) {
          setCanonicalGradeRecord(next, id, aliases, recordReinforcement(practised));
          return;
        }
        // A clean run through the stages is the check passing. Any mistake on
        // the way means it had not stuck, whatever the last answer was.
        const clean = !performance || performance.mistakes === 0;
        setCanonicalGradeRecord(
          next,
          id,
          aliases,
          clean ? recordSameDayCheck(practised) : recordSameDayMiss(practised)
        );
      };
      const markKnown = (id: string, aliases: string[] = []) => {
        if (!id || counted.has(id)) return;
        counted.add(id);
        const prior = progressEntryForId(next, id, aliases)?.record;
        // Items are saved as each step is left. "Know it" also writes
        // immediately, so keep both paths from advancing the same memory
        // record more than once in one session.
        const updatedAt = prior?.updatedAt ? Date.parse(prior.updatedAt) : 0;
        if (Number.isFinite(updatedAt) && updatedAt >= sessionStart) {
          // "Know it" writes its mastery grade immediately. Still attach any
          // real stage mistakes gathered before that click; only suppress the
          // second SRS promotion.
          if (performance?.attempts) {
            setCanonicalGradeRecord(
              next,
              id,
              aliases,
              recordAnswerPerformance(prior, performance)
            );
          }
          return;
        }
        // One rung up the memory ladder; the item comes back for review when due.
        const practised = recordAnswerPerformance(prior, performance);
        setCanonicalGradeRecord(next, id, aliases, recordSuccess(practised));
      };
      stepsToMark.forEach((s) => {
        if (s.type === "sentence" && s.item?.id) {
          if (s.reinforcement) {
            markReinforced(s.item.id, s.item.aliases, s.reviewReason === "same-day");
          }
          else markKnown(s.item.id, s.item.aliases);
        } else if (s.type === "dialogue" && Array.isArray(s.dialogue?.lines)) {
          // Completing a conversation means every line was practised — persist
          // each line, otherwise the same dialogue rebuilds every session and
          // the learner loops on it instead of advancing to new content.
          s.dialogue.lines.forEach((line: any) => { if (line?.id) markKnown(line.id, line.aliases); });
        }
      });
      saveReviewGrades(next);
    } catch {}
  };

  /** Persist mistakes from a sentence the learner left via Skip, without
   * promoting it up the mastery ladder. This is still one write per sentence. */
  const markAttempted = (step: any, performance?: AnswerPerformance) => {
    if (step?.type !== "sentence" || !step.item?.id || !performance?.attempts) return;
    try {
      const next = loadCompleted();
      const aliases = step.item.aliases ?? [];
      const prior = progressEntryForId(next, step.item.id, aliases)?.record;
      setCanonicalGradeRecord(
        next,
        step.item.id,
        aliases,
        recordAnswerPerformance(prior, performance)
      );
      saveReviewGrades(next);
    } catch {}
  };

  const beginLessonTiming = (lessonId?: string) => {
    activeStudyTimerRef.current?.dispose();
    activeStudyTimerRef.current = new ActiveStudyTimer().start();
    sessionKnownBeforeRef.current = countKnownVocab(user, progressStats.externalWords);
    sessionLessonIdRef.current = lessonId;
    // Keep the epoch timestamp as well: markCompleted uses it to prevent one
    // exercise from advancing the same memory record twice in a lesson.
    sessionStartRef.current = Date.now();
  };

  /**
   * Which pack a Fast track sitting opens on.
   *
   * Resolved here rather than in conversationPriority because "still has
   * something to teach" means building the pack's session, which needs the
   * review state and the lesson engine. The list of conversational packs is
   * that file's business; whether one is finished is this one's.
   *
   * Muted packs are dropped first, for the same reason Continue learning
   * drops them: pausing a pack is an instruction, and a second button that
   * ignored it would be a way to be served the thing you asked not to see.
   */
  const fastTrackPart = (): string | null => {
    const reviewState = loadCompleted();
    const activeParts = withoutMutedPacks(apiParts);
    return nextFastTrackPart(activeParts, (packId) => {
      const pack = (activeParts as Record<string, any>)[packId];
      if (!pack) return false;
      return buildSession({ ...pack, partKey: packId }, [], reviewState, 0).length > 0;
    });
  };

  const startSession = (partId?: string) => {
    // Explicit pack picks are respected. Continue Learning passes no id and
    // gets the curriculum treatment: due reviews from ANY pack first (most
    // overdue anywhere — even a pack far down the order — so nothing learned
    // is left to rot), then the first pack in curriculum order that still
    // has fresh content. The most common German is always served first.
    const reviewState = loadCompleted();
    const explicit = partId && apiParts[partId] ? partId : null;
    // `buildSession` scans, filters, shuffles and sorts a whole pack. Continue
    // Learning consults the same packs several times while selecting struggles,
    // due reviews, fresh sentences and dialogues, so keep one result per pack
    // for this invocation only. A new call gets a new cache and fresh progress.
    const packSessions = new Map<string, any[]>();
    const sessionForPack = (packId: string) => {
      if (packSessions.has(packId)) return packSessions.get(packId)!;
      const pack = apiParts[packId];
      if (!pack) return [];
      const packSteps = buildSession(
        { ...pack, partKey: packId },
        [],
        reviewState,
        0
      );
      packSessions.set(packId, packSteps);
      return packSteps;
    };

    if (!explicit) {
      // Paused packs leave Continue Learning entirely — no fresh phrases, no
      // due reviews, no optional practice. Opening one by hand still works,
      // which is why this only guards the automatic path.
      const activeParts = withoutMutedPacks(apiParts);
      const keys = Object.keys(activeParts);

      // ── Vocabulary sitting: its own button, its own catalogue, its own ids ──
      //
      // Everything below this block is the SENTENCE course, and it never sees
      // a word: the two kinds of sitting share the exercise UI and the grade
      // ladder, never a queue or an id. A word's progress lives under vw-*,
      // which no sentence path constructs, so grading a word here cannot
      // schedule anything in an ordinary sitting — and vice versa.
      const lessonContent = getLessonContent();
      // How this sitting is put together: the course's pick unless the
      // learner chose an order, and every level unless they narrowed it.
      const sittingPlan = getSittingPlan();
      const sittingLevels = getSittingLevelFilters();
      // Conversation order needs to know what answers what: the packs'
      // dialogues, indexed by sentence. Built only when asked for.
      const exchanges = sittingPlan.grouping === "conversation" ? buildExchangeIndex(activeParts) : null;
      if (lessonContent === "words") {
        const rankedWords = rankWordCatalog(buildWordCatalog(activeParts), corpusIndex);
        let wordSteps: any[] = buildWordSitting(rankedWords, reviewState);
        if (wordSteps.length > 0) {
          wordSteps = stepsForLearningDirection(wordSteps);
          if (wordSteps.length === 0) return;
          const id = wordSteps[0]?.item?.partKey ?? keys[0] ?? activePart;
          setActivePart(id);
          saveScopedJson("active-part", id, user);
          setSessionSteps(withRegisterCheck(withSecondShowing([...wordSteps, { type: "complete" }]), user));
          beginLessonTiming(id);
          setShowGuidedSession(true);
          return;
        }
        // Every word is resting or put off: fall through to an ordinary
        // sitting rather than presenting a dead button.
      }
      const requiredReviews: any[] = [];
      const globalReviews: any[] = [];
      const reinforcementReviews: any[] = [];
      const reviewPartByStep = new Map<any, string>();

      // Every unseen SENTENCE is scored, not the pack it lives in. A pack is a
      // mixed bag — the restaurant pack holds both "Noch einen Kaffee?" and
      // "Könnten wir auch Leitungswasser bekommen?" — so ranking packs meant a
      // strong learner got a hard pack and still met its easy sentences, while
      // a hard sentence inside an easy pack was never brought forward.
      //
      // Still a RANKING over everything unseen, never a filter: items leave the
      // pool only by being learned, so the easy material is still waiting
      // however good you get. Ties keep curriculum order.
      const ability = computeAbility(reviewState as any);
      // Reviews are gathered from every pack regardless of order, so a due item
      // is never delayed by the difficulty preference. A phrase marked
      // "struggle" is a priority review, not a new phrase; it may use a legacy
      // alias in saved progress, so classify through statusForId.
      for (const pId of keys) {
        const p = activeParts[pId];
        if (!p) continue;
        const s = sessionForPack(pId);
        for (const st of s) {
          if (st.type !== "sentence" || !st.item?.id) continue;
          const status = statusForId(reviewState, st.item.id, st.item.aliases);
          if (status === "struggle") {
            // When it was marked matters. Gathering runs in pack order, so
            // without this a phrase you just failed on a late pack queues up
            // behind every older struggle and may never be reached.
            const struggledAt = Date.parse(
              progressEntryForId(reviewState as any, st.item.id, st.item.aliases)?.record?.updatedAt ?? ""
            );
            const priorityReview = {
              ...st,
              review: true,
              reviewReason: "struggle",
              interval: 0,
              struggledAt: Number.isFinite(struggledAt) ? struggledAt : 0,
              // A struggle is not always a failed spelling: it is also what
              // taking the options writes, and what marking a phrase hard
              // writes, and both of those mean the phrase is not remembered
              // rather than mistyped. A recorded slip opens the review on the
              // writing route, and so does a second miss running — the phrase
              // came back and was missed again, which is the point at which
              // writing it out earns its place. Everything else comes back on
              // the lean route, which is the meeting-it-again it asked for.
              item: (() => {
                const record = progressEntryForId(reviewState as any, st.item.id, st.item.aliases)?.record;
                return lastRunHadSpellingSlip(record) || missedTwiceRunning(record)
                  ? { ...st.item, typingFailed: true }
                  : st.item;
              })(),
            };
            requiredReviews.push(priorityReview);
            reviewPartByStep.set(priorityReview, pId);
          } else if (st.review && !st.reinforcement && st.reviewReason !== "attempted") {
            globalReviews.push(st);
            reviewPartByStep.set(st, pId);
          }
        }
      }

      // A normal successful first encounter is scheduled for tomorrow, but
      // Continue Learning should still contain a familiar half today. Pull
      // only the first two (weak) ladder rungs into optional reinforcement;
      // declared-known and permanent items stay away until their real review.
      // `reinforcedAt` rotates this pool without changing its due date.
      const reinforcementCandidates: {
        pId: string;
        index: number;
        successes: number;
        lastPractised: number;
        practiceUrgency?: number;
        repeatPriority?: number;
        step: any;
      }[] = [];
      catalog.forEach((item, index) => {
        const record = progressEntryForId(reviewState, item.id, item.aliases)?.record;
        const ordinaryReinforcement = isReinforcementEligible(record);
        const adaptiveReinforcement = isAdaptiveReinforcementEligible(record, item);
        const attemptedPractice = isAttemptedPracticeEligible(record);
        if (!ordinaryReinforcement && !adaptiveReinforcement && !attemptedPractice) return;
        const pId = item.partKey;
        // The catalogue still holds every pack, so paused ones are dropped here.
        if (!activeParts[pId]) return;
        const lastPractisedRaw = record?.reinforcedAt ?? record?.lastAnswerAt ?? record?.updatedAt;
        const parsedLastPractised = lastPractisedRaw ? Date.parse(lastPractisedRaw) : 0;
        const repeatPriority = adaptiveReinforcement || attemptedPractice
          ? adaptiveRepeatPriority(record, item)
          : 0;
        const practiceUrgency = attemptedPractice ? 2 : adaptiveReinforcement ? 1 : 0;
        reinforcementCandidates.push({
          pId,
          index,
          successes: Number(record?.successes) || 0,
          lastPractised: Number.isFinite(parsedLastPractised) ? parsedLastPractised : 0,
          practiceUrgency,
          repeatPriority,
          step: {
            type: "sentence",
            review: true,
            reviewReason: attemptedPractice ? "attempted" : adaptiveReinforcement ? "adaptive" : "reinforcement",
            optionalPractice: true,
            reinforcement: !attemptedPractice,
            repeatPriority,
            interval: Number(record?.intervalDays) || 1,
            item: {
              id: item.id,
              aliases: item.aliases,
              de: item.de,
              en: item.en,
              fr: item.fr,
              use: item.use,
              lookup: item.lookup,
              tierNote: item.tierNote,
              short: item.short,
              when: item.when,
              say: item.say,
              long: item.long,
              group: item.group,
              level: item.level,
              mastery: "learning",
            },
          },
        });
      });
      rankReinforcementCandidates(reinforcementCandidates).forEach(({ pId, step }) => {
        reinforcementReviews.push(step);
        reviewPartByStep.set(step, pId);
      });

      // Derive the unauthored chains across the WHOLE catalogue, before
      // anything else looks at them.
      //
      // They used to be derived from the unseen pool alone, which quietly
      // undid the feature the moment it worked: learn "Passt das?" today and
      // tomorrow its extension is just another sentence from a late pack,
      // because the chain that would have carried it forward only existed
      // among cards nobody had learned yet. The score-inheritance below
      // exists precisely so an extension can follow a base that is already
      // known — it just never knew about these chains. Now it does.
      //
      // Derived onto throwaway rows, never onto the shared catalogue: that
      // object is cached and read by the tracker, tests and games too.
      const derivedRows = catalog.map((item) => ({
        id: item.id,
        de: String(item.de ?? ""),
        originalDe: item.originalDe ? String(item.originalDe) : undefined,
        buildsOn: item.buildsOn ? String(item.buildsOn) : undefined,
        score: conversationPriorityScore({
          partKey: item.partKey,
          kind: item.kind,
          commonality: sentenceCommonality(String(item.de ?? ""), corpusIndex),
          lessonPriority: item.lessonPriority,
        }),
      }));
      deriveImplicitChains(derivedRows);
      const derivedBuildsOn = new Map<string, string>();
      for (const row of derivedRows) {
        if (row.buildsOn) derivedBuildsOn.set(row.id, row.buildsOn);
      }
      const buildsOnFor = (item: { id?: string; buildsOn?: string }) =>
        item?.buildsOn ?? (item?.id ? derivedBuildsOn.get(item.id) : undefined);

      // Score every unseen sentence in the course, then take the best few.
      // Chained phrases need their base's score even when the base is already
      // learned, so those are looked up first and captured during the walk.
      const chainTargetKeys = new Set<string>();
      catalog.forEach((item) => {
        const buildsOn = buildsOnFor(item);
        if (buildsOn) chainTargetKeys.add(sentenceIdentityKey(String(buildsOn)).toLowerCase());
      });
      const chainBaseScores = new Map<string, number>();
      const deprioritizedPacks = getDeprioritizedPacks();
      // level, de and commonality are what the sitting order sorts on — see
      // sittingComparator; the course's own pick is the score.
      const candidates: { pId: string; index: number; score: number; level?: string; de: string; commonality: number; step: any }[] = [];
      catalog.forEach((item, index) => {
        if (chainTargetKeys.size) {
          const keys = [
            sentenceIdentityKey(String(item.de ?? "")).toLowerCase(),
            sentenceIdentityKey(String(item.originalDe ?? item.de ?? "")).toLowerCase(),
          ].filter((key) => key && chainTargetKeys.has(key));
          if (keys.length) {
            const basePart = activeParts[item.partKey];
            if (basePart) {
              const baseText = String(item.de ?? "");
              const baseCommonality = sentenceCommonality(baseText, corpusIndex);
              const baseScore = conversationPriorityScore({
                partKey: item.partKey,
                kind: item.kind,
                commonality: baseCommonality,
                lessonPriority: item.lessonPriority,
                deprioritized: deprioritizedPacks.has(item.partKey),
              }) + itemPriority({
                ability: ability.band,
                commonality: baseCommonality,
                difficulty: itemDifficulty(basePart.level, baseText.trim().split(/\s+/).filter(Boolean).length),
                own: isCustomPartKey(item.partKey),
              }) * 100;
              for (const key of keys) {
                const prev = chainBaseScores.get(key);
                if (prev == null || baseScore < prev) chainBaseScores.set(key, baseScore);
              }
            }
          }
        }
        if (statusForId(reviewState, item.id, item.aliases) !== "new") return;
        const progressRecord = progressEntryForId(reviewState, item.id, item.aliases)?.record;
        // A phrase put off from the preview has a record but no grade, so its
        // status is still "new" and this pool would hand it straight back on
        // the next Continue Learning. Putting it off has to mean something
        // before it has ever been answered, which is exactly when it is easiest
        // to want rid of it.
        if (isSnoozed(progressRecord)) return;
        if (isAttemptedPracticeEligible(progressRecord)) return;
        const pId = item.partKey;
        const p = activeParts[pId];
        if (!p) return;
        // Fresh material only: a review is never filtered out by level.
        if (!passesSittingLevel(item.level ?? p.level, sittingLevels)) return;
        const text = String(item.de ?? "");
        const commonality = sentenceCommonality(text, corpusIndex);
        candidates.push({
          pId,
          index,
          level: item.level ?? p.level,
          de: text,
          commonality,
          score: conversationPriorityScore({
            partKey: pId,
            kind: item.kind,
            commonality,
            lessonPriority: item.lessonPriority,
            deprioritized: deprioritizedPacks.has(pId),
          }) + itemPriority({
            ability: ability.band,
            commonality,
            difficulty: itemDifficulty(p.level, text.trim().split(/\s+/).filter(Boolean).length),
            own: isCustomPartKey(pId),
          }) * 100,
          step: {
            type: "sentence",
            item: {
              id: item.id,
              aliases: item.aliases,
              de: item.de,
              en: item.en,
              fr: item.fr,
              use: item.use,
              lookup: item.lookup,
              tierNote: item.tierNote,
              short: item.short,
              when: item.when,
              say: item.say,
              long: item.long,
              group: item.group,
              level: item.level,
              buildsOn: buildsOnFor(item),
              originalDe: item.originalDe,
              mastery: "new",
            },
          },
        });
      });
      // The chains are already on the candidates: they were derived over the
      // whole catalogue above, so a base that is only learned — not queued —
      // still passes its place to what extends it.
      resolveChainScores(
        candidates.map((candidate) => {
          const proxy = {
            get score() { return candidate.score; },
            set score(value: number) { candidate.score = value; },
            de: String(candidate.step.item?.de ?? ""),
            originalDe: candidate.step.item?.originalDe ? String(candidate.step.item.originalDe) : undefined,
            buildsOn: candidate.step.item?.buildsOn ? String(candidate.step.item.buildsOn) : undefined,
          };
          return proxy;
        }),
        chainBaseScores
      );
      // The learner's ranked orders, or the course's pick. Every plan breaks
      // ties on the pick and then the curriculum, so "level first" is the
      // course's pick within a level rather than a different course.
      candidates.sort(sittingComparator(sittingPlan, candidates));

      // The lead sentence is the best-scoring one anywhere. The rest of the
      // fresh half prefers its pack-mates so the lesson still feels coherent,
      // then scans the remaining ranked pool to backfill duplicate/colliding
      // wording instead of silently returning fewer than 3 new phrases.
      // Conversation order leads with the best card that HAS a reply among
      // the fresh cards, so the sitting can be an exchange; when nothing
      // fresh answers anything, the course's pick leads as usual.
      const candidateByKey = new Map(candidates.map((candidate) => [exchangeKey(candidate.de), candidate]));
      const lead = exchanges
        ? candidates.find((candidate) => exchangeChain(candidate.de, exchanges, (key) => candidateByKey.has(key), 1).length > 0) ?? candidates[0]
        : candidates[0];
      // Anything that builds on the lead comes straight after it, before the
      // lead's own pack-mates — the chain IS the coherence the pack-mate rule
      // exists for. Followed transitively so a three-link chain stays whole.
      const chainAfterLead: typeof candidates = [];
      if (lead) {
        const keyOfText = (text: unknown) => sentenceIdentityKey(String(text ?? "")).toLowerCase();
        let linkKeys = new Set([
          keyOfText(lead.step.item?.de),
          keyOfText(lead.step.item?.originalDe ?? lead.step.item?.de),
        ]);
        for (let hops = 0; hops < 3; hops += 1) {
          const next = candidates.find((candidate) =>
            candidate !== lead
            && !chainAfterLead.includes(candidate)
            && candidate.step.item?.buildsOn
            && linkKeys.has(keyOfText(candidate.step.item.buildsOn)));
          if (!next) break;
          chainAfterLead.push(next);
          linkKeys = new Set([
            keyOfText(next.step.item?.de),
            keyOfText(next.step.item?.originalDe ?? next.step.item?.de),
          ]);
        }
      }
      const inChain = new Set(chainAfterLead);
      // A chained phrase whose base lives in ANOTHER pack inherits its base's
      // rank, but the pack-mates reorder below would bury it behind every
      // unseen phrase of the lead's pack — for a chain onto part1 that is a
      // dozen lessons of waiting. Any chained candidate that has earned a
      // top-slot rank on pure score keeps it.
      const pinnedChains = lead
        ? candidates
            .slice(0, NEW_PER_LESSON_TARGET)
            .filter((candidate) => candidate !== lead && !inChain.has(candidate) && candidate.step.item?.buildsOn)
        : [];
      // Similar sentences together: the cards that open the way the lead
      // does come straight after its chain, ahead of its pack-mates. A lead
      // with no mates leaves the sitting as the course's pick.
      const patternMates = sittingPlan.grouping === "similar" && lead
        ? similarMates(lead, candidates).filter((candidate) => !inChain.has(candidate) && !pinnedChains.includes(candidate))
        : [];
      // Conversation order: the reply to the lead, then the reply to that,
      // as far as the fresh cards go — an exchange rather than a list.
      const exchangeMates = exchanges && lead
        ? exchangeChain(lead.de, exchanges, (key) => candidateByKey.has(key), NEW_PER_LESSON_TARGET)
            .map((key) => candidateByKey.get(key)!)
            .filter((candidate) => candidate !== lead && !inChain.has(candidate) && !pinnedChains.includes(candidate))
        : [];
      const pinned = new Set([...chainAfterLead, ...pinnedChains, ...patternMates, ...exchangeMates]);
      // Regrouped once more at the end: the pack-mates reorder above can pull
      // dozens of the lead's pack between a base and its extension whenever
      // the base is NOT the lead. orderWithChains pulls every extension back
      // to directly behind its base, wherever the reorder put them.
      const rankedCandidates = lead
        ? orderWithChains([
            lead,
            ...chainAfterLead,
            ...pinnedChains,
            ...patternMates,
            ...exchangeMates,
            // Pack-mates come next so the sitting feels coherent — but only the
            // ones that are still nearly as worth learning as the lead. Without
            // a bound, one well-chosen lead dragged in whatever happened to sit
            // beside it: a driving lead pulled in "Könnten Sie bitte den
            // Reifendruck überprüfen?", 1,500 places worse. Coherence is worth
            // a little; it is not worth a slot you would rather have spent on
            // something you will actually say.
            ...candidates.filter((candidate) => candidate !== lead && !pinned.has(candidate)
              && candidate.pId === lead.pId && candidate.score - lead.score <= PACK_MATE_SCORE_MARGIN),
            ...candidates.filter((candidate) => candidate !== lead && !pinned.has(candidate) && candidate.pId !== lead.pId),
          ].map((candidate) => ({
            candidate,
            de: String(candidate.step.item?.de ?? ""),
            originalDe: candidate.step.item?.originalDe ? String(candidate.step.item.originalDe) : undefined,
            buildsOn: candidate.step.item?.buildsOn ? String(candidate.step.item.buildsOn) : undefined,
          }))).map((row) => row.candidate)
        : [];
      // A sitting is six sentences at most. A due backlog trades new-material
      // slots for review slots (5+1 when loaded) rather than growing the
      // session — extended material waits for the next Continue Learning.
      const sittingMix = lessonMixForBacklog(requiredReviews.length + globalReviews.length);
      const chainKey = (text: unknown) =>
        sentenceIdentityKey(String(text ?? "")).toLowerCase().replace(/\?+$/, "").trim();
      // "Both": one sitting, still six — four sentence slots, two word
      // slots. The sentence mix keeps its backlog behaviour, scaled: a due
      // sentence backlog still trades new-sentence slots for review slots
      // inside its four.
      const mixedWords = lessonContent === "mixed"
        ? buildWordSitting(rankWordCatalog(buildWordCatalog(activeParts), corpusIndex), reviewState, Date.now(), { reviewSlots: 1, freshSlots: 1 })
        : [];
      const sentenceSlots = mixedWords.length > 0
        ? {
            reviewSlots: Math.max(1, Math.round(sittingMix.reviewSlots * 2 / 3)),
            freshSlots: 0,
          }
        : sittingMix;
      if (mixedWords.length > 0) {
        sentenceSlots.freshSlots = Math.max(1, (6 - mixedWords.length) - sentenceSlots.reviewSlots);
      }
      // An exchange, or a run of similar sentences, is the point of its
      // order, so it is not cut to fit: the fresh slots hold the lead and
      // its mates, and reviews give way (sittingRoom below trims them), the
      // way they already give way to words. A backlog of ten due reviews
      // used to leave one fresh slot — the question and never its reply;
      // with words in the sitting it did so from four.
      const mates = sittingPlan.grouping === "conversation" ? exchangeMates : sittingPlan.grouping === "similar" ? patternMates : [];
      if (mates.length > 0) {
        sentenceSlots.freshSlots = Math.max(sentenceSlots.freshSlots, Math.min(NEW_PER_LESSON_TARGET, 1 + mates.length));
      }
      // Reviews that belong to the conversation the fresh exchange is from
      // are preferred over weaker ones, and later sit in dialogue order
      // around it. A preference: when nothing due fits, the sitting is as
      // it always was.
      const leadDialogue = exchanges && lead ? exchangePlace(lead.de, exchanges)?.dialogue ?? null : null;
      const fitsConversation = (step: any): boolean =>
        Boolean(leadDialogue) && exchangePlace(step?.item?.de, exchanges!)?.dialogue === leadDialogue;
      const { fresh, reviews } = selectContinueLearningMix(
        rankedCandidates.map((candidate) => candidate.step),
        requiredReviews,
        globalReviews,
        sentenceSlots.freshSlots,
        sentenceSlots.reviewSlots,
        reinforcementReviews,
        // The steps here are still un-swapped, so the target sits in `en` only
        // for the English course. French reads its text off the German too.
        getLearningDirection() === "learn-en" ? "en" : "de",
        fitsConversation
      );
      // Every base served gets its extension in the very next slot.
      //
      // Slot arithmetic kept failing this because it reasoned about candidate
      // POSITIONS, while the picker skips candidates that collide in Quick
      // Match — so the base that actually landed last was never the one the
      // arithmetic protected. "Passt das?" ended a sitting three times over
      // that way. This works on the cards that were really chosen: walk them,
      // and where one has an unlearned extension waiting, put it immediately
      // behind its base. What it displaces: the extension takes the next slot
      // and whatever sat there moves to the next sitting.
      const pairedFresh: any[] = [];
      const sittingKeys = new Set<string>(
        [...fresh, ...reviews].map((step: any) => chainKey(step?.item?.de)).filter(Boolean)
      );
      for (const step of fresh) {
        pairedFresh.push(step);
        const item = (step as any)?.item;
        if (!item) continue;
        const baseKeys = [chainKey(item.de), chainKey(item.originalDe ?? item.de)].filter(Boolean);
        const extension = rankedCandidates.find((candidate) => {
          const other = candidate.step?.item;
          if (!other?.buildsOn) return false;
          if (sittingKeys.has(chainKey(other.de))) return false;
          return baseKeys.includes(chainKey(other.buildsOn));
        });
        if (!extension) continue;
        sittingKeys.add(chainKey(extension.step.item.de));
        extension.step.item.chainedFromLesson = true;
        pairedFresh.push(extension.step);
      }
      fresh.length = 0;
      fresh.push(...pairedFresh);
      // The sitting stays six: the cards the pairs displaced are the tail of
      // the review half, and they are first in line next time.
      const sittingRoom = Math.max(1, 6 - fresh.length - mixedWords.length);
      reviews.length = Math.min(reviews.length, sittingRoom);

      const firstFresh = fresh[0];
      const freshId = rankedCandidates.find((candidate) => candidate.step === firstFresh)?.pId;
      const servedFreshDe = new Set(
        fresh.map((step: any) => String(step.item?.de ?? "").trim().toLocaleLowerCase("de-DE"))
      );
      const dialogues = freshId
        ? sessionForPack(freshId).filter(
            (step: any) => step.type === "dialogue" && dialogueIsEarned(step, servedFreshDe)
          )
        : [];
      const freshSteps = [...fresh, ...dialogues];
      // Mark the extensions whose base is actually in THIS sitting. Only those
      // earn the short route: a chained sentence met on its own, weeks after
      // its base, still needs the full introduction.
      const servedKeys = new Set<string>();
      for (const step of freshSteps) {
        const item = (step as any)?.item;
        if (!item) continue;
        const base = item.buildsOn ? chainKey(item.buildsOn) : "";
        if (base && servedKeys.has(base)) item.chainedFromLesson = true;
        servedKeys.add(chainKey(item.de));
        if (item.originalDe) servedKeys.add(chainKey(item.originalDe));
      }

      if (reviews.length > 0 || freshSteps.length > 0 || mixedWords.length > 0) {
        const id = freshId ?? reviewPartByStep.get(reviews[0]) ?? keys[0];
        // New material first, then the word slots when "Both" is chosen,
        // then reviews — words sit between so a mixed sitting reads as one
        // lesson rather than two stapled together.
        // Conversation order: the lines of the lead's dialogue — fresh and
        // review alike — play in the order the dialogue has them, as one
        // block; then the rest of the fresh cards, the words, the other
        // reviews. A review that is the answer to a fresh question sits right
        // after it instead of at the end of the sitting.
        let dealt = [...freshSteps, ...mixedWords, ...reviews];
        if (leadDialogue) {
          const lineOf = (step: any) => step?.type === "sentence" ? exchangePlace(step.item?.de, exchanges!) : null;
          const inTalk = (step: any) => lineOf(step)?.dialogue === leadDialogue;
          const talk = [...freshSteps.filter(inTalk), ...reviews.filter(inTalk)]
            .sort((a, b) => lineOf(a)!.line - lineOf(b)!.line);
          const talkSet = new Set(talk);
          dealt = [
            ...talk,
            ...freshSteps.filter((step) => !talkSet.has(step)),
            ...mixedWords,
            ...reviews.filter((step) => !talkSet.has(step)),
          ];
        }
        let steps = stepsForLearningDirection(dealt);
        steps = [...steps, { type: "complete" }];
        setActivePart(id);
        saveScopedJson("active-part", id, user);
        setSessionSteps(withRegisterCheck(withSecondShowing(steps), user));
        beginLessonTiming(id);
        setShowGuidedSession(true);
        return;
      }
      // Everything known and nothing due — fall through to a review replay
      // of the first pack below.
    }

    const id   = explicit ?? (Object.keys(apiParts)[0] ?? activePart);
    const part = apiParts[id];
    if (!part) return;

    const partWithKey = { ...part, partKey: id };
    const items = part.vocab.map((item, i) => ({
      id: `${id}-${i}`, de: item.de, en: item.en, tip: item.tip,
      example: item.example, exampleFr: item.exampleFr, kind: "vocab", lookup: item.lookup,
    }));
    let steps = sessionForPack(id);
    // German speaker learning English: show the same content the other way round
    // (English is the target you type/hear; German is the meaning). IDs are left
    // untouched so progress tracking stays consistent in either direction.
    steps = stepsForLearningDirection(steps);
    const hasContent = steps.some(s => s.type === "sentence" || s.type === "dialogue");

    if (!hasContent) {
      // Walk the WHOLE curriculum from the top, not just forward: earlier
      // packs may hold due reviews or unfinished tier-1 content, and the
      // most common German must be re-served (and mastered) before anything
      // rarer further down the order unlocks.
      // Auto-advancing must not drop the learner into a pack they paused.
      const advanceParts = withoutMutedPacks(apiParts);
      const partKeys = Object.keys(advanceParts);
      let nextIdWithContent: string | undefined;

      for (let i = 0; i < partKeys.length; i++) {
        const pId = partKeys[i];
        if (pId === id) continue; // already checked above
        const p = advanceParts[pId];
        if (!p) continue;
        const pSteps = sessionForPack(pId);
        if (pSteps.some(s => s.type === "sentence" || s.type === "dialogue")) {
          nextIdWithContent = pId;
          break;
        }
      }

      if (nextIdWithContent) {
        setActivePart(nextIdWithContent);
        saveScopedJson("active-part", nextIdWithContent, user);
        startSession(nextIdWithContent);
        return;
      } else {
        // All course lessons are completed — replay requested part in review mode (without wiping COMPLETED_KEY)
        setActivePart(id);
        saveScopedJson("active-part", id, user);
        let reviewSteps = stepsForLearningDirection(buildSession(partWithKey, items, {}, 0));
        setSessionSteps(withRegisterCheck(withSecondShowing(reviewSteps), user));
      }
    } else {
      setActivePart(id);
      saveScopedJson("active-part", id, user);
      setSessionSteps(withRegisterCheck(withSecondShowing(steps), user));
    }
    beginLessonTiming(id);
    setShowGuidedSession(true);
  };

  startSessionRef.current = startSession;
  useEffect(() => {
    // "fast" is Continue learning over the conversational packs only, so it
    // resolves to a real pack id here and then takes the ordinary explicit
    // path — the sitting itself is built exactly as any other, which is the
    // point: the fast track is a smaller course, not a different lesson.
    const requestedPart = !guidedRequest || guidedRequest === "continue"
      ? undefined
      : guidedRequest === "fast"
        ? (fastTrackPart() ?? undefined)
        : guidedRequest;
    if (
      !guidedRequest
      || guidedAutoStartedRef.current
      || showPlacementTest
      || Object.keys(apiParts).length === 0
      || (requestedPart && !apiParts[requestedPart])
    ) return;

    guidedAutoStartedRef.current = true;
    lastRequestedPartRef.current = requestedPart;
    startSessionRef.current(requestedPart);
  }, [apiParts, guidedRequest, showPlacementTest]);

  /**
   * The same sitting, twice over, woven rather than stacked.
   *
   * Each phrase is taught once and comes back two phrases later for a quick
   * tap-through: teach one, teach another, then the first returns, and so on
   * down the sitting. That spacing is the whole value of the second showing —
   * recalling something you met two phrases ago is remembering, recalling it
   * immediately is reading — and coming back sooner, more than once a sitting
   * would ever allow, is what makes it stick.
   *
   * The returns were a block at the end before. Every phrase still came back,
   * but the first waited the entire sitting and the last waited seconds, and
   * a run of closed-book typing tests arrived all at once at the point the
   * learner is most ready to stop.
   *
   * The second showing is PRACTICE, not a review. It is marked as
   * reinforcement, so it does not climb the ladder and does not move the due
   * date — the phrase still comes back in the next sitting exactly when it
   * always would have. Nothing about the schedule changes; a sitting simply
   * asks twice before it lets go.
   *
   * The copy is stamped secondShowing, which picks the tap-only return route,
   * and keeps mastery strong so everything downstream that reads a repeat off
   * the copy still sees what it always saw. Both are routing hints rather than
   * claims about the tracker — the same way the lesson builder already marks a
   * swapped-in replacement as new.
   *
   * The completion screen stays last, and anything that is not a sentence —
   * a dialogue, a register question — is left alone: those are not a phrase
   * being learned and have nothing to come back for.
   */
  /**
   * A phrase whose spelling was missed last time is spelled again this time.
   *
   * The miss bought the writing stages back inside the sitting where it
   * happened, and then the sitting ended and the component remounted and the
   * memory of it went with it: the phrase came back for review on the
   * one-test route as if it had never gone wrong. The record knows better —
   * it keeps when the item was last answered and when it last slipped — so
   * every step is stamped from that before the sitting is dealt, whatever
   * kind of review brought it here.
   */
  const withSpellingMemory = (steps: any[]): any[] => {
    const grades = loadCompleted();
    return steps.map((step) => {
      if (step?.type !== "sentence" || !step.item?.id || step.item.typingFailed) return step;
      const record = progressEntryForId(grades, step.item.id, step.item.aliases ?? [])?.record;
      // A slip, or a second miss running. Getting the phrase wrong ONCE means
      // it has not been learnt, and the review it earned is the answer to
      // that — being handed the writing route as well makes forgetting cost
      // six stages of transcription. Missing it again on that review is a
      // different fact: the meeting was not enough, and writing it out is
      // worth the time now in a way it was not the first time round.
      return lastRunHadSpellingSlip(record) || missedTwiceRunning(record)
        ? { ...step, item: { ...step.item, typingFailed: true } }
        : step;
    });
  };

  const withSecondShowing = (dealt: any[]): any[] => {
    // Stamped first, so the second showing inherits the memory too.
    const steps: any[] = withSpellingMemory(dealt);
    const endsOnComplete = steps[steps.length - 1]?.type === "complete";
    const body = endsOnComplete ? steps.slice(0, -1) : steps;
    /**
     * How many further phrases are met before the first one comes back.
     *
     * The returns used to be a block at the end, which meant the gap between
     * meeting a phrase and being asked for it was the whole rest of the
     * sitting for the first one and almost nothing for the last. Two is the
     * gap that makes the return a recall — long enough that the phrase has
     * left the screen and two others have been on it, short enough to land
     * before it is gone.
     */
    const GAP = 2;
    const isPhrase = (step: any) => step?.type === "sentence" && step.item?.id;
    if (!body.some(isPhrase)) return steps;

    const woven: any[] = [];
    const waiting: { due: number; step: any }[] = [];
    let met = 0;
    for (const step of body) {
      woven.push(step);
      if (!isPhrase(step)) continue;
      met += 1;
      waiting.push({ due: met + GAP, step: secondShowingOf(step) });
      while (waiting.length > 0 && waiting[0].due <= met) woven.push(waiting.shift()!.step);
    }
    // The last phrases taught have nobody after them to wait for, so their
    // returns close the sitting.
    for (const pending of waiting) woven.push(pending.step);

    return endsOnComplete ? [...woven, steps[steps.length - 1]] : woven;
  };

  const logActivity = (stepsForCount: any[], completed = false) => {
    const startedAt = sessionStartRef.current;
    sessionStartRef.current = null;
    const timer = activeStudyTimerRef.current;
    activeStudyTimerRef.current = null;
    const activeMs = timer?.stop() ?? (startedAt ? Date.now() - startedAt : 0);
    const progressBefore = sessionKnownBeforeRef.current;
    const lessonId = sessionLessonIdRef.current;
    sessionKnownBeforeRef.current = null;
    sessionLessonIdRef.current = undefined;
    if (!startedAt) return;
    if (!completed || progressBefore === null || activeMs < 1_000) return;

    recordCompletedLearningSession({
      activeMs,
      progressBefore,
      progressAfter: countKnownVocab(user, progressStats.externalWords),
      lessonId,
      sentences: stepsForCount.filter((s) => s.type === "sentence").length,
      dialogues: stepsForCount.filter((s) => s.type === "dialogue").length,
    }, user);
  };

  const returnToHome = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("guided");
    url.searchParams.delete("tab");
    window.location.assign(url.toString());
  };

  if (showPlacementTest) return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-[var(--surface)] p-6">
      <PlacementTest onComplete={(key) => {
        setActivePart(key);
        setShowPlacementTest(false);
        saveScopedJson("german-lab-placement-result", key, user);
        saveScopedJson("german-lab-placement-done", true, user);
      }} />
    </div>
  );

  if (
    guidedRequest
    && !showGuidedSession
    && (
      Object.keys(apiParts).length === 0
      || guidedRequest === "continue"
      || guidedRequest === "fast"
      || Boolean(apiParts[guidedRequest])
    )
  ) return (
    <div
      aria-live="polite"
      className="guided-session fs-app prototype-guided-session prototype-guided-loading-screen"
      role="status"
    >
      <div className="prototype-guided-loading-card">
        <img src="/icon-64.png" alt="" />
        <div className="prototype-guided-loading-copy">
          <strong>{ui("Preparing your lesson")}</strong>
          <span>{ui("Choosing useful phrases for this session.")}</span>
        </div>
        {/* A real bar, or none at all: it fills as each table lands, and a
            course that fetches none shows the words on their own. */}
        {tablesLoaded.total > 0 && (
          <div
            aria-valuemax={tablesLoaded.total}
            aria-valuemin={0}
            aria-valuenow={tablesLoaded.done}
            className="prototype-guided-loading-track"
            role="progressbar"
          >
            <i style={{ transform: `scaleX(${tablesLoaded.done / tablesLoaded.total})` }} />
          </div>
        )}
      </div>
    </div>
  );

  if (showGuidedSession) return (
    <>
      {/*
        Listen, carried into the lesson.

        Opening a lesson is a page navigation rather than a change of view,
        so the app around Listen is torn down and this one is built in its
        place. Mounted here as well, a session the learner left running comes
        back with its player rather than ending because they went to study.

        active={false}: this is the small player, never the full screen. It
        draws nothing at all unless there is a live session to show.
      */}
      <Suspense fallback={null}>
        <BackgroundListen
          apiParts={apiParts}
          learningDirection={getLearningDirection()}
          profile={user}
        />
      </Suspense>
      <GuidedSession
      unseenPhrases={unseenPhrases}
      onCancel={(completedUpTo?: number) => {
        // Each non-skipped step is persisted as it is left. Replaying the
        // whole prefix here would accidentally grade any skipped steps.
        logActivity(sessionSteps.slice(0, completedUpTo && completedUpTo > 0 ? completedUpTo : 0));
        setShowGuidedSession(false);
        returnToHome();
      }}
      onComplete={() => {
        setShowGuidedSession(false);
        finishLessonAndQueueNext(
          () => {
            // onAdvance already persisted every completed, non-skipped exercise.
            // A bulk replay here would turn skipped items into successful recalls.
            logActivity(sessionSteps, true);
            const xp = sessionSteps.length * 15;
            updateStats({
              totalXp: progressStats.totalXp + xp,
              sessionsCompleted: progressStats.sessionsCompleted + 1,
              totalReviews: progressStats.totalReviews + Math.floor(sessionSteps.length / 2),
              streak: recordStreakDay(user),
            });
          },
          // Always use the global Continue Learning selector (no part id), so
          // the next lesson keeps the same review/new mix. The short unmount
          // gap resets GuidedSession's internal stage state cleanly.
          () => window.setTimeout(() => startSession(), 260)
        );
      }}
      onGradeItem={(itemId: string, grade: "know" | "struggle") => markGrade(itemId, grade)}
      onSetItemStrength={(itemId: string, level: number) => setGuidedStrength(itemId, level)}
      onSetItemPermanent={(itemId: string) => setGuidedPermanent(itemId)}
      onUndoGradeItem={(itemId: string) => undoGuidedGrade(itemId)}
      onPreviewKnown={replaceKnownPreviewItem}
      onPreviewSwap={swapPreviewItem}
      // A change to how the sitting is put together rebuilds it on the spot,
      // the way the next lesson is started: a short unmount so GuidedSession's
      // stage state resets, then the same sitting request with the new
      // settings read fresh from storage. Grades already given are saved as
      // they were given, so nothing answered is lost — only the position.
      onRebuildSitting={() => {
        setShowGuidedSession(false);
        window.setTimeout(() => startSessionRef.current(lastRequestedPartRef.current), 120);
      }}
      onSnoozeItem={(itemId: string, days: number) => snoozeGuidedItem(itemId, days)}
      // A skipped item is NOT a recall — marking it would climb the memory
      // ladder and schedule it out for months, and inflate the fluency count.
      onAdvance={(step: any, skipped?: boolean, performance?: AnswerPerformance) => {
        // A conversation step holds several reviews. Expanded here so each one
        // climbs its own ladder and shows up in the tracker -- the whole point
        // of practising them this way rather than in a separate mode.
        const parts = step?.type === "conversation"
          ? (step.turns ?? []).map((turn: any) => turn.step).filter(Boolean)
          : [step];
        if (skipped) parts.forEach((part: any) => markAttempted(part, performance));
        else markCompleted(parts, performance);
      }}
      onRegisterAnswer={(id: string, correct: boolean) => {
        const state = (loadScopedJson<RegisterState>(REGISTER_KEY, {}, user) as RegisterState) ?? {};
        saveScopedJson(REGISTER_KEY, recordRegisterAnswer(state, id, correct), user);
      }}
      steps={sessionSteps}
      />
    </>
  );

  return (
    <div className="guided-session fs-app prototype-guided-session prototype-guided-loading-screen">
      <div className="prototype-guided-loading-card">
        <img src="/icon-64.png" alt="" />
        <div className="prototype-guided-loading-copy">
          <strong>{ui("Lesson unavailable")}</strong>
          <span>{ui("Return home and choose another lesson.")}</span>
        </div>
        <button className="lesson-cta" onClick={returnToHome} type="button">
          {ui("Back to Micheon")}
        </button>
      </div>
    </div>
  );
}
