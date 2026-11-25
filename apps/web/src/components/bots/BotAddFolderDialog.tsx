import type { BotAddFolderDialogRenderProps } from "@t3tools/bot/web/BotsSettingsView";
import { createBotTranslator } from "@t3tools/bot/web/i18n";
import {
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId } from "@t3tools/contracts";
import { FolderIcon } from "lucide-react";
import { useId, useState } from "react";

import { useEnvironments } from "../../state/environments";
import { filesystemEnvironment, useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { getEnvironmentBrowsePlatform } from "../CommandPalette.logic";
import { resolveTrackedFolderInput } from "../settings/trackedFolders.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const BROWSE_SUGGESTION_LIMIT = 100;

export interface BotAddFolderDialogHostProps extends BotAddFolderDialogRenderProps {
  readonly locale: string | undefined;
  readonly environmentId: EnvironmentId | null;
  readonly onPickFolder?: (() => Promise<string | null>) | undefined;
}

/**
 * Reuses T3's `ProjectRepositoriesSettings` Add-folder dialog with live server filesystem browsing
 * plus an optional native folder picker on desktop-local environments.
 */
export function BotAddFolderDialog({
  bot,
  locale,
  environmentId,
  busy,
  error,
  onClearError,
  onAdd,
  onClose,
  onPickFolder,
}: BotAddFolderDialogHostProps) {
  const t = createBotTranslator(locale);
  const inputId = useId();
  const { environments } = useEnvironments();
  const environment =
    environmentId === null
      ? undefined
      : environments.find((entry) => entry.environmentId === environmentId);
  const platform = getEnvironmentBrowsePlatform(environment?.serverConfig?.environment.platform.os);
  const access = useFilesystemReadAccess(environmentId);
  const canBrowse = environmentId !== null && access.canReadFiles;
  const separator = bot.path.includes("\\") ? "\\" : "/";
  const workspaceRoot = `${bot.path.replace(/[\\/]+$/, "")}${separator}workspace`;

  const [query, setQuery] = useState(() => {
    const firstExisting = bot.workingFolders[0];
    if (firstExisting) {
      return getBrowseParentPath(firstExisting) ?? ensureBrowseDirectoryPath(firstExisting);
    }
    return "~/";
  });
  const [isPicking, setIsPicking] = useState(false);

  const browsePath = getFilesystemBrowsePath(query, platform, canBrowse);
  const browseQuery = useEnvironmentQuery(
    environmentId !== null && browsePath.isBrowsing && browsePath.directoryPath.length > 0
      ? filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: browsePath.directoryPath, cwd: workspaceRoot },
        })
      : null,
  );
  const { visibleEntries, exactEntry } = filterFilesystemBrowseEntries(
    browseQuery.data?.entries ?? [],
    browsePath.filterQuery,
  );
  const resolvedFolder = resolveTrackedFolderInput({
    query,
    listedDirectoryPath: browseQuery.data?.parentPath ?? null,
    exactEntryPath: exactEntry?.fullPath ?? null,
  });
  const parentPath = browsePath.canBrowseUp ? browsePath.parentPath : null;
  const hiddenCount = Math.max(0, visibleEntries.length - BROWSE_SUGGESTION_LIMIT);
  const disabled = busy || isPicking;

  const submitPath = async (targetPath: string) => {
    const ok = await onAdd(targetPath);
    if (ok) onClose();
  };

  const handleNativeBrowse = async () => {
    if (!onPickFolder || disabled) return;
    setIsPicking(true);
    const picked = await onPickFolder().finally(() => {
      setIsPicking(false);
    });
    if (picked) {
      setQuery(picked);
      await submitPath(picked);
    }
  };

  const rowClassName =
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (resolvedFolder && !disabled) {
              void submitPath(resolvedFolder.path);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("bots.folders.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("bots.folders.dialogDescription")}</DialogDescription>
            <div className="flex flex-col gap-2 pt-1">
              <Label htmlFor={inputId}>{t("bots.folders.pathLabel")}</Label>
              <Input
                id={inputId}
                font="mono"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("bots.folders.placeholder")}
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  if (error !== null) onClearError();
                }}
              />
              {error !== null ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogHeader>
          <DialogPanel>
            <div className="-mx-2 flex min-h-40 flex-col">
              {parentPath !== null ? (
                <button
                  type="button"
                  className={rowClassName}
                  onClick={() => {
                    setQuery(parentPath);
                    if (error !== null) onClearError();
                  }}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  {".."}
                </button>
              ) : null}
              {visibleEntries.slice(0, BROWSE_SUGGESTION_LIMIT).map((entry) => (
                <button
                  key={entry.fullPath}
                  type="button"
                  className={rowClassName}
                  onClick={() => {
                    setQuery(appendBrowsePathSegment(browsePath.directoryPath, entry.name));
                    if (error !== null) onClearError();
                  }}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{entry.name}</span>
                </button>
              ))}
              {browseQuery.error ? (
                <p role="alert" className="px-2 py-1.5 text-sm text-muted-foreground">
                  {browseQuery.error}
                </p>
              ) : browseQuery.isPending && browseQuery.data === null ? (
                <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
                  {t("bots.folders.loading")}
                </p>
              ) : hiddenCount > 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {`${hiddenCount} · ${t("bots.folders.moreHint")}`}
                </p>
              ) : !canBrowse ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  {t("bots.folders.cannotBrowse")}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            {onPickFolder !== undefined ? (
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                className="me-auto"
                onClick={() => void handleNativeBrowse()}
              >
                {t("bots.folders.browse")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={disabled} onClick={onClose}>
              {t("bots.folders.cancel")}
            </Button>
            <Button type="submit" disabled={resolvedFolder === null || disabled}>
              {t("bots.folders.addButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
