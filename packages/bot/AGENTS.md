# Bot Module (`@t3tools/bot`) Agent Guidelines

This repository is a fork of T3 Code (`pingdotgg/t3code`) that adds Bot capabilities while staying low-conflict with upstream stable syncs and ready to migrate into T3 Code's upcoming native plugin system (tracked around `pingdotgg/t3code#40222`) without a rewrite.

All bot work must stay inside `packages/bot/` (and bot-owned files allowed by `scripts/bot-check-footprint.ts`) and follow these five plugin-portability rules:

## 1. Depend on a thin Host Adapter, not upstream internals

- Never import private implementation files from `apps/server/src/*` or `apps/web/src/*` inside `packages/bot/`.
- Define narrow host interfaces (`BotServerHost`, `BotWebHost`) inside `packages/bot/` for everything the bot needs from T3 Code: state directory, RPC/HTTP registration, orchestration event subscriptions (`OrchestrationV2StoredEvent`), thread/turn dispatch, locale, and navigation.
- Do **not** couple to experimental upstream plugin SDK internals while `#40222` is unstable. Keep upstream glue in `apps/server` / `apps/web` to minimal adapter wiring so migrating to T3's final `ServerPluginHost` / `WebPluginHost` only replaces the thin adapter entry.

## 2. Design client-server APIs as Schema-typed RPC commands; keep HTTP for external webhooks

- Model all bot operations (CRUD, start/stop, status, connection tests, thread bindings) as `effect/Schema`-typed command handlers (`method + input -> output`) in `packages/bot/src/contracts.ts` and `packages/bot/src/server/`.
- In this fork, expose those commands through the single `/api/bots/*` mount in `packages/bot/src/server/http.ts`; reserve raw HTTP routes for external IM platform webhooks (Feishu, DingTalk, Telegram, Slack, etc.) and `/api/bots/health`.
- When migrating to T3's plugin system, the same commands plug straight into `host.commands.register` / `host.invoke` with built-in auth, remote tunnel, and multi-environment routing.

## 3. Make every bot connection and background worker cleanly disposable

- T3's plugin architecture treats hot reload and dynamic enable/disable as first-class behavior.
- Manage all IM WebSocket clients, long-polling loops, timers, and event subscriptions via `Effect.Scope` or explicit `start()` / `stop()` / `dispose()` lifecycles.
- Disabling, restarting, or hot-reloading a bot module must leave zero leaked sockets, duplicate message handlers, or orphaned timers.

## 4. Keep Bot UI inside `packages/bot/src/web/` with injected host dependencies

- Implement real Bot views (bot lists, channel config forms, bindings, logs) inside `packages/bot/src/web/` rather than growing components in `apps/web/src/components/`.
- Pass host-provided dependencies (`locale`, `invoke`/API client, navigation, or minimal host UI primitives) via props or context instead of importing `apps/web` internal modules directly.
- Style UI with Tailwind and T3's CSS theme variables (`--background`, `--foreground`, `--border`, `--primary`, etc.) so `packages/bot/src/web/` can bundle cleanly as a standalone plugin web entry.
- Keep `apps/web` files (`BotsSettingsPanel.tsx`, `SidebarBotsBar.tsx`, route files) as thin wrappers only.

## 5. Keep all business state and secrets on the server; `localStorage` is for local UI prefs only

- Store all bot definitions, tokens/app secrets, enable states, and project/thread routing rules on the server under isolated `<stateDir>/bots/` storage (`bots.sqlite` / `bots-config.json`), never in upstream `statev2.sqlite` migrations.
- Treat tokens/secrets as write-only or masked on read—never echo raw secrets back to clients.
- Use client `localStorage` (`packages/bot/src/web/preferences.ts`) strictly for per-device view state (e.g., whether the sidebar Bots section is expanded). This keeps desktop, web, remote, and future mobile clients consistent on one server state.

## Verification

- Always keep upstream edits within `scripts/bot-check-footprint.ts` budgets and run `node scripts/bot-check-footprint.ts` after changes.
