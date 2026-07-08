# Contributing to Krayz Music

You want to contribute. That is appreciated, genuinely. But this is not a repository where every pull request gets merged because someone took the time to open it. I have standards, and they are not negotiable. Read this entire document before writing a single line of code. If your pull request ignores these guidelines, it will be closed without discussion.

## Before you start

Krayz is a music bot. It plays audio in Discord voice channels. That is the scope. If your contribution does not directly relate to audio playback, queue management, voice session handling, or the infrastructure that supports those things, it does not belong here.

Take a minute to understand the architecture before you start changing things. The bot runs two discord.js clients simultaneously through a routing layer. It uses Kazagumo on top of Shoukaku to manage Lavalink players. Database access is cached in memory. State is serialized to disk on shutdown. If you do not understand how these pieces interact, you are going to break something, and I am going to close your PR.

## What gets merged

Pull requests that solve real problems. Here is what qualifies:

- Bug fixes backed by a stack trace and clear reproduction steps. If you fix a race condition in the bot router where concurrent commands from different users in the same guild cause player assignment to fail, that is exactly the kind of thing I want to see.
- Performance improvements with measurable results. If you reduce memory consumption in the settings cache from 50 MB to 12 MB on a bot serving 200 guilds, show me the before and after heap snapshots and I will merge it the same day.
- Security patches. If you find an injection vector, an exposed credential path, or an unsafe `eval` call, fix it and open the PR. Do not post it in a public issue first.
- Dependency updates that fix known CVEs. Bump the version, confirm the bot still compiles, and note which CVE the update addresses.
- New audio-related features that make sense for a private, high-fidelity music bot. Examples: audio filters (bass boost, nightcore), seek functionality, playlist import/export, audio quality selection.

## What does not get merged

- Cosmetic documentation fixes. Correcting a typo in the README is not a contribution. If the typo causes genuine confusion (a wrong command name, a misleading configuration instruction), that is different. But reformatting a paragraph because you think it reads better is not worth my time or yours.
- Code style changes. I do not care that you prefer tabs over spaces, that you think `const` should be used instead of `let` in a specific loop, or that you would have structured the imports differently. Unless your style change fixes an actual bug or prevents one, do not submit it.
- Folder restructuring. The project structure exists for a reason. If you think `utils/music.ts` should be split into six files, you might be right, but open an issue and discuss it first. Do not show up with a 40-file PR that reorganizes everything and expect me to review it.
- Features unrelated to music. No economy systems. No moderation commands beyond what already exists. No leveling, no XP, no reaction roles, no ticket systems, no welcome messages. I do not care how well you wrote it. It does not belong here.
- "Refactoring" that changes syntax without changing behavior. Rewriting a `for` loop as a `.reduce()` call does not make the code better. It makes it different. If the refactor does not fix a bug, improve performance, or resolve a type safety issue, leave the code alone.

## Submitting a pull request

If your contribution passes the filters above, follow this process:

### 1. Fork and branch

Fork the repository and create a branch from `main`. Name your branch something descriptive. `fix/router-race-condition` is a good branch name. `my-changes` is not.

### 2. Write the code

Match the existing code style. The project uses TypeScript with strict mode enabled. Every file compiles under `strict: true`, which means no implicit `any`, no unchecked nulls, and no sloppy type assertions without justification. If you add a new file, it needs to compile cleanly under the same rules.

Use the project's logger (`src/utils/logger.ts`) for all diagnostic output. Do not use `console.log`, `console.error`, or `console.warn` anywhere in the `src/` directory. The logger pipes structured output through pino to both the console and a log file. Raw console calls bypass this entirely and will not appear in production logs.

If you introduce a workaround for a Discord API quirk, a Lavalink bug, or a Kazagumo limitation, leave a comment explaining why the workaround exists. Future contributors (and future me) should not have to reverse-engineer your intent from the code alone.

### 3. Compile and test

Run `npm run build` before pushing. If the TypeScript compiler throws errors, your PR is not ready. Do not open it hoping I will fix the type errors for you.

Test under realistic conditions. If you modified the bot router, verify that hot-swapping between clients works when multiple users run commands at the same time. If you changed the state manager, restart the bot mid-song and confirm the queue restores correctly. If you touched the database layer, test with both a local MySQL instance and the expected production target (TiDB Cloud with SSL).

### 4. Write a real description

Your pull request description should explain three things:

1. What the problem is and how you discovered it.
2. How your change fixes it, including the approach you chose and any alternatives you considered and rejected.
3. What edge cases exist and how you tested for them.

If your description is empty, or if it says "fixed a bug" with no further context, the PR will be closed.

## Bug reports

Check the existing issues before opening a new one. Duplicate reports waste everyone's time.

A valid bug report includes:

- The full error stack trace, copied directly from the console or log file. Do not paraphrase the error. Do not screenshot the terminal. Copy the text.
- Step-by-step reproduction instructions. "It crashed" is not a reproduction step. "I ran /play with a Spotify playlist URL containing 500 tracks while another user was running /skip in the same channel" is a reproduction step.
- Your Node.js version (run `node -v`).
- Your Lavalink version and the Java version running it.
- Whether you are using one bot client or two (i.e., whether `WORKER_TOKEN` is set).

### What is not a bug report

The issue tracker is not a help desk. It is not a Discord support server. It is not a place to ask questions about how to configure your hosting panel.

Issues about the following topics will be closed and locked without a response:

- Setup problems caused by misconfigured credentials, missing environment variables, or incorrect Node.js/Java versions.
- Lavalink refusing to start because of a bad `application.yml` or an incompatible Java installation.
- Questions about how Discord bot tokens work, what intents are, or why the bot needs the Message Content intent.
- Feature requests for non-music functionality.
- Requests for video tutorials, guided setup calls, or one-on-one debugging sessions.

I realize this sounds harsh. It is meant to. The issue tracker needs to stay clean so actual bugs are visible and actionable. If you need general help with Discord bot development, there are communities for that. This repository is not one of them.

## Code standards

There is no formal linting configuration enforced in CI, but there are expectations:

- All code compiles under `strict: true` TypeScript with zero errors.
- No `console.log` calls in the `src/` directory. Use `logger.info`, `logger.warn`, `logger.error`, `logger.debug`, or `logger.fatal`.
- No unused imports or dead code left in commits. If you commented something out for debugging, remove it before pushing.
- No `any` types unless absolutely necessary, and if you use one, leave a comment explaining why the type system cannot express what you need.
- Error handling uses proper type narrowing (`err instanceof Error ? err.message : String(err)`), not `(err as any).message`.
- Functions stay small. If a function exceeds 50 lines, consider whether it is doing too many things.
- SQL queries use parameterized `pool.execute()` calls. No string concatenation or template literal interpolation in SQL. Ever.

## License

By submitting a pull request, you agree that your contribution is licensed under the same MIT license that covers the rest of the project. You retain copyright over your code, but you grant the project maintainer an irrevocable, royalty-free license to use, modify, and distribute it.
