# Multi-turn threads

A user sends several messages to one thread and each prompt plays the next recorded turn.

## Sub-features

- `turn-next` sends a follow-up to an existing thread.
- `turn-history` keeps earlier turns visible in order.

## How to get to it (user POV)

- Send another message in the same thread's composer.
- Run `t3 thread send <thread-id> <message>`.

## Driving it with the t3 CLI and the Browser panel

Not yet driven. Preconditions: baseline from [README.md](README.md).

- **Start.** `thread start --base-dir "$H" --provider devReplay --model multi-turn --wait "$W" "first"`.
- **Follow up.** `thread send --base-dir "$H" <thread-id> "second"` (check `thread send --help` for `--wait`).
- **Proof.** `thread show --messages 10` lists both user messages and a distinct assistant reply per turn; `db-summary.mjs` shows `ordinal` 1 and 2 for the thread.

## Gotchas

- A busy thread queues the message as its next turn; nothing is interrupted. Wait for `completed` before asserting turn 2.
