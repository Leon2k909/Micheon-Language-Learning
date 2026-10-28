// Speech synthesis through Chromium's own network stack.
//
// The local server synthesises over a WebSocket to Microsoft's Read Aloud
// service (server/edgeSpeech.js). Run under plain Node that works. Run inside
// the desktop app — where the server lives in Electron's main process — the
// service answers the very same request with a bare 200 and no socket, every
// time: it judges the client by its TLS handshake, and Electron's Node speaks
// with BoringSSL, not OpenSSL. Measured on 2026-10-27, the same script opened
// under Node 24 and was turned away under Electron 44; every TLS option tried
// under Electron (cipher lists, curves, ALPN, protocol versions) was turned
// away too, and under Node any departure from the default was.
//
// Chromium's own stack is the one Edge's Read Aloud really uses, and it is
// served. So the app keeps one hidden, sandboxed window whose only job is to
// hold a WebSocket to the service, and the server is handed `synthesize` (see
// useSpeechSynthesizer in server/index.js).
//
// What the window does with that socket is shaped by the service's limits:
// - The service rate-limits HANDSHAKES (a 429 on about one in three or four,
//   even a second apart) but not clips: one open connection carries clip
//   after clip, each in a few hundred milliseconds. So there is one
//   connection, clips go over it one at a time, and it is kept between clips.
// - A refused handshake shows here only as an error with no status. Each one
//   pushes the next attempt further off — half a second, then one, two, four,
//   up to eight — instead of retrying at once, which is what turned a few
//   refusals into a run of them before.
//
// The window holds no permissions, opens nothing, loads only about:blank, and
// its session rewrites the Origin and User-Agent headers for the two speech
// hosts and nothing else.

import { BrowserWindow, session } from "electron";
import { SPEECH_CLIENT_HEADERS, SYNTHESIS_HOSTS, speechConfigFrame, speechSocketUrl, ssmlFrame } from "../server/edgeSpeech.js";

const PARTITION = "micheon-speech";
// The page closes a quiet connection after IDLE_CLOSE_MS; the window itself is
// let go after WINDOW_IDLE_MS without a request, so a learner who has stopped
// is not keeping a renderer process alive for nothing.
const WINDOW_IDLE_MS = 3 * 60_000;
/** The only requests whose headers this session touches. */
const SPEECH_URL_PATTERNS = SYNTHESIS_HOSTS.map((host) => `wss://${new URL(host).host}/*`);

// Runs inside the hidden window. Kept as a plain function so it reads as code;
// it is sent to the page as source and has no access to anything here.
function speechPage() {
  const IDLE_CLOSE_MS = 60_000;
  const MAX_CONNECTION_AGE_MS = 5 * 60_000;
  const SILENCE_TIMEOUT_MS = 5_000;
  const OPEN_TIMEOUT_MS = 4_000;
  const COOLDOWN_STEPS_MS = [500, 1_000, 2_000, 4_000, 8_000];
  const MIN_TURN_MS = 4_000;

  let socket = null;
  let openedAt = 0;
  let idleTimer = null;
  let refusals = 0;
  let coolUntil = 0;
  let queue = Promise.resolve();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  function drop() {
    clearTimeout(idleTimer);
    const old = socket;
    socket = null;
    if (old) {
      old.onopen = old.onclose = old.onerror = old.onmessage = null;
      try { old.close(); } catch { /* already gone */ }
    }
  }

  function usable() {
    return socket && socket.readyState === WebSocket.OPEN && Date.now() - openedAt < MAX_CONNECTION_AGE_MS;
  }

  function open(url, deadline) {
    drop();
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => finish(false), Math.min(OPEN_TIMEOUT_MS, Math.max(0, deadline - Date.now())));
      function finish(ok) {
        clearTimeout(timer);
        ws.onopen = ws.onerror = null;
        if (ok) {
          socket = ws;
          openedAt = Date.now();
          refusals = 0;
          coolUntil = 0;
          ws.onclose = () => { if (socket === ws) socket = null; };
        } else {
          try { ws.close(); } catch { /* never opened */ }
          coolUntil = Date.now() + COOLDOWN_STEPS_MS[Math.min(refusals, COOLDOWN_STEPS_MS.length - 1)];
          refusals += 1;
        }
        resolve(ok);
      }
      ws.onopen = () => finish(true);
      ws.onerror = () => finish(false);
    });
  }

  // One clip over the open socket. Resolves with the audio, or with a reason.
  function turn(ws, config, ssml) {
    return new Promise((resolve) => {
      const parts = [];
      let silence = null;
      const settle = (result) => {
        clearTimeout(silence);
        ws.onmessage = null;
        ws.onclose = () => { if (socket === ws) socket = null; };
        resolve(result);
      };
      const armSilence = () => {
        clearTimeout(silence);
        silence = setTimeout(() => { drop(); settle({ reason: "silent" }); }, SILENCE_TIMEOUT_MS);
      };
      ws.onclose = () => { if (socket === ws) socket = null; settle({ reason: "closed" }); };
      ws.onmessage = (event) => {
        armSilence();
        if (typeof event.data === "string") {
          const head = event.data.slice(0, event.data.indexOf("\r\n\r\n") >>> 0);
          if (!/(^|\r\n)Path:turn\.end(\r\n|$)/u.test(head)) return;
          if (!parts.length) return settle({ reason: "no audio" });
          const total = parts.reduce((sum, part) => sum + part.length, 0);
          const audio = new Uint8Array(total);
          let at = 0;
          for (const part of parts) { audio.set(part, at); at += part.length; }
          return settle({ audio });
        }
        const view = new DataView(event.data);
        if (view.byteLength < 2) return;
        const headerLength = view.getUint16(0);
        if (headerLength + 2 > view.byteLength) return;
        const header = new TextDecoder().decode(new Uint8Array(event.data, 2, headerLength));
        if (!/(^|\r\n)Path:audio(\r\n|$)/u.test(header)) return;
        const audio = new Uint8Array(event.data, 2 + headerLength);
        if (audio.length) parts.push(audio.slice());
      };
      armSilence();
      try {
        ws.send(config);
        ws.send(ssml);
      } catch {
        drop();
        settle({ reason: "closed" });
      }
    });
  }

  async function speak({ urls, config, ssml, deadline }) {
    clearTimeout(idleTimer);
    let urlIndex = 0;
    let last = "deadline";
    try {
      while (Date.now() < deadline) {
        if (!usable()) {
          if (Date.now() < coolUntil) {
            await sleep(Math.min(coolUntil, deadline) - Date.now());
            continue;
          }
          if (!(await open(urls[Math.min(urlIndex, urls.length - 1)], deadline))) {
            urlIndex += 1;
            last = "refused";
            continue;
          }
        }
        const result = await turn(socket, config, ssml);
        if (result.audio) return result;
        last = result.reason;
        // A turn that failed on a kept socket is the socket's fault, not the
        // service refusing: it is dropped and the clip goes again at once.
        drop();
      }
      return { reason: last };
    } finally {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(drop, IDLE_CLOSE_MS);
    }
  }

  // One clip at a time over the one socket, in the order they were asked for.
  //
  // The deadline is stamped when the server takes the clip, but the server
  // hands over three at once and they wait here in line. Behind a clip that
  // spent its budget on refused handshakes, the next ones reached the front
  // with their deadline already gone and failed without a single attempt —
  // the current card's line along with the next card's warm-up. So a clip at
  // the front always gets a fair turn of its own, whatever its stamp says.
  window.micheonSpeak = (job) => {
    const run = queue.then(() => speak({ ...job, deadline: Math.max(job.deadline, Date.now() + MIN_TURN_MS) }));
    queue = run.catch(() => {});
    return run;
  };
}

export function createChromiumSpeech() {
  let win = null;
  let ready = null;
  let windowIdleTimer = null;
  let sessionReady = false;

  function prepareSession() {
    const speechSession = session.fromPartition(PARTITION);
    if (sessionReady) return speechSession;
    sessionReady = true;
    speechSession.setUserAgent(SPEECH_CLIENT_HEADERS["User-Agent"]);
    speechSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    speechSession.setPermissionCheckHandler(() => false);
    speechSession.webRequest.onBeforeSendHeaders({ urls: SPEECH_URL_PATTERNS }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, ...SPEECH_CLIENT_HEADERS } });
    });
    return speechSession;
  }

  function destroy() {
    clearTimeout(windowIdleTimer);
    ready = null;
    const old = win;
    win = null;
    if (old && !old.isDestroyed()) old.destroy();
  }

  function ensureWindow() {
    if (ready && win && !win.isDestroyed()) return ready;
    destroy();
    win = new BrowserWindow({
      show: false,
      width: 200,
      height: 120,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        session: prepareSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Hidden windows have their timers throttled, and the page's silence
        // and back-off timers are what keep a dead socket from hanging a clip.
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const current = win;
    current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    current.webContents.on("render-process-gone", () => { if (win === current) destroy(); });
    current.on("closed", () => {
      if (win !== current) return;
      win = null;
      ready = null;
    });
    ready = current.loadURL("about:blank")
      .then(() => current.webContents.executeJavaScript(`(${speechPage.toString()})(); true`))
      .catch((error) => {
        destroy();
        throw error;
      });
    return ready;
  }

  async function synthesize(text, voice, rate, { deadline = Date.now() + 8_000 } = {}) {
    clearTimeout(windowIdleTimer);
    try {
      await ensureWindow();
      const current = win;
      if (!current || current.isDestroyed()) throw new Error("tts via Chromium failed: the speech window closed");
      const job = {
        // A fresh address for each handshake this clip might need; the page
        // uses the next one after a refusal.
        urls: [0, 1, 2, 3].map(() => speechSocketUrl(SYNTHESIS_HOSTS[0])),
        config: speechConfigFrame(),
        ssml: ssmlFrame(text, voice, rate),
        deadline,
      };
      const result = await current.webContents.executeJavaScript(`window.micheonSpeak(${JSON.stringify(job)})`);
      if (result?.audio?.length) return Buffer.from(result.audio);
      throw new Error(`tts via Chromium failed: ${result?.reason ?? "no result"}`);
    } finally {
      windowIdleTimer = setTimeout(destroy, WINDOW_IDLE_MS);
    }
  }

  return { synthesize, destroy };
}
