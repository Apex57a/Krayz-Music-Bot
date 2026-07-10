---
name: Bug report
about: Something is broken. Not "I do not understand the setup instructions" broken. Actually broken.
title: ''
labels: bug
assignees: ''

---

Read the support policy in the README before filling this out. If your issue is about misconfigured credentials, a missing Java installation, or not knowing what a Lavalink node is, it will be closed without a response.

**What happened**

Describe the bug. Be specific. "It crashed" is not specific.

**Steps to reproduce**

Write out the exact sequence of events. "I ran /play with a Spotify playlist URL containing 500 tracks while another user was running /skip in the same channel" is a reproduction step. "It does not work" is not.

1. 
2. 
3. 

**What you expected**

What should have happened instead.

**What actually happened**

Paste the exact error message, embed content, or behavior. Screenshots are acceptable for visual bugs. For error messages, copy the text. Do not screenshot your terminal.

**Full error stack trace**

Copy-paste this directly from the bot console or log file. Do not paraphrase it. Do not summarize it. The full trace, or I cannot help you.

```
paste the complete stack trace here
```

**Lavalink console output**

If the issue is audio-related (no sound, stuttering, playback exceptions, "track stuck"), paste what the Lavalink console says around the time of the failure.

```
paste lavalink logs here
```

**Environment**

Fill in all of these. Not some. All.

- OS: (e.g., Ubuntu 22.04, Windows 11, whatever your hosting panel runs)
- Node.js version: (run `node -v`)
- Java version: (run `java -version`)
- Lavalink version: (check the Lavalink startup banner)
- Bot version: (run `/stats` or check `package.json`)
- Number of worker bots configured: 
- Is 24/7 mode enabled in the affected guild: yes / no
- Is a dedicated music channel configured: yes / no

**Additional context**

Anything else. Did this work in a previous version? Did you recently change anything in `.env` or `application.yml`? Are you running on shared hosting with 512 MB of RAM and wondering why things are slow?
