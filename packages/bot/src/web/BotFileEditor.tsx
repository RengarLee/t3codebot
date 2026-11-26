import { useState } from "react";

import type { BotFile, BotFilePath } from "../contracts.ts";
import { readBotFile, saveBotFile } from "./apiClient.ts";
import type { BotTranslator } from "./i18n.ts";
import { SKILL_BUTTON_CLASS, SKILL_PRIMARY_BUTTON_CLASS } from "./skillUi.tsx";
import { skillErrorStatus, useSkillResource } from "./useSkillResource.ts";

export interface BotFileEditorProps {
  readonly botId: string;
  readonly path: BotFilePath;
  readonly label: string;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
}

type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

/** Edits one of a bot's markdown files. The bot writes these too, so saves are refused when stale. */
export function BotFileEditor({ botId, path, label, httpBaseUrl, t }: BotFileEditorProps) {
  const resource = useSkillResource(`${botId}:${path}`, () =>
    readBotFile(botId, path, { httpBaseUrl }),
  );
  const [saved, setSaved] = useState<BotFile | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const base = saved ?? resource.data?.file ?? null;
  if (base === null) {
    if (resource.error !== null) {
      return (
        <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <p role="alert" className="text-xs text-destructive">
            {t("bots.file.loadFailed")}
          </p>
          <button type="button" className={SKILL_BUTTON_CLASS} onClick={resource.reload}>
            {t("bots.file.retry")}
          </button>
        </div>
      );
    }
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">{t("bots.file.loading")}</p>
    );
  }

  const text = draft ?? base.content;
  const dirty = text !== base.content;
  const busy = saveState === "saving";

  const write = async (expectedVersion: string | null) => {
    setSaveState("saving");
    try {
      const { file } = await saveBotFile(
        { botId, path, content: text, expectedVersion },
        { httpBaseUrl },
      );
      setSaved(file);
      setDraft(null);
      setSaveState("saved");
    } catch (caught) {
      setSaveState(skillErrorStatus(caught) === 409 ? "conflict" : "failed");
    }
  };

  const keepMine = async () => {
    setSaveState("saving");
    try {
      const { file } = await readBotFile(botId, path, { httpBaseUrl });
      await write(file.version);
    } catch {
      setSaveState("failed");
    }
  };

  const loadLatest = () => {
    setSaved(null);
    setDraft(null);
    setSaveState("idle");
    resource.reload();
  };

  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <textarea
        aria-label={label}
        data-testid={`bot-file-editor-${path}`}
        spellCheck={false}
        value={text}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (saveState === "saved" || saveState === "failed") setSaveState("idle");
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (dirty && !busy && saveState !== "conflict") void write(base.version);
          }
        }}
        className="block min-h-48 w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-xs leading-normal text-foreground focus:border-ring focus:outline-none disabled:opacity-60"
      />
      {saveState === "conflict" ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-xs text-destructive">{t("bots.file.conflict")}</p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={SKILL_BUTTON_CLASS} onClick={loadLatest}>
              {t("bots.file.loadLatest")}
            </button>
            <button
              type="button"
              className={SKILL_PRIMARY_BUTTON_CLASS}
              onClick={() => void keepMine()}
            >
              {t("bots.file.keepMine")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          {saveState === "failed" ? (
            <span role="alert" className="mr-auto text-xs text-destructive">
              {t("bots.file.saveFailed")}
            </span>
          ) : saveState === "saved" && !dirty ? (
            <span className="mr-auto text-xs text-muted-foreground">{t("bots.file.saved")}</span>
          ) : null}
          <button
            type="button"
            className={SKILL_BUTTON_CLASS}
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(null);
              setSaveState("idle");
            }}
          >
            {t("bots.file.revert")}
          </button>
          <button
            type="button"
            data-testid={`bot-file-save-${path}`}
            className={SKILL_PRIMARY_BUTTON_CLASS}
            disabled={!dirty || busy}
            onClick={() => void write(base.version)}
          >
            {busy ? t("bots.file.saving") : t("bots.file.save")}
          </button>
        </div>
      )}
    </div>
  );
}
