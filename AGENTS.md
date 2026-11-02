# Project guidance

- Keep this project deployable on Vercel using the root `api/game.js` function and static `dist` output.
- Production state belongs in Redis, never instance memory. Local memory is strictly a development option.
- Enforce all rules in `lib/game.js`; client-disabled buttons are not authorization.
- Preserve atomic writes, secret-filtered views, game/round guards, host checks, and 15-player limit.
- Preserve the rule that each voter can choose each person only once per game. Self-votes are allowed and rounds are limited to player count.
- Add meaningful tests when changing rules or concurrency. Run `npm test` and `npm run build`.
- Never commit real .env files or Redis tokens.
- Keep mobile tap targets at least 44px where possible; preserve keyboard focus and reduced-motion behavior.
- Do not push to main without explicit user authorization; use a feature branch and PR for future changes.
