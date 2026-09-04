# Blockverse

A small, original, self-contained voxel game platform built with **Three.js** —
a blocky third-person avatar, a physics-lite movement controller, a
collision-aware orbit camera, a working world editor (explorer, gizmos,
properties, safe scripting), a local save/load/publish pipeline, and a
`/games` directory of playable places — drop a project's JSON in and it's
on the platform, no code changes needed (see section 6).

Not affiliated with, endorsed by, or connected to Roblox Corporation. All
code, art direction, and audio here are original and generated at runtime —
there are no external image/audio assets and no copied Roblox code.

---

## 1. Run it locally

Because the app uses native ES modules (`<script type="module">`) and an
import map, it must be served over `http://`, not opened directly as a
`file://` URL (browsers block module imports from the filesystem).

Pick any of these from the project root (the folder with `index.html`):

```bash
# Python 3 (built into most systems)
python3 -m http.server 8080

# Node (no install needed)
npx serve .

# Node, alternative
npx http-server . -p 8080
```

Then open **http://localhost:8080** in a modern desktop browser (Chrome,
Edge, or Firefox — WebGL2 required). No build step, no `npm install`.

## 2. Deploy to GitHub Pages

1. Create a new GitHub repository and push this folder's contents to it
   (make sure `index.html` sits at the repo root, or in `/docs` if you
   prefer that layout).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a
   branch**, pick your branch (e.g. `main`) and the `/ (root)` folder
   (or `/docs`).
4. Save. GitHub will publish the site at
   `https://<your-username>.github.io/<repo-name>/` within a minute or two.

Three.js itself is loaded from a CDN (`unpkg.com`) via an import map in
`index.html`, so there's nothing to bundle or vendor in.

---

## 3. Controls

| Action | Input |
|---|---|
| Move | `W A S D` |
| Jump | `Space` |
| Sprint | `Shift` |
| Look around | Mouse (click the game to lock the pointer) |
| Zoom camera | Scroll wheel |
| Toggle first-person | `F`, or the Settings checkbox |
| Attack (sword arena) | Left click |
| Fire rocket (demolition) | Left click |
| Open chat | `Enter`, `T`, or `/` |
| Send / cancel chat | `Enter` / `Escape` |
| Pause / menu | `Escape` |
| **Editor:** orbit camera | Right-click drag |
| **Editor:** fly camera | `W A S D` (hold `Shift` to move faster) |
| **Editor:** select tool | `Q` |
| **Editor:** move / rotate / scale tool | `G` / `R` / `B` |
| **Editor:** duplicate | `Ctrl+D` |
| **Editor:** delete | `Delete` |
| **Editor:** undo / redo | `Ctrl+Z` / `Ctrl+Y` |

On phones and tablets (any touch-primary device), play mode automatically
shows an on-screen joystick (bottom-left, movement), a drag-to-look layer
over the rest of the canvas, and buttons for jump, sprint, first-person,
attack/fire, chat, and pause. The site's menus (Home, Create, Avatar,
Settings) are also responsive down to phone-sized screens. The World
Editor itself is still desktop-oriented — its gizmo-based tools assume a
mouse — though its panels resize to stay usable on a phone in a pinch.

---

## 4. Project structure

```
/project
    index.html              # shell: all screens, import map, canvas
    /css
        style.css            # dark "voxel workshop" theme, all screens
    /games
        index.json            # manifest — filenames of published games
        *.json                  # one project-shaped file per published game
    /js
        main.js               # boot, audio, mini avatar viewers, GameSession
        utils.js               # small shared helpers + event bus
        avatar.js               # blocky avatar hierarchy, cosmetics, animation
        player.js                # third-person controller + collision
        camera.js                 # collision-aware orbit camera
        world.js                   # object/material system, lighting, starter map
        editor.js                   # select/move/rotate/scale, explorer, gizmos
        scripting.js                 # SAFE JSON event/action scripting layer
        saveSystem.js                 # LocalStorage save/load/export/import
        publishedGames.js              # fetches /games (see section 6)
        ui.js                           # screen navigation, cards, avatar page
    /assets                            # (empty — everything is procedural)
```

## 5. How the pieces fit together

- **Avatar** (`avatar.js`) builds a real parent/child rig — torso → head,
  arm, and leg pivots — so cosmetics (hats, hair, accessories) attach
  properly and procedural animation (`AvatarAnimator`) rotates limbs
  around shared joints instead of moving disconnected boxes.
- **World** (`world.js`) is a flat list of plain-JSON object records (type,
  transform, size, material, color, scripts). `World` keeps a live
  `THREE.Mesh` in sync with each record, and the whole list is what gets
  saved, exported, or handed to a demo game.
- **Player** (`player.js`) integrates gravity and camera-relative
  acceleration, then resolves collisions against the world's collidable
  meshes with an axis-separated box test and a downward ground sample
  (with a small step-height allowance so stairs and curbs are walkable).
- **Camera** (`camera.js`) is a spherical orbit rig around the player's
  chest with a collision raycast that pulls the camera in when a wall
  gets between it and the player, plus a first-person mode that just
  shrinks the distance to near-zero and hides the avatar mesh.
- **Editor** (`editor.js`) adds Three.js's `TransformControls` gizmo on
  top of the same `World`, plus an Explorer tree, a Properties panel bound
  directly to each object's JSON record, and an undo/redo stack of world
  snapshots.
- **Scripting** (`scripting.js`) is intentionally *not* `eval`-based.
  Creators attach small JSON rule lists to objects
  (`{"event": "onTouch", "actions": [...]}`); a fixed interpreter runs a
  whitelisted set of actions (`showMessage`, `addScore`, `teleportPlayer`,
  `setCheckpoint`, `spawnObject`, `destroyObject`, …). No arbitrary code
  from a saved project ever executes as JavaScript.
- **Save system** (`saveSystem.js`) stores projects as JSON in
  `localStorage`, with explicit Export (download `.json`) and Import
  (load from a file) so projects are portable even without a backend.
- **Accounts** (`account.js`, `accountUI.js`) are username/password,
  backed by a Supabase project you provide — see section 7 below for the
  one-time setup. Everything else (projects, avatar config while signed
  out, settings) still lives in `localStorage` and doesn't need an account.
- **Physics** (`physics.js`) wraps [cannon-es](https://github.com/pmndrs/cannon-es)
  for real rigid-body debris — scoped to games with `mode: "demolition"`
  rather than every game, and kept fully separate from the player's own
  movement collision (which is unaffected and still the simple AABB system
  above). Collidable parts register as static bodies on load; an explosion
  converts anything in its radius to a dynamic body with an outward impulse,
  and each frame the moved/rotated body position is written back onto the
  ordinary Three.js mesh — which is also why the player's existing collision
  automatically treats settled debris as solid, with no extra code needed.
- **Multiplayer & chat** (`multiplayer.js`) run over the same Supabase
  project as accounts, using Realtime — Presence for who's in a room, and
  Broadcast for frequent position updates and chat messages. Neither is
  written to the database; it's all ephemeral, in-memory-on-the-server
  message passing. A "room" is keyed by `project_id`, so anyone playing
  the same game lands together — no lobby/matchmaking step. Works for
  guests too (a stable per-device guest name is generated locally),
  doesn't require signing in. See the limitations note in section 8 about
  what this does and doesn't sync.

## 6. Publishing games (the `/games` directory)

Platform games live as plain JSON files in `/games`, not hardcoded in JS —
publishing a new one is a file-copy, not a code change.

1. **Get a project as JSON.** Either export one from the World Editor
   (Editor menu → Export, downloads a `.json`), or hand-write/adapt one —
   the file is just a project record: `project_id`, `name`, `description`,
   `creator`, `icon`, `world` (array of objects), `scripts` (global event
   rules), and `settings`. The exact same shape `saveSystem.js` already
   saves/exports/imports.
2. **Drop the file in `/games/`.** Filename doesn't matter beyond being
   unique and ending in `.json`.
3. **Add the filename to `/games/index.json`** — it's just a JSON array:
   ```json
   [
     "better-starter-place.json",
     "your-new-game.json"
   ]
   ```
4. Reload. The game now shows up on the Home screen and in "My Games",
   playable and (via `mode` in its JSON) eligible for the sword/demolition
   modes like any other project — see section 5 above for what `mode`
   does. It also works over multiplayer automatically, since every player
   fetches the same static file.

Removing a game is the same in reverse — delete its line from
`index.json` (and the file itself, if you want it gone entirely).

Worth knowing: this only works served over `http(s)://`, same as the rest
of the app (see section 1) — `fetch()` can't read `/games/index.json`
from a `file://` page. If `index.json` is missing or a listed file fails
to parse, that one game is silently skipped (with a console warning) —
it won't break the rest of the platform.

## 7. Setting up accounts (Supabase)

Accounts are optional — without this setup, the Account screen just says
so and the rest of Blockverse works exactly as before.

1. Create a free project at [supabase.com](https://supabase.com).
2. In your new project, go to **Authentication → Providers → Email** and
   turn **off** "Confirm email". Blockverse signs people up with a
   synthetic email address (`username@blockverse.local`) since Supabase
   Auth is built around emails but Blockverse only wants a username —
   there's no real inbox behind that address, so email confirmation would
   permanently block sign-in if left on.
3. Go to the **SQL Editor** and run:
   ```sql
   create table public.profiles (
     id uuid references auth.users on delete cascade primary key,
     username text unique not null,
     avatar_config jsonb,
     created_at timestamptz default now()
   );

   alter table public.profiles enable row level security;

   create policy "Profiles are publicly readable"
     on public.profiles for select
     using (true);

   create policy "Users can insert their own profile"
     on public.profiles for insert
     with check (auth.uid() = id);

   create policy "Users can update their own profile"
     on public.profiles for update
     using (auth.uid() = id);
   ```
4. While you're in the SQL Editor, also run this to enable friending
   (Home screen → Friends):
   ```sql
   create table public.friendships (
     id bigint generated always as identity primary key,
     requester_id uuid references auth.users on delete cascade not null,
     addressee_id uuid references auth.users on delete cascade not null,
     status text not null default 'pending' check (status in ('pending','accepted')),
     created_at timestamptz default now(),
     unique (requester_id, addressee_id)
   );

   alter table public.friendships enable row level security;

   create policy "See friendships you're part of"
     on public.friendships for select
     using (auth.uid() = requester_id or auth.uid() = addressee_id);

   create policy "Send a friend request"
     on public.friendships for insert
     with check (auth.uid() = requester_id and requester_id <> addressee_id);

   create policy "Only the addressee can accept a request"
     on public.friendships for update
     using (auth.uid() = addressee_id)
     with check (auth.uid() = addressee_id);

   create policy "Either side can remove, decline, or cancel"
     on public.friendships for delete
     using (auth.uid() = requester_id or auth.uid() = addressee_id);
   ```
   Skipping this step is fine — the Friends panel just won't load anything
   until the table exists.
5. Go to **Settings → API** and copy the **Project URL** and the
   **`anon` `public`** key into `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
6. Reload — the Account screen will now let people sign up and sign in.

Worth knowing: because sign-in uses a synthetic email under the hood,
"forgot password" email flows won't work out of the box (there's no real
inbox to send to). Fine for now — that's explicitly out of scope for this
first pass. This setup was written carefully but not verified against a
live Supabase project in the environment this was built in, so if
something doesn't line up when you connect a real project, it's likely a
small property-naming or policy tweak away — let me know what error you
see and I can help fix it.

## 8. Known simplifications

This is a small platform, not a full game engine — a few things are
deliberately simplified rather than left as placeholders:

- Collision uses axis-aligned bounding boxes (rotated parts still collide,
  but using their axis-aligned bounds), which is a common simplification
  for browser-scale voxel games.
- "Anchored" is stored per-object but every part is currently static —
  there's no dynamic/physics-driven falling yet; it's there so a future
  physics pass has somewhere to read from.
- The Sandbox demo opens straight into the World Editor (it *is* the
  "freely buildable area" — the editor's add/move/scale tools are the
  building tools) rather than a separate creative-mode input scheme.
- Scripting covers a fixed action set rather than a general-purpose
  language, by design (see above) — it's meant to be safe and easy to
  expand, not Turing-complete.
- The Roblox importer only reads the `.rbxlx` XML export (not the binary
  `.rbxl` format), only imports basic geometry/spawns/models/proximity
  prompts, and doesn't preserve original Roblox materials — only color,
  position, size, and transparency carry over.
- Friending (Home screen) is request/accept based — send a request via
  the search box, the other person accepts it, you're friends. There's no
  "online now" indicator yet (that would need a global presence channel
  in addition to per-game presence); the list just shows who you're
  friends with.
- Rigid-body physics (`physics.js`) only runs in games with
  `mode: "demolition"` set in their project JSON — it's not yet a
  general Studio toggle any project can turn on, and there's no
  line-of-sight check on blast radius (a wall takes an explosion's force
  same as anything else in range, even shielding the room behind it).
- Multiplayer syncs players, not worlds. Published games (`/games`) are
  identical for every player, so multiplayer works fully there. A custom
  project only lives in its creator's LocalStorage — other players
  joining that room will see each other move around, but the actual
  building/objects will only match if everyone happens to have loaded an
  identical copy of that
  project. There's also no player-vs-player collision yet (you can walk
  through other players), and chat has a length cap but no real
  moderation/filtering beyond that.


Enjoy building.
