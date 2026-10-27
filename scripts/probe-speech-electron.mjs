/**
 * Can the desktop app speak? Measured the way the app speaks.
 *
 * Run as an Electron main process: `electron scripts/probe-speech-electron.mjs`
 * (`xvfb-run -a` in front on a Linux runner). It drives the app's own speech
 * window, electron/speechWorker.js, so it sees what an installation sees: the
 * service judges the client by its TLS handshake, and a probe written for plain
 * Node measured a different client from the one learners have. That probe
 * (probe-tts-hosts.mjs) still describes the dev server, which runs on Node.
 *
 * Two measurements, because the service limits them differently:
 * - Clips over a kept connection, a second and a half apart: what a lesson
 *   does. This decides the verdict — healthy when at least CLIPS_NEEDED of
 *   CLIPS arrive inside the app's own deadline.
 * - Fresh connections, a few seconds apart: reported, not judged. The service
 *   throttles new connections, and the app opens one only when it has none.
 *
 * A failing first pass is measured again after a minute, so one bad moment on
 * the runner does not raise an alarm.
 *
 * Usage: electron scripts/probe-speech-electron.mjs [--report <file.md>]
 * Exit 0 healthy, 1 unhealthy, 2 the probe itself could not run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app } from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = process.argv.indexOf("--report");
const reportPath = at > 0 ? process.argv[at + 1] : undefined;

const CLIPS = 6;
const CLIPS_NEEDED = 5;
const CLIP_GAP_MS = 1_500;
const FRESH = 3;
const FRESH_GAP_MS = 4_000;
const RECHECK_AFTER_MS = 60_000;
// The app's own fetch gives a clip nine seconds; the server budget is eight.
const CLIP_DEADLINE_MS = 8_000;
const VOICE = "de-DE-KatjaNeural";
const LINES = [
  "Guten Morgen.", "Wie geht es dir?", "Kannst du mir helfen?",
  "Wo ist der Bahnhof?", "Das klingt gut.", "Bis später!",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

function writeReport(markdown) {
  if (reportPath) fs.writeFileSync(reportPath, markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
}

async function clip(speech, text) {
  const started = Date.now();
  try {
    const audio = await speech.synthesize(text, VOICE, "+0%", { deadline: started + CLIP_DEADLINE_MS });
    return { ok: audio.length > 0, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, why: String(error?.message ?? error).replace(/^tts via Chromium failed: /u, "") };
  }
}

async function measure(createChromiumSpeech) {
  const kept = createChromiumSpeech();
  const clips = [];
  try {
    for (let i = 0; i < CLIPS; i += 1) {
      if (i) await sleep(CLIP_GAP_MS);
      clips.push(await clip(kept, `${LINES[i % LINES.length]} ${Date.now() % 1000}`));
    }
  } finally {
    kept.destroy();
  }
  const fresh = [];
  for (let i = 0; i < FRESH; i += 1) {
    await sleep(FRESH_GAP_MS);
    const once = createChromiumSpeech();
    try {
      fresh.push(await clip(once, `${LINES[i]} ${Date.now() % 1000}`));
    } finally {
      once.destroy();
    }
  }
  return { clips, fresh };
}

const row = (label, results) => {
  const ok = results.filter((r) => r.ok);
  const reasons = {};
  for (const r of results) if (!r.ok) reasons[r.why] = (reasons[r.why] ?? 0) + 1;
  const m = median(ok.map((r) => r.ms));
  return `| ${label} | ${ok.length}/${results.length} | ${m === null ? "—" : `${m} ms`} | ${
    Object.entries(reasons).map(([why, n]) => `${why} ×${n}`).join(", ") || "none"} |`;
};

// The probe closes each speech window as it goes; Electron would otherwise
// take the last one closing as the moment to quit.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  let createChromiumSpeech;
  try {
    ({ createChromiumSpeech } = await import(pathToFileURL(path.join(root, "electron", "speechWorker.js")).href));
  } catch (error) {
    writeReport(`## Speech probe could not run\n\nLoading electron/speechWorker.js failed: \`${String(error?.message ?? error)}\`\n`);
    app.exit(2);
    return;
  }

  let result = await measure(createChromiumSpeech);
  let rechecked = false;
  const delivered = (r) => r.clips.filter((c) => c.ok).length;
  if (delivered(result) < CLIPS_NEEDED) {
    rechecked = true;
    await sleep(RECHECK_AFTER_MS);
    result = await measure(createChromiumSpeech);
  }
  const healthy = delivered(result) >= CLIPS_NEEDED;

  writeReport([
    `## ${healthy ? "Speech healthy" : "Speech failing"}`,
    "",
    healthy
      ? "The app's speech path delivers clips: a lesson would be heard."
      : "The app's speech path is not delivering clips. Learners will hear the voice late, or not at all.",
    "",
    "| Measured through the app's speech window | Delivered | Median | Failures |",
    "| --- | --- | --- | --- |",
    row(`Lesson clips on a kept connection, ${CLIP_GAP_MS / 1000}s apart`, result.clips),
    row(`Fresh connections, ${FRESH_GAP_MS / 1000}s apart (reported only)`, result.fresh),
    "",
    `Healthy means at least ${CLIPS_NEEDED} of ${CLIPS} lesson clips arrive within ${CLIP_DEADLINE_MS / 1000}s each, through electron/speechWorker.js — Chromium's network stack, as in the installed app.${
      rechecked ? " The first pass fell short, so this is the second measurement, taken a minute later." : ""}`,
    "",
    healthy ? "" : [
      "Where to look:",
      "- A refused connection shows in the window only as \"refused\": time raw handshakes with `npm run probe:tts-hosts` (plain Node) from a home connection to see the status codes (429 is throttling, 403 a rejected token or user agent, a bare 200 a rejected client).",
      "- Compare `SYNTHESIS_HOSTS`, `SPEECH_CLIENT_HEADERS` and the token constants in `server/edgeSpeech.js` with the current edge-tts project (rany2/edge-tts), which tracks Microsoft's endpoint changes.",
      "",
    ].join("\n"),
  ].join("\n"));
  app.exit(healthy ? 0 : 1);
});
