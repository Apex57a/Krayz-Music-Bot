## What this PR does

Explain the change in plain terms. What broke, and how does this fix it? Or what feature does it add, and why does it belong in a music bot?

If this fixes an open issue, link it: Fixes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change (existing behavior changes in a way that requires migration)
- [ ] Refactor (behavior is identical, code is restructured)
- [ ] Documentation update

## How it works

Explain the technical approach. What files changed and why? If you considered alternative approaches and rejected them, say what they were and why. "I changed the code" is not an explanation. "I moved the cache invalidation from the command handler to the middleware because the handler was invalidating on every call regardless of whether the command succeeded" is an explanation.

## How to test

Step-by-step instructions so the reviewer can verify this without reading your mind:

1. Start the bot with `npm start`
2. Join a voice channel
3. Run `!p <query>`
4. Observe that ...

If you modified something that requires specific conditions (multiple users, concurrent commands, a cached track, a Spotify playlist), describe how to set those up.

## Checklist

Read the CONTRIBUTING.md before checking these boxes. If you check a box that is not true, the PR will be closed.

- [ ] `npx tsc` passes with zero errors. Not "zero errors that matter." Zero errors.
- [ ] Tested on a live Lavalink instance with actual audio playback. Not just "it compiles."
- [ ] Both slash and prefix versions of affected commands work.
- [ ] No `any` types added. If one was unavoidable, there is a comment explaining why.
- [ ] New commands use `CommandContext` and `withPlayerGuard`. Not inline DJ/voice/player checks.
- [ ] Track URLs in embeds use `getTrackDisplayUri(track)`, not `track.uri`. If you are not sure why, read the CONTRIBUTING.md section about it.
- [ ] `.env.example` updated if new environment variables were added.
- [ ] `scripts/init-db.js` updated if the database schema changed.
- [ ] No `console.log` / `console.error` / `console.warn` calls in `src/`. Use the logger.
- [ ] No unrelated formatting changes, IDE config files, or "while I was here" cleanups.
- [ ] Error handling uses `catch (err: unknown)` with proper type narrowing.
- [ ] Background async operations have `.catch()` handlers.
