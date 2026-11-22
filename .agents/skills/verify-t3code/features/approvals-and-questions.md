# Approvals and questions

An agent pauses a run to ask the user to approve a write or answer a question, and the run resumes with the answer. Replay scenarios `approval` and `question` record these.

## Sub-features

- `approval-prompt` shows a write approval request for the `approval` scenario.
- `question-prompt` shows an elicitation for the `question` scenario.
- `answer-resume` resumes the run after the user answers.

## How to get to it (user POV)

- Pick `Replay (dev)` with model `approval` or `question` in the composer and send a message.
- From the CLI, start a thread with `--model approval` or `--model question`.

## Driving it with the t3 CLI and the Browser panel

Not yet driven. Preconditions: baseline from [README.md](README.md).

- **Start.** `thread start --base-dir "$H" --provider devReplay --model approval --wait "$W" "write"`. `--wait` exits 2 when the run waits for an answer, which is the signal that the request reached the server.
- **Answer.** Open the thread in the Browser panel and answer the pending request in the UI. Record the real control names from the first `preview_snapshot`; none are mapped yet.
- **Proof.** After answering, `thread show` reports `completed` and `db-summary.mjs` shows the run `completed`.

## Gotchas

- Exit code 2 from `--wait` is success for this feature's first step, not a failure.
- Unmapped: the exact accessible names of the approve and answer controls. Fill them in after the first run.
