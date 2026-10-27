import { syncLocalStorageItem } from "./profileStorage";

const KEY = "gl-theme";
const DARK_DEFAULT_MIGRATION_KEY = "micheon-dark-default-v1";
/**
 * Set the first time a learner picks a theme for themselves. Before the
 * control existed there was no way to choose, so a stored "light" was the
 * app's decision, not theirs — this is what tells the two apart.
 */
const THEME_CHOSEN_KEY = "gl-theme-chosen";

export type Theme = "dark" | "light";

/**
 * What an install that never chose gets. Appearance labels this option
 * "The default" from here, so the label cannot keep naming light after the
 * default moved.
 */
export const DEFAULT_THEME: Theme = "dark";

/**
 * What the learner CHOSE, which is not always what is on screen: "system"
 * resolves against the OS setting and follows it while the app is open.
 */
export type ThemePreference = Theme | "system";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : DEFAULT_THEME;
}

export function resolveTheme(preference: ThemePreference = getThemePreference()): Theme {
  return preference === "system" ? systemTheme() : preference;
}

/** The theme actually on screen. Callers that only paint want this one. */

/**
 * Dark becomes the default.
 *
 * The earlier light migration wrote "light" into every install, so simply
 * changing the fallback would move nobody: an install that never chose looks
 * identical to one that did. THEME_CHOSEN_KEY is what separates them — it is
 * only written when someone presses an option in Appearance. Installs that
 * never chose are moved to dark once; a real choice is never touched.
 */
export function migrateToDarkThemeDefault() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(DARK_DEFAULT_MIGRATION_KEY) === "1") return;
  localStorage.setItem(DARK_DEFAULT_MIGRATION_KEY, "1");
  if (localStorage.getItem(THEME_CHOSEN_KEY) === "1") return;
  localStorage.setItem(KEY, "dark");
  syncLocalStorageItem(KEY, "dark");
}

/**
 * Paint the theme onto the document. Safe to call on every boot / after
 * hydration — it only sets the attribute and does NOT write storage or sync,
 * so it can't clobber a value the shared store is about to provide.
 */
export function applyThemeToDom(theme: Theme) {
  if (typeof window !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
    // Tell the native shell what colour to open in NEXT time — on every paint,
    // not only when someone visits Appearance and picks something.
    //
    // This used to live in setTheme alone, so an install that had been dark
    // since before the control existed (or that was moved to dark by the
    // default migration, which only writes localStorage) still had "light"
    // saved as its paint hint. The window opened white and the page painted
    // dark over it: a flash on every single launch, for exactly the people who
    // had never touched the setting. Doing it here self-heals those installs
    // on their first run.
    try {
      (window as any).germDesktop?.setDesktopTheme?.(theme);
    } catch {
      /* browser build, or an older desktop shell: nothing to tell */
    }
    // A custom accent is derived per theme — the dark shades come off a
    // lifted base — so the paint has to follow every theme change.
    void import("@/lib/accentColour").then((m) => m.applyAccentColour()).catch(() => {});
    // Hand-picked part colours are stored per theme for the same reason a
    // colour chosen against the dark background is unreadable on the light
    // one, so the light and dark books are swapped here too.
    void import("@/lib/customColours").then((m) => m.applyCustomColours()).catch(() => {});
  }
}

/**
 * Follow a theme change made in ANOTHER window.
 *
 * The desktop pet lives in its own BrowserWindow, running the same app. It read
 * the theme once at boot and never again, so changing theme in the main window
 * left the speech bubble in the old light/dark mode. localStorage is shared
 * between the windows and fires a storage event in the ones that did not write
 * it, which is the same mechanism the pet's own settings already use.
 */
export function watchStoredThemePreferences(): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) applyStoredThemePreferences();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** Repaint the stored mode after shared-profile hydration. */
export function applyStoredThemePreferences() {
  applyThemeToDom(resolveTheme());
}

/**
 * The user picked a theme: paint it, persist it locally, and push it to the
 * shared store so it survives restarts and follows them across browsers/tools
 * on this machine. Only call this from an explicit user action, never on boot.
 */
export function setTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  applyThemeToDom(resolved);
  if (typeof window !== "undefined") {
    localStorage.setItem(KEY, preference);
    localStorage.setItem(THEME_CHOSEN_KEY, "1");
    // "gl-theme" matches the "gl-" sync prefix, so this keeps the shared store
    // authoritative; the next boot's hydrate reads it back instead of reverting.
    syncLocalStorageItem(KEY, preference);
    // The native window paints before any of this runs, so the choice is also
    // handed to the main process for the NEXT launch's backgroundColor.
    // Without it a dark-mode learner gets a white flash on every start.
    try {
      (window as any).germDesktop?.setDesktopTheme?.(resolved);
    } catch {
      /* browser build, or an older desktop shell: nothing to tell */
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }
}

export const THEME_CHANGE_EVENT = "gl-theme-changed";

/**
 * Follow the OS while the preference is "system".
 *
 * Returns a cleanup function. Re-reads the preference on every change rather
 * than capturing it, so switching to Light or Dark stops the following without
 * needing the listener to be torn down and rebuilt.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  const onChange = () => {
    if (getThemePreference() !== "system") return;
    applyThemeToDom(systemTheme());
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
