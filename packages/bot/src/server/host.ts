import * as Context from "effect/Context";

export interface BotServerHostShape {
  readonly stateDir: string;
}

/**
 * Thin host adapter for `@t3tools/bot` server routes.
 * Isolates server internals so migrating into T3 Code's native plugin system
 * only swaps the provider layer in `apps/server/src/server.ts`.
 */
export class BotServerHost extends Context.Service<BotServerHost, BotServerHostShape>()(
  "@t3tools/bot/server/host/BotServerHost",
) {}
