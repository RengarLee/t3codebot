# Projects and thread list

Projects are workspace roots; threads hang under them. The sidebar groups threads by project and shows their status.

## Sub-features

- `project-add` registers a workspace directory.
- `thread-list` lists a project's threads, newest first.
- `sidebar-status` shows a thread's title and `Done` badge under its project.

## How to get to it (user POV)

- Add a project from the sidebar's folder icon (web), or `t3 project add <path>`.
- Read threads in the sidebar, or `t3 thread list --project <path>`.

## Driving it with the t3 CLI and the Browser panel

Preconditions: baseline from [README.md](README.md).

- **Add.** `node apps/server/src/bin.ts project add --base-dir "$H" --title verify-fixture "$W"` prints `Added project <id> (verify-fixture) at <path>.`
- **List.** After a turn, `thread list --base-dir "$H" --project "$W"` prints one line per thread.
- **UI.** Snapshot the Browser panel: the sidebar shows `verify-fixture`, thread `go`, and `Done`.

## Gotchas

- The added path prints in Windows short form (`RENGAR~1`) when the scratch dir comes from `os.tmpdir()`; compare by project id.
- Projects added from the CLI appear in an already-open client without a reload.
