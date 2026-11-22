# Bot Module Plugin-Portability Rules

When adding or modifying Bot features in this repo (`packages/bot/`, `apps/web` Bots UI, `apps/server` bot hooks), always follow `packages/bot/AGENTS.md` and keep upstream edits within `scripts/bot-check-footprint.ts`:

1. **Thin Host Adapter**: Do not import private `apps/server/src/*` or `apps/web/src/*` internals inside `packages/bot/`. Depend on narrow injected host interfaces (`BotServerHost` / `BotWebHost`) rather than coupling to upstream internals or unstable experimental plugin SDK APIs.
2. **Schema-typed RPC Commands + Webhook HTTP**: Define all client-server bot operations as `effect/Schema`-typed command handlers (`method + input -> output`) in `packages/bot/` so they map directly to `host.commands.register` / `host.invoke` later; reserve raw HTTP routes under `/api/bots/*` for external IM webhooks and `/api/bots/health`.
3. **Clean Lifecycle & Dispose**: Manage every bot IM WebSocket, polling loop, timer, and event subscription with `Effect.Scope` or explicit `start()`/`stop()`/`dispose()` so enable/disable and hot reload leak nothing.
4. **UI in `packages/bot/src/web/`**: Build real Bot UI inside `packages/bot/src/web/` using injected host props/context (`locale`, `invoke`, navigation) and T3 CSS theme variables; keep `apps/web` Bot files as thin mounting wrappers.
5. **Server-Owned Business State & Secrets**: Store all bot configs, tokens/secrets (masked/write-only on read), status, and thread bindings on the server under isolated `<stateDir>/bots/` storage (`bots.sqlite` / `bots-config.json`), never in `statev2.sqlite`. Restrict `localStorage` (`packages/bot/src/web/preferences.ts`) to pure per-device UI preferences.
