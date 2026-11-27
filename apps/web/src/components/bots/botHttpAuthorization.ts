import type { BotHttpAuthorization } from "@t3tools/bot/web/apiClient";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentPresentations } from "../../state/presentation";
import { readPreparedConnection } from "../../state/session";

const COOKIE: BotHttpAuthorization = { _tag: "Cookie" };

const trimBase = (url: string) => url.replace(/\/+$/, "");

/**
 * Bot views name a server by its base URL; its prepared connection holds the credential.
 * T3 Connect's DPoP sessions are not wired, so bot views on those servers stay empty.
 */
export function readBotHttpAuthorization(httpBaseUrl: string | null): BotHttpAuthorization {
  if (httpBaseUrl === null) return COOKIE;
  const base = trimBase(httpBaseUrl);
  const environmentIds = appAtomRegistry.get(environmentPresentations.presentationsAtom).keys();
  for (const environmentId of environmentIds) {
    const prepared = readPreparedConnection(environmentId);
    if (prepared === null || trimBase(prepared.httpBaseUrl) !== base) continue;
    const authorization = prepared.httpAuthorization;
    return authorization?._tag === "Bearer"
      ? { _tag: "Bearer", token: authorization.token }
      : COOKIE;
  }
  return COOKIE;
}
