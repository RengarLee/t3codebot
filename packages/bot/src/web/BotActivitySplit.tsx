import { useRef, useState, type ReactNode } from "react";
import { createBotTranslator } from "./i18n.ts";
import { updateBotClientPreferences, useBotClientPreferences } from "./preferences.ts";

export function BotActivitySplit({
  map,
  conversation,
  locale,
}: {
  readonly map: ReactNode;
  readonly conversation: ReactNode;
  readonly locale: string | undefined;
}) {
  const savedRatio = useBotClientPreferences((preferences) => preferences.activityMapRatio);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointer: number;
    startY: number;
    startHeight: number;
    ratio: number | null;
  } | null>(null);
  const ratio = dragRatio ?? savedRatio ?? 0.28;
  const t = createBotTranslator(locale);
  const resize = (pixels: number) => {
    const height = (host.current?.clientHeight ?? 0) - 8;
    if (height <= 0) return ratio;
    return Math.max(
      Math.min(0.4, 112 / height),
      Math.min(1 - Math.min(0.5, 160 / height), pixels / height),
    );
  };
  const cancel = () => {
    drag.current = null;
    setDragRatio(null);
  };
  return (
    <div
      ref={host}
      className="grid min-h-0 flex-1 overflow-hidden"
      style={{
        gridTemplateRows: `minmax(min(112px, 40%), ${ratio}fr) 8px minmax(min(160px, 50%), ${1 - ratio}fr)`,
      }}
    >
      <div className="flex min-h-0 flex-col overflow-hidden">{map}</div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("bots.sessions.resize")}
        aria-description={t("bots.sessions.resizeHint")}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        className="group relative z-10 -my-1 flex cursor-row-resize touch-none select-none items-center justify-center outline-none focus-visible:bg-primary/15"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            startY: event.clientY,
            startHeight: host.current?.firstElementChild?.getBoundingClientRect().height ?? 0,
            ratio: null,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current?.pointer !== event.pointerId) return;
          current.ratio = resize(current.startHeight + event.clientY - current.startY);
          setDragRatio(current.ratio);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          if (drag.current.ratio !== null) {
            updateBotClientPreferences({ activityMapRatio: drag.current.ratio });
          }
          cancel();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onDoubleClick={() => updateBotClientPreferences({ activityMapRatio: undefined })}
        onKeyDown={(event) => {
          const height = host.current?.firstElementChild?.getBoundingClientRect().height ?? 0;
          const next =
            event.key === "ArrowUp"
              ? height - 16
              : event.key === "ArrowDown"
                ? height + 16
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? (host.current?.clientHeight ?? 0)
                    : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          updateBotClientPreferences({ activityMapRatio: resize(next) });
        }}
      >
        <span
          aria-hidden
          className="h-0.5 w-8 rounded-full bg-border group-hover:bg-primary/70 group-focus-visible:bg-primary"
        />
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden">{conversation}</div>
    </div>
  );
}
