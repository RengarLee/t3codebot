<p align="center">
  <img src="../packages/bot/brand/steward-web-icon-192x192.png" width="80" height="80" alt="Steward logo" />
</p>

<h1 align="center">Steward</h1>

<p align="center">A coding-agent desktop app with a resident bot.</p>

> [!IMPORTANT]
> Steward is an **unofficial** fork based on the [T3 Code](https://github.com/pingdotgg/t3code) source code. It is not affiliated with, endorsed by, or maintained by T3 Tools, Inc.

Steward is T3 Code's desktop app plus one resident bot. The bot has its own Home thread, persona, and memory. When a task comes in, it opens threads in your projects and hands the work to helper bots.

## Install

Steward ships for **Windows x64** only.

1. Download `Steward-<version>-x64.exe` from [Releases](https://github.com/RengarLee/t3codebot/releases).
2. Run it. Steward installs as its own app, next to T3 Code if you have it.
3. Steward updates itself from this repository's releases.

You also need one coding agent installed and signed in, for example [Claude Code](https://claude.com/product/claude-code) (`claude auth login`) or [Codex CLI](https://developers.openai.com/codex/cli) (`codex login`).

## Using it with T3 Code

Steward and T3 Code share the same data folder, `~/.t3`. Threads you create in one show up in the other.

- **Run one app at a time.** Both apps lock the data folder, so close one before you open the other.
- **Use T3 Code Nightly.** Steward follows T3 Code's nightly builds and can upgrade the shared database. Older T3 Code releases may not open it afterwards.
- **Back up before the first launch.** Copy `~/.t3/userdata/statev2.sqlite` somewhere safe before you open Steward for the first time.

## What is different from T3 Code

- **No T3 account or T3 Connect.** Steward does not sign in to T3's services. To reach it from another device, connect over your local network or Tailscale.
- **No usage analytics.** Steward sends no usage data.

## License

The source code is MIT licensed. See [LICENSE](../LICENSE). It keeps the original T3 Code copyright notice. The T3 Code name, logos, and icons belong to T3 Tools, Inc. and are not part of that license (see [TRADEMARK.md](../TRADEMARK.md)).
