import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import {
  BOT_CLIENT_PREFERENCES_STORAGE_KEY,
  BotClientPreferencesSchema,
  DEFAULT_BOT_CLIENT_PREFERENCES,
  type BotClientPreferences,
} from "../contracts.ts";

const BOT_PREFERENCES_CHANGE_EVENT = "t3codebot:preferences_change";

const decodePreferences = Schema.decodeUnknownSync(
  Schema.fromJsonString(BotClientPreferencesSchema),
);
const encodePreferences = Schema.encodeSync(Schema.fromJsonString(BotClientPreferencesSchema));

const memoryStorage = new Map<string, string>();
const listeners = new Set<() => void>();

let cachedRaw: string | null | undefined;
let cachedSnapshot: BotClientPreferences = DEFAULT_BOT_CLIENT_PREFERENCES;

function readStorageItem(key: string): string | null {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  }
  return memoryStorage.get(key) ?? null;
}

function writeStorageItem(key: string, value: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      // Fall through to in-memory storage when localStorage is unavailable.
    }
  }
  memoryStorage.set(key, value);
}

function removeStorageItem(key: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(key);
      return;
    } catch {
      // Fall through to in-memory storage.
    }
  }
  memoryStorage.delete(key);
}

export function getBotClientPreferences(): BotClientPreferences {
  const raw = readStorageItem(BOT_CLIENT_PREFERENCES_STORAGE_KEY);
  if (raw === cachedRaw && cachedRaw !== undefined) {
    return cachedSnapshot;
  }
  cachedRaw = raw;
  if (raw === null) {
    cachedSnapshot = DEFAULT_BOT_CLIENT_PREFERENCES;
    return cachedSnapshot;
  }
  try {
    cachedSnapshot = decodePreferences(raw);
  } catch {
    cachedSnapshot = DEFAULT_BOT_CLIENT_PREFERENCES;
  }
  return cachedSnapshot;
}

function notifyPreferenceListeners(): void {
  cachedRaw = undefined;
  for (const listener of listeners) {
    listener();
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event(BOT_PREFERENCES_CHANGE_EVENT));
    } catch {
      // Ignore synthetic environments without Event dispatch support.
    }
  }
}

export function updateBotClientPreferences(
  patch: Partial<BotClientPreferences>,
): BotClientPreferences {
  const next: BotClientPreferences = {
    ...getBotClientPreferences(),
    ...patch,
  };
  const encoded = encodePreferences(next);
  writeStorageItem(BOT_CLIENT_PREFERENCES_STORAGE_KEY, encoded);
  cachedRaw = encoded;
  cachedSnapshot = next;
  notifyPreferenceListeners();
  return next;
}

export function resetBotClientPreferences(): void {
  removeStorageItem(BOT_CLIENT_PREFERENCES_STORAGE_KEY);
  cachedRaw = undefined;
  cachedSnapshot = DEFAULT_BOT_CLIENT_PREFERENCES;
  notifyPreferenceListeners();
}

export function subscribeBotClientPreferences(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === BOT_CLIENT_PREFERENCES_STORAGE_KEY) {
      cachedRaw = undefined;
      listener();
    }
  };
  const onLocalChange = () => {
    cachedRaw = undefined;
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(BOT_PREFERENCES_CHANGE_EVENT, onLocalChange);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BOT_PREFERENCES_CHANGE_EVENT, onLocalChange);
  };
}

export function useBotClientPreferences<T>(selector: (preferences: BotClientPreferences) => T): T {
  const preferences = useSyncExternalStore(
    subscribeBotClientPreferences,
    getBotClientPreferences,
    () => DEFAULT_BOT_CLIENT_PREFERENCES,
  );
  return selector(preferences);
}
