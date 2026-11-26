import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { createBotTranslator } from "./i18n.ts";
import { layoutSessionTree, sessionConnector } from "./sessionTree.ts";
import { useBotSessions } from "./useBotSessions.ts";
import { BotActivitySplit } from "./BotActivitySplit.tsx";

export interface BotSessionControlProps {
  readonly kind: "open" | "back" | "in" | "out" | "fit" | "more";
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}
export interface BotSessionsPanelProps {
  readonly homeThreadId: ThreadId;
  readonly httpBaseUrl: string | null | undefined;
  readonly locale: string | undefined;
  readonly revision: string;
  readonly renderStatus: (thread: OrchestrationV2ThreadShell) => ReactNode;
  readonly botName: (thread: OrchestrationV2ThreadShell) => string;
  readonly onOpen: (thread: OrchestrationV2ThreadShell) => void;
  readonly Control: ComponentType<BotSessionControlProps>;
}

const activityPositions = new Map<string, { top: number; count: number }>();

export function BotActivityPanel(
  props: Omit<BotSessionsPanelProps, "onOpen"> & {
    readonly resolveThread: (thread: OrchestrationV2ThreadShell) => OrchestrationV2ThreadShell;
    readonly renderConversation: (
      thread: OrchestrationV2ThreadShell,
      onClose: () => void,
    ) => ReactNode;
  },
) {
  const [activity, setActivity] = useState<{
    root: OrchestrationV2ThreadShell;
    selected: OrchestrationV2ThreadShell;
  } | null>(null);
  const t = createBotTranslator(props.locale);
  if (activity === null) {
    return <BotSessionsPanel {...props} onOpen={(root) => setActivity({ root, selected: root })} />;
  }
  const root = props.resolveThread(activity.root);
  const selected = props.resolveThread(activity.selected);
  const back = () => setActivity(null);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bot-activity-detail">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <props.Control kind="back" label={t("bots.sessions.back")} onClick={back} />
        <span className="min-w-0 truncate text-sm font-medium">{root.title}</span>
      </div>
      <BotActivitySplit
        locale={props.locale}
        map={
          <BotSessionMap
            {...props}
            root={root}
            selectedThreadId={selected.id}
            onOpen={(thread) => setActivity({ root, selected: thread })}
          />
        }
        conversation={
          <>
            <div className="shrink-0 truncate border-b border-border px-3 py-2 text-xs font-medium">
              {selected.title}
            </div>
            {props.renderConversation(selected, back)}
          </>
        }
      />
    </div>
  );
}

export function BotSessionsPanel(props: BotSessionsPanelProps) {
  const t = createBotTranslator(props.locale);
  const formatTime = new Intl.DateTimeFormat(props.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const query = useBotSessions(
    { parentThreadId: props.homeThreadId, descendants: false },
    props.httpBaseUrl,
    props.revision,
  );
  const viewKey = props.httpBaseUrl + ":" + props.homeThreadId;
  const restore = useRef(activityPositions.get(viewKey) ?? null);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const sessions = query.data?.sessions ?? [];
  const rememberPosition = () => {
    if (restore.current !== null || list.current === null) return;
    activityPositions.delete(viewKey);
    activityPositions.set(viewKey, { top: list.current.scrollTop, count: sessions.length });
    if (activityPositions.size > 20) {
      const oldest = activityPositions.keys().next().value;
      if (oldest !== undefined) activityPositions.delete(oldest);
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reload previously viewed history pages before restoring the activity list's scroll viewport
  useEffect(() => {
    const saved = restore.current;
    if (
      saved !== null &&
      query.data !== null &&
      sessions.length < saved.count &&
      query.data.hasMore &&
      !query.error
    ) {
      void query.loadMore();
    }
  }, [query, sessions.length]);
  const firstId = sessions[0]?.thread.id;
  const lastId = sessions.at(-1)?.thread.id;
  const previousEdges = useRef<{ firstId: string | undefined; lastId: string | undefined }>({
    firstId: undefined,
    lastId: undefined,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronize the scroll viewport with appended/prepended server pages without moving readers browsing history
  useLayoutEffect(() => {
    const element = list.current;
    if (
      element === null ||
      (previousEdges.current.firstId === firstId && previousEdges.current.lastId === lastId)
    )
      return;
    if (restore.current !== null) {
      if (sessions.length < restore.current.count && query.data?.hasMore) return;
      element.scrollTop = restore.current.top;
      restore.current = null;
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
      previousEdges.current = { firstId, lastId };
      return;
    }
    previousEdges.current = { firstId, lastId };
    if (anchor.current !== null) {
      element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (atBottom.current) element.scrollTop = element.scrollHeight;
  }, [firstId, lastId, sessions.length, query.data, list, previousEdges]);
  const more = async () => {
    const element = list.current;
    if (element !== null) anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    if (!(await query.loadMore())) anchor.current = null;
  };
  return (
    <div data-testid="bot-sessions" className="flex min-h-0 flex-col">
      <div className="px-3 py-2 text-sm font-medium">{t("bots.sessions.title")}</div>
      <div
        ref={list}
        className="max-h-[min(40rem,65dvh)] overflow-y-auto overscroll-contain px-3 pb-2"
        onScroll={() => {
          const element = list.current;
          if (element !== null)
            atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
          rememberPosition();
        }}
      >
        {query.data?.hasMore ? (
          <div className="flex justify-center py-2">
            {
              <props.Control
                {...{
                  kind: "more",
                  label: t("bots.sessions.older"),
                  onClick: () => {
                    void more();
                  },
                  disabled: query.pending,
                }}
              />
            }
          </div>
        ) : null}
        {query.error ? (
          <p role="alert" className="py-2 text-xs text-destructive">
            {t("bots.sessions.error")}
            {
              <props.Control
                {...{
                  kind: "more",
                  label: t("bots.sessions.retry"),
                  onClick: () => {
                    void query.loadMore(true);
                  },
                }}
              />
            }
          </p>
        ) : query.data === null ? (
          <p role="status" className="py-2 text-xs text-muted-foreground">
            {t("bots.sessions.loading")}
          </p>
        ) : sessions.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">{t("bots.overview.noSessions")}</p>
        ) : null}
        {sessions.map(({ thread }) => (
          <div
            key={thread.id}
            className="relative ml-1 border-l border-border pl-4 pb-3"
            data-testid="bot-session-row"
          >
            <span
              aria-hidden
              className="absolute -left-1 top-1.5 size-2 rounded-full border border-border bg-background"
            />
            <time
              dateTime={DateTime.formatIso(thread.createdAt)}
              className="block pt-0.5 text-xs text-muted-foreground"
            >
              {formatTime.format(DateTime.toEpochMillis(thread.createdAt))}
            </time>
            <div className="flex items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => {
                  rememberPosition();
                  props.onOpen(thread);
                }}
                className="min-w-0 flex-1 cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block truncate text-sm font-medium">{thread.title}</span>
                <span className="text-xs text-muted-foreground">{props.botName(thread)}</span>
              </button>
              {props.renderStatus(thread)}
              {
                <props.Control
                  {...{
                    kind: "open",
                    label: t("bots.sessions.open"),
                    onClick: () => {
                      rememberPosition();
                      props.onOpen(thread);
                    },
                  }}
                />
              }
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BotSessionMap(
  props: BotSessionsPanelProps & {
    readonly root: OrchestrationV2ThreadShell;
    readonly selectedThreadId: ThreadId;
  },
) {
  const t = createBotTranslator(props.locale);
  const query = useBotSessions(
    { parentThreadId: props.root.id, descendants: true },
    props.httpBaseUrl,
    props.revision,
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 600, height: 260 });
  const [manualView, setManualView] = useState<{
    key: string;
    position: { x: number; y: number; scale: number };
  } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    view: { x: number; y: number; scale: number };
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const entries = [
    { parentThreadId: props.homeThreadId, thread: props.root },
    ...(query.data?.sessions ?? []),
  ];
  const layout = layoutSessionTree(
    props.homeThreadId,
    entries.map((s) => ({ id: s.thread.id, parentId: s.parentThreadId })),
    width < 480,
  );
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  const sessions = new Map(entries.map((entry) => [entry.thread.id as string, entry.thread]));
  const fitScale = Math.min(1, (width - 24) / layout.width, (height - 24) / layout.height);
  const fitX = (width - layout.width * fitScale) / 2;
  const fitY = (height - layout.height * fitScale) / 2;
  const geometryKey = `${width}:${height}:${layout.width}:${layout.height}`;
  const view =
    manualView?.key === geometryKey ? manualView.position : { scale: fitScale, x: fitX, y: fitY };
  const setView = useCallback(
    (
      update:
        | { x: number; y: number; scale: number }
        | ((previous: { x: number; y: number; scale: number }) => {
            x: number;
            y: number;
            scale: number;
          }),
    ) => {
      setManualView((previous) => {
        const current =
          previous?.key === geometryKey ? previous.position : { scale: fitScale, x: fitX, y: fitY };
        return {
          key: geometryKey,
          position: typeof update === "function" ? update(current) : update,
        };
      });
    },
    [geometryKey, fitScale, fitX, fitY],
  );
  const fit = () => setManualView(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- track the actual canvas size for responsive graph layout
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zoom = useCallback(
    (factor: number, point = { x: width / 2, y: height / 2 }) =>
      setView((previous) => {
        const scale = Math.max(0.2, Math.min(2.5, previous.scale * factor)),
          ratio = scale / previous.scale;
        return {
          scale,
          x: point.x - (point.x - previous.x) * ratio,
          y: point.y - (point.y - previous.y) * ratio,
        };
      }),
    [width, height, setView],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- non-passive wheel listener prevents browser zoom only for canvas pinch/Ctrl-wheel
  useEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.01), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom]);
  const highlighted = new Set<string>();
  if (focus !== null) {
    let current: string | null = focus;
    while (current !== null && !highlighted.has(current)) {
      highlighted.add(current);
      current = nodes.get(current)?.parentId ?? null;
    }
    const descendants = [focus];
    for (const id of descendants)
      for (const node of layout.nodes)
        if (node.parentId === id && !highlighted.has(node.id)) {
          highlighted.add(node.id);
          descendants.push(node.id);
        }
  }
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border/60"
      aria-label={t("bots.sessions.map")}
    >
      <div
        ref={viewport}
        tabIndex={0}
        role="group"
        aria-label={t("bots.sessions.canvas")}
        className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-background/50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.5px)",
          backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest("button"))
          )
            return;
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.pointer === event.pointerId)
            setView({
              ...start.view,
              x: start.view.x + event.clientX - start.x,
              y: start.view.y + event.clientY - start.y,
            });
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoom(1.25);
          } else if (event.key === "-") {
            event.preventDefault();
            zoom(0.8);
          } else if (event.key === "0") {
            event.preventDefault();
            fit();
          }
        }}
      >
        <div
          className="absolute origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="pointer-events-none absolute"
            aria-hidden
          >
            {layout.nodes.flatMap((node) => {
              const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
              if (parent === undefined) return [];
              const line = sessionConnector(parent, node, width < 480);
              return [
                <g
                  key={node.id}
                  className={
                    focus !== null
                      ? highlighted.has(node.id) && highlighted.has(parent.id)
                        ? "text-primary"
                        : "text-muted-foreground opacity-20"
                      : "text-muted-foreground/65"
                  }
                >
                  <path d={line.path} stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <path d={line.arrow} fill="currentColor" />
                </g>,
              ];
            })}
          </svg>
          {layout.nodes.map((node) => {
            const thread = sessions.get(node.id);
            const style = { left: node.x, top: node.y, width: node.width, height: node.height };
            if (thread === undefined)
              return (
                <div
                  key={node.id}
                  style={style}
                  className="absolute flex items-center justify-center rounded-full border border-foreground/25 bg-background text-xs font-medium"
                >
                  Home
                </div>
              );
            return (
              <button
                key={node.id}
                type="button"
                style={style}
                aria-pressed={thread.id === props.selectedThreadId}
                onClick={() => props.onOpen(thread)}
                onPointerEnter={() => setFocus(node.id)}
                onPointerLeave={() => setFocus(null)}
                onFocus={() => setFocus(node.id)}
                onBlur={() => setFocus(null)}
                className={`absolute flex cursor-pointer flex-col justify-center gap-1 rounded-lg border bg-background px-3 text-left outline-none hover:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring ${thread.id === props.selectedThreadId ? "border-primary ring-1 ring-inset ring-primary" : "border-foreground/25"} ${focus !== null && !highlighted.has(node.id) ? "opacity-40" : ""}`}
              >
                <span className="truncate text-xs font-medium">{thread.title}</span>
                <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{props.botName(thread)}</span>
                  {props.renderStatus(thread)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border/40 px-2 py-1.5">
        {query.error ? (
          <span role="alert" className="mr-auto text-xs text-destructive">
            {t("bots.sessions.error")}
          </span>
        ) : null}
        {query.data?.hasMore || query.error ? (
          <props.Control
            {...{
              kind: "more",
              label: t("bots.sessions.more"),
              disabled: query.pending,
              onClick: () => {
                void query.loadMore(query.error);
              },
            }}
          />
        ) : null}
        {
          <props.Control
            {...{
              kind: "out",
              label: t("bots.sessions.zoomOut"),
              onClick: () => zoom(0.8),
            }}
          />
        }
        {
          <props.Control
            {...{
              kind: "in",
              label: t("bots.sessions.zoomIn"),
              onClick: () => zoom(1.25),
            }}
          />
        }
        {<props.Control {...{ kind: "fit", label: t("bots.sessions.fit"), onClick: fit }} />}
      </div>
    </section>
  );
}
