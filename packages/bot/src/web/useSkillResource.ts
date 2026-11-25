import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import { BotApiRequestError } from "./apiClient.ts";

const isRequestError = Schema.is(BotApiRequestError);

type Settled<T> =
  | { readonly key: string; readonly token: string; readonly data: T; readonly error: null }
  | { readonly key: string; readonly token: string; readonly data: null; readonly error: unknown };

export interface SkillResource<T> {
  /** The last result for the current `key`; it stays on screen while a reload is in flight. */
  readonly data: T | null;
  readonly error: unknown;
  readonly loading: boolean;
  readonly reload: () => void;
}

/** Loads one server resource per `key` and again on `reload()`. A newer request wins over an older one. */
export function useSkillResource<T>(key: string, load: () => Promise<T>): SkillResource<T> {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const token = `${key}#${version}`;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches server data for the selected skill; the result lands in state once the request settles
  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setSettled({ key, token, data, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ key, token, data: null, error });
      },
    );
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `load` closes over `key`; the token alone decides when to fetch
  }, [token]);

  const current = settled !== null && settled.key === key ? settled : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: settled === null || settled.token !== token,
    reload: () => setVersion((value) => value + 1),
  };
}

export function skillErrorStatus(error: unknown): number | null {
  return isRequestError(error) ? error.status : null;
}
