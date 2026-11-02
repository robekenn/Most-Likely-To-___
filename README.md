# Most Likely

A phone-friendly “Who is most likely to…?” game for 2–15 friends. Vanilla HTML/CSS/JavaScript, Node.js server functions, and Upstash Redis. No runtime npm dependencies.

## Play locally

Install Node.js 22 or newer. Open a terminal in this folder:

```sh
npm run dev
```

Open http://localhost:3000. Use different browser profiles, a private window, or separate phones for different players. Tabs in the same browser share one player identity. For phones on the same Wi-Fi, visit `http://YOUR-COMPUTER-LAN-IP:3000`; allow Node through your firewall. Copy invitations from the address that your friends can reach, not localhost. The development server listens on all interfaces.

Without Redis variables, local games use memory and disappear on server restart. The deployed Vercel function never falls back to memory.

## Deploy your GitHub repository to Vercel

1. Create your GitHub repository, then add the contents of this folder to its root. `package.json`, `api/`, and `public/` must be at that root. Do not upload `dist/` or credentials.
2. In Vercel, import the repository. Select **Other** for the framework. Build command: `npm run build`. Output directory: `dist`. `vercel.json` includes both settings. Use Node.js 22 or newer. Leave the install command at its default.
3. Create an Upstash Redis database through the Vercel Marketplace or your Upstash account. Use a database region near your Vercel functions.
4. Connect the Upstash database to this project for Production (and Preview if desired). The Marketplace integration automatically provides `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the game supports directly. No copying or exposing credentials is necessary. Alternatively, add these **server-side** environment variables using the database’s REST credentials:

   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

   Use the read/write token, not a read-only token. A complete `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` pair takes precedence over the Marketplace pair. URL and token values from different pairs are never mixed. Never put credentials in `public/`, GitHub, or browser JavaScript.
5. Deploy (or redeploy after adding variables). Open the deployed HTTPS URL.
6. Before inviting everyone, use two separate devices: create a room, join, select two rounds, vote once each round, refresh one device, and reveal both results. Verify earlier picks are disabled and ties show every winner.

If guests encounter a Vercel sign-in gate, review your project's deployment protection settings and use the production URL with the audience you intend. Do not share preview URLs that require team membership.

Vercel runs `api/game.js` as a Node function. Redis stores shared room state independently of function instances. This avoids relying on persistent WebSocket servers or process memory in production. Clients poll every two seconds, pausing when the page is hidden. At 15 active players, polling produces roughly 450 API requests/minute plus game actions; each poll runs a rate-limit script and a room read. Check your providers' quotas before a long event.

Official references:
- https://vercel.com/docs/functions/runtimes/node-js
- https://upstash.com/docs/redis/features/restapi

## Rules implemented

- 2–15 players, including the playing host.
- Six-character random lobby code and shareable join URL.
- Lobby membership locks at game start. Names must be unique, 1–24 characters.
- Host chooses 1–N rounds, where N is the player count.
- Self-voting is allowed. Each voter may choose each person at most once across the entire game. Other voters have their own independent restrictions.
- 250 family-friendly prompts, shuffled server-side. The same lobby remembers questions across replays and uses unseen prompts first. After the pool runs out, it refills without duplicating questions inside a game. A new lobby starts a new question history.
- Everyone gets the same prompt. Choose a player, then tap **Lock in my vote**. You can change your selection before locking it; a locked vote cannot be changed.
- The last vote advances the round automatically. The host can close a stuck round; absent votes are omitted rather than fabricated. Skipped votes do not use up a pick.
- Results remain hidden until voting finishes and the host reveals them one at a time. All tied winners are shown. A round with no votes has no winner.
- Everyone sees the host's current reveal. Previously revealed results can be reviewed.
- Play again returns the same group to the lobby and clears all picks.
- Host can remove players before starting. During play, use close-round for missing players.
- A device's random player token is saved in browser local storage for reconnection. Clearing storage, changing browsers, or using a new phone loses that identity. There is no host transfer; the host must return using the same browser to control the game.
- Rooms expire 24 hours after creation, even if replayed.

## Structure

| Path | Purpose |
| --- | --- |
| `public/index.html` | Page shell and rules dialog |
| `public/style.css` | Responsive visual design |
| `public/app.js` | Lobby, voting, reconnecting, and reveals |
| `api/game.js` | Authenticated HTTP actions and conflict retries |
| `lib/game.js` | Authoritative rules and privacy-filtered views |
| `lib/store.js` | Redis REST storage, atomic compare-and-swap, expiry, rate limiting |
| `lib/prompts.js` | Edit or add prompts here |
| `server.mjs` | Local development server |
| `test/game.test.js` | Game and API integration tests |
| `vercel.json` | Vercel build settings and security headers |

## Verify and maintain

```sh
npm test
npm run build
```

The build syntax-checks browser JavaScript before copying static assets. Tests cover 15-player capacity, concurrent joins and votes, host authorization, invalid requests, duplicate names, unique prompts, self-votes, repeat-pick rejection, vote immutability, stale actions, secret results, ties, majorities, zero-vote rounds, reconnects, and replay.

The Redis write uses a Lua compare-and-swap on room revision to prevent lost votes when different function instances update a room simultaneously. Creation uses `SET NX`; writes preserve the 24-hour TTL. Views never send player secrets, individual ballots, future prompts, or unrevealed results. Player tokens are random 256-bit bearer credentials, stored as hashes in room records. Names are escaped before display. The API applies a shared Redis-backed IP request limit; this is basic protection for friend-group use, not a complete public-service abuse prevention system.

Completed verification: local game/API tests and build; desktop browser rendering and lobby creation/reconnection. Production Vercel routing and live Upstash credentials have not been tested because those accounts are not connected. Physical-phone and production two-device smoke tests remain necessary after deployment.

## Interaction polish

Lobby joins update the guest list without replacing the host's round selector. During voting, other players' status updates preserve your pick and keyboard focus. Pick a player first, then confirm with the sticky lock-in button. Clear loading states prevent duplicate clicks, and failed requests keep form entries and selections available for retry.

Invite sharing uses the phone's native share sheet when available, with copy-link and manual-copy fallbacks. Confirmation dialogs handle leaving or closing a round. Results include short reveal animations, optional vote breakdowns, and a history of earlier results. All animation respects reduced-motion preferences. Reconnection pauses in background tabs and backs off during connection failures.

## Game modes

The host chooses a mode when creating a lobby. The choice stays fixed for that lobby, including replays, so guests always know what they joined. Create a new lobby to choose a different mode.

- **Family Friendly:** 250 all-ages prompts, including the original pool.
- **Extra Judgmental:** 250 sharper, clean roasts about habits and everyday quirks; no explicit content.
- **Adults Only:** 250 prompts with profanity, drinking, dating, and non-graphic sexual humor. This is the only explicit pool. The host and every new player must confirm they are 18 or older. This is a self-confirmation, not identity verification.

Guests look up a lobby code and review its mode before joining. Public previews contain mode and player count, not player identities, questions, or votes. The server validates modes and adult confirmations. Each lobby keeps replay history for its chosen pool; pools never mix. Existing lobbies default to Family Friendly.

Shared mode labels are in `public/game-modes.js`; the three actual prompt pools stay server-side. Add questions to `lib/prompts.js`, `lib/judgmental-prompts.js`, or `lib/adults-prompts.js` and keep each mode count in sync with its catalog.
