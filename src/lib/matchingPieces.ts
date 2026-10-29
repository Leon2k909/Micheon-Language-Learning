import { sentenceIdentityKey } from "@/lib/germanTextMatch";

/**
 * What a matching board may hold: lines short enough to be read whole.
 *
 * A board pairs each line with its translation, and any one word that only
 * one line contains is enough to make the pair. On a short line that word is
 * most of the line, so finding it is reading it. On a two-sentence dialogue
 * line it is not: Zwiebeln finds "onions", and the other dozen words on each
 * side go unread. Every board in a lesson of long lines was cleared by
 * spotting one word per pair, which is a search puzzle, not practice.
 *
 * So a line made of several sentences is cut into them, where both languages
 * cut the same way, and each sentence goes on the board if it is short. What
 * is still long stays off: sentence practice comes straight after and asks
 * for every word of it.
 */

/** The longest piece a board takes, in words, in the language being learned. */
const MATCH_MAX_TARGET_WORDS = 6;
/**
 * And in the learner's own language, which runs longer: "Logisch wäre eine
 * klare Ansage." is five words of German and eight of English.
 */
const MATCH_MAX_MEANING_WORDS = 8;
/**
 * How far apart the two cuts may fall, as a share of each line.
 *
 * The same number of sentences is not the same cut. "Ja. Das ist gut, oder?"
 * and "Yes, that's good. Isn't it?" are two and two, and pairing them in
 * order would teach that Ja means "Yes, that's good". A real cut falls at
 * about the same point through both lines; that one falls a fifth of the way
 * through the German and two thirds through the English.
 */
const MAX_CUT_DRIFT = 0.2;

const CLOSING = /["'»“”’)\]]+$/u;
const OPENING = /^["'„«“‘(¿¡]+/u;
// Full stops that end a word rather than a sentence: an initial (z. B.,
// u. a.), an ordinal (am 3. Mai) or a title in front of a name.
const NOT_A_SENTENCE_END = /^(?:\p{L}|\d+|dr|mr|mrs|ms|prof|st|nr|hr|fr|bzw|usw|ca|vs|etc|inkl|evtl|ggf|str|z\.b|u\.a|d\.h)\.$/iu;

/** A line's sentences, in order. A line that is one sentence comes back whole. */
export function splitSentences(text: string): string[] {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const sentences: string[] = [];
  let current: string[] = [];
  words.forEach((word, index) => {
    current.push(word);
    const next = words[index + 1];
    if (!next) return;
    const bare = word.replace(CLOSING, "");
    const ends = /[.!?…]$/u.test(bare) && !NOT_A_SENTENCE_END.test(bare);
    if (ends && /^\p{Lu}/u.test(next.replace(OPENING, ""))) {
      sentences.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) sentences.push(current.join(" "));
  return sentences;
}

/** Where each cut falls, as a share of the whole line. */
const cutPoints = (sentences: string[]): number[] => {
  const total = sentences.join(" ").length;
  let run = 0;
  return sentences.slice(0, -1).map((sentence) => {
    run += sentence.length + 1;
    return run / total;
  });
};

/**
 * A line and its translation as matching pairs of sentences — or the whole
 * line, unchanged, when the two do not cut the same way.
 */
export function sentencePairs(target: string, meaning: string): Array<{ target: string; meaning: string }> {
  const targets = splitSentences(target);
  const meanings = splitSentences(meaning);
  if (targets.length < 2 || targets.length !== meanings.length) return [{ target, meaning }];
  const meaningCuts = cutPoints(meanings);
  if (cutPoints(targets).some((at, index) => Math.abs(at - meaningCuts[index]) > MAX_CUT_DRIFT)) {
    return [{ target, meaning }];
  }
  return targets.map((sentence, index) => ({ target: sentence, meaning: meanings[index] }));
}

const wordCount = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * Today's cards as a board can use them: short lines whole, long lines by
 * their short sentences, and nothing a learner could match without reading.
 *
 * `leftOut` counts the sentences kept off for length, so the board can say
 * where they went instead of claiming it held the whole lesson.
 */
export function matchingPieces<T extends { target: string; meaning: string }>(cards: T[]): {
  pieces: Array<T & { piece: number }>;
  leftOut: number;
} {
  const pieces: Array<T & { piece: number }> = [];
  let leftOut = 0;
  for (const card of cards) {
    sentencePairs(card.target, card.meaning).forEach((pair, piece) => {
      if (wordCount(pair.target) > MATCH_MAX_TARGET_WORDS || wordCount(pair.meaning) > MATCH_MAX_MEANING_WORDS) {
        leftOut += 1;
        return;
      }
      // "Okay." against "Okay." is matched by sight, not by knowing anything.
      const same = sentenceIdentityKey(pair.target).toLocaleLowerCase() === sentenceIdentityKey(pair.meaning).toLocaleLowerCase();
      if (same) return;
      pieces.push({ ...card, target: pair.target, meaning: pair.meaning, piece });
    });
  }
  return { pieces, leftOut };
}
