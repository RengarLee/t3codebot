# Bot standing-memory eval

Uses the production review prompt, JSON schema and standing-instructions template. Cases originate in the B-design acceptance request: shared Chinese preference extraction, subsequent response language, assistant-only claims, synthetic password and one-time requests.

Run from the repository root:

```powershell
$env:CODEX_EVAL_CLI = 'absolute/path/to/@openai/codex/bin/codex.js'
node packages/bot/evals/run.ts --model gpt-5.4-mini --samples 3 --out C:/temp/bot-memory-results
```

Uses the already authenticated official Codex CLI without editing its configuration. CODEX_EVAL_CLI is optional on systems where the codex executable can be launched directly. Each sample starts an ephemeral read-only session outside the repository. No mocks. Cost uses the CLI subscription; monetary cost is unavailable.

Flags: --out required; --model; --samples (default 3); repeatable --case; --baseline path/to/results.json. Results contain raw final answers and pass/fail; review.md includes the earlier results for manual comparison on the same model. A case fails when at least half its samples fail. The command conservatively exits nonzero on any failed sample.

Preference extraction requires a user-scoped add mentioning Chinese. Controls require zero operations. Reading memory requires more than 20 Chinese characters; inspect the captured answer for actual correctness. These are narrow behavior checks, not proof of general semantic understanding. Add cases to the data array with their acceptance source; do not copy the production prompt. CLI or schema failures are reported as failures, never model passes.

Deterministic persistence proof:

```powershell
vp test run packages/bot/src/server/memoryBehavior.test.ts
```

This uses real temporary bots.sqlite and files, applies review lifecycle output, generates another bot's AGENTS through the production reader/template, restores the initial revision, and preserves a manual shared preference against a delayed review.
