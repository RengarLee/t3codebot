# T3 Code verification map

This directory is the maintained source for verifying user-facing T3 Code behavior. Read this index, then the matching feature file.

## Baseline preconditions

- A server started by this run on a scratch home, per [SKILL.md](../SKILL.md#launch). `doctor.mjs` reports `READY`.
- Fixture project `verify-fixture` added at the scratch workspace (a `git init` directory holding `README.md`).
- Provider `devReplay` (`Replay (dev)`) available. It exists only in `vp run dev` servers.
- Never drive an instance this run did not start.

## Driving conventions

- Prefer the CLI for state changes and the Browser panel for what the user sees. Use ARIA names and visible text over coordinates where the snapshot exposes them.
- Run each recipe from a fresh thread unless the recipe says otherwise.
- Number artifacts in `$E` and name the feature id.

## Proof and skip reporting

- CLI proof: the command, stdout, and exit code.
- UI proof: a screenshot plus a `preview_wait_for` on rendered text.
- Mutation proof: `db-summary.mjs` output as a second view.
- Report an unreachable path with the attempted command and the unmet precondition.

## Features

| Feature                           | File                                                     | Status                        |
| --------------------------------- | -------------------------------------------------------- | ----------------------------- |
| Agent turn on the Replay provider | [agent-turn.md](agent-turn.md)                           | Driven (CLI, UI, database)    |
| Approvals and questions           | [approvals-and-questions.md](approvals-and-questions.md) | Mapped, not yet driven        |
| Multi-turn threads                | [multi-turn.md](multi-turn.md)                           | Mapped, not yet driven        |
| Projects and thread list          | [projects-and-threads.md](projects-and-threads.md)       | Driven (CLI), UI sidebar seen |
| Pairing and sign-in               | [pairing.md](pairing.md)                                 | Driven (web pair URL)         |
