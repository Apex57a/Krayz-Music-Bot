# Contributing to Krayz Music

If you want to contribute code to this project, read this document first. I appreciate pull requests that fix bugs or add meaningful features, but I am very strict about what gets merged. I will reject any pull request that ignores these guidelines without a second thought.

## What I will accept

I am looking for contributions that solve actual problems. Good examples include:
- Fixing reproducible bugs in the audio pipeline, Kazagumo event listeners, or the multi-bot routing system.
- Optimizing MySQL database calls or reducing memory footprints in the cache layer.
- Updating dependencies to patch security vulnerabilities.
- Adding features that make sense for a large-scale, private music bot architecture.

## What I will reject

Do not submit pull requests for the following:
- Minor typographical fixes in the documentation or logging strings.
- Changing the code formatting, restructuring folders, or altering linting rules to fit your personal preference.
- Adding features that have nothing to do with audio playback. This is a dedicated music bot. I will not merge your economy system, your moderation commands, or your leveling tracker.
- "Refactoring" code simply because you prefer a different syntax. Unless your refactor provides a tangible performance improvement or fixes an architectural flaw, leave the code alone.

## Submitting a Pull Request

If you have a feature or fix that aligns with the rules above, follow this process:

1. Fork the repository and create your working branch from `main`.
2. Ensure your code actually compiles. Run `npm run build` locally before pushing. If the TypeScript compiler throws errors, do not open the pull request. It is a waste of everyone's time.
3. Test your changes under realistic conditions. If you modify the `botRouter`, you must verify that hot-swapping between `clientA` and `clientB` still functions correctly when multiple users invoke commands concurrently. 
4. Write a clear, detailed description of what the pull request does. Explain the problem, how you fixed it, and what edge cases you considered. If your description is empty, the pull request will be closed.

## Bug Reports

If you find a bug, check the issue tracker first to ensure it has not already been reported. 

When opening a new issue, you must include:
- The exact error stack trace pulled directly from the console.
- Step-by-step instructions to reproduce the crash.
- The specific version of Node.js and Lavalink you are running.

As stated in the README, the issue tracker is not a help desk. Do not open issues asking for setup help, explaining that you do not know how to install MongoDB, or complaining that your Lavalink node refuses to start because of a bad Java version. Those issues will be closed and locked without explanation.

## Code Style

I do not enforce a strict formatting guide, but you need to match the tone and structure of the existing codebase. Keep functions small. If you introduce a complex block of logic or a strange workaround for a Discord API limitation, leave a comment explaining exactly why it is necessary. Do not leave commented-out dead code, `console.log` debug traces, or unused imports in your commits.
