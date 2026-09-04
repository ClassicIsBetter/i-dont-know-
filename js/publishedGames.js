// ===========================================================
// publishedGames.js — platform games, loaded from the /games directory
// instead of being hardcoded in JS.
//
// To publish a new game: export a project as JSON (World Editor →
// Export, or just take a saved project's JSON), drop the file in
// /games/, and add its filename to /games/index.json. That's the whole
// workflow — no code changes. See README.md section "Publishing games"
// for details.
//
// Each file is a project-shaped object (same schema saveSystem.js
// exports/imports), fetched once and cached. Every player loads the same
// static files, so — same as the old hardcoded demos — these games are
// identical for everyone, which is what makes them work over multiplayer.
// ===========================================================
const MANIFEST_URL = 'games/index.json';

let _cache = null;    // resolved array, once loaded
let _loading = null;  // in-flight promise, so concurrent callers share one fetch

export async function loadPublishedGames() {
  if (_cache) return _cache;
  if (_loading) return _loading;

  _loading = (async () => {
    let filenames = [];
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      filenames = await res.json();
      if (!Array.isArray(filenames)) throw new Error('index.json is not a list of filenames');
    } catch (e) {
      console.warn(`[Blockverse] Could not load ${MANIFEST_URL} — no published games will show. (This is expected if you're opening index.html directly rather than through a local server — fetch() needs http(s), not file://.)`, e);
      _cache = [];
      return _cache;
    }

    const games = [];
    for (const filename of filenames) {
      try {
        const res = await fetch(`games/${filename}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data || typeof data !== 'object' || !data.project_id || !Array.isArray(data.world)) {
          throw new Error('missing project_id or world[] — not a valid project export');
        }
        // 'builtin' keeps these non-editable/non-deletable in the UI (same
        // role the old hardcoded demos played), even though they now come
        // from a file rather than JS code.
        games.push({ ...data, builtin: true, sourceFile: filename });
      } catch (e) {
        console.warn(`[Blockverse] Skipping games/${filename} — ${e.message}`, e);
      }
    }
    _cache = games;
    return _cache;
  })();

  return _loading;
}

// Synchronous accessor for anything that runs after loadPublishedGames()
// has already resolved once (ui.js awaits it at boot).
export function getPublishedGames() {
  return _cache || [];
}

export function getPublishedGame(id) {
  return getPublishedGames().find(g => g.project_id === id) || null;
}
