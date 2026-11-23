import * as Schema from "effect/Schema";

import {
  BOT_SESSION_RECEIPT_JSON_SCHEMA,
  BOT_SUB_BOT_SPEC_JSON_SCHEMA,
  type BotSummary,
} from "../contracts.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export interface BotTemplateInput {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly inScope: ReadonlyArray<string>;
  readonly outOfScope: ReadonlyArray<string>;
  readonly persona: string;
  /** Folders whose projects the bot may hand code work to. */
  readonly projects: ReadonlyArray<string>;
  readonly createdAt: string;
}

/** Every file a new bot starts with, by path relative to its folder. */
export function renderBotFiles(input: BotTemplateInput): ReadonlyArray<readonly [string, string]> {
  return [
    ["bot.yaml", renderBotYaml(input)],
    ["SOUL.md", renderSoul(input)],
    ["POLICY.md", renderPolicy(input.name)],
    [
      "LESSONS.md",
      `# LESSONS: ${input.name}\n\nRules learned from the user's corrections, one per line: \`L-001: <rule> (why)\`.\n`,
    ],
    [
      "memory/long-term.md",
      "# Long-term memory\n\nFacts about the user and this work that stay true across sessions. Keep it under 200 lines.\n",
    ],
    ["memory/daily/.gitkeep", ""],
    [
      "skills/README.md",
      "# Skills\n\nOne procedure per `skills/<name>/SKILL.md`. Add or change one only with the user's OK.\n",
    ],
    ["workspace/outputs/.gitkeep", ""],
    ["workspace/CLAUDE.md", "@AGENTS.md\n"],
  ];
}

function renderBotYaml(input: BotTemplateInput): string {
  return [
    "# The folder name is the bot id; name can change freely.",
    `id: ${encodeJson(input.id)}`,
    `name: ${encodeJson(input.name)}`,
    `version: "0.1.0"`,
    `status: "active" # active | paused | archived`,
    `summary: ${encodeJson(input.summary)}`,
    `in_scope: ${encodeJson(input.inScope)}`,
    `out_of_scope: ${encodeJson(input.outOfScope)}`,
    `projects: ${encodeJson(input.projects)}`,
    `created_at: ${encodeJson(input.createdAt)}`,
    "runtime:",
    `  session_mode: "fresh_per_run"`,
    "",
  ].join("\n");
}

function renderSoul(input: BotTemplateInput): string {
  const persona =
    input.persona.trim() ||
    `You are ${input.name}. ${input.summary}`.trim() ||
    `You are ${input.name}.`;
  return `# SOUL: ${input.name}

## Who you are
${persona}

## How you talk
- Calm and direct, like a senior chief of staff, not a customer-service bot.
- Lead with the conclusion, then the key evidence, then the next step. Prefer short lists.
- Reply in the user's language.

## Principles
1. Verify before you speak. When unsure, check, or say you don't know.
2. Save the user's attention: bring a recommendation, not a half-finished question.
3. Stay in scope. Hand off work outside it instead of doing it badly.

## Never
- Open with filler such as "Happy to help!".
- Ask the user to confirm the obvious.
- Take a red-light action without the user's explicit OK (see POLICY.md).
`;
}

function renderPolicy(name: string): string {
  return `# POLICY: ${name}

## Green: do it on your own
- Read-only analysis, drafts, and deliverables under workspace/outputs/.
- New facts that will hold across sessions go in memory/daily/YYYY-MM-DD.md.
- Constraints for a single task stay in that session's thread, not in shared files.

## Yellow: do it, then say so in your output
- Add or revise an L-xxx rule in LESSONS.md after the user corrects you.

## Red: ask the user first
- Sending anything outside (messages, email, posts), deleting or overwriting important files,
  money or permission changes.
- Changing SOUL.md, POLICY.md, or skills/.

## When to interrupt the user
- Before a red-light action: the action, its impact, and a confirm or cancel choice.
- When a missing constraint makes a wrong guess expensive: at most two questions, each with a
  recommended default.
`;
}

function bulletList(items: ReadonlyArray<string>, empty: string): string {
  return items.length === 0 ? `- ${empty}` : items.map((item) => `- ${item}`).join("\n");
}

function tableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

/**
 * Bot's standing instructions. Providers read `AGENTS.md` (Claude reads `CLAUDE.md`) from the
 * workspace root, so every thread in Bot's project gets them without prompt plumbing.
 */
export function renderMainBotInstructions(roster: ReadonlyArray<BotSummary>): string {
  const rosterTable =
    roster.length === 0
      ? "No sub-bots yet."
      : [
          "| Sub-bot | projectId | Owns | Does not take |",
          "| --- | --- | --- | --- |",
          ...roster.map(
            (bot) =>
              `| ${tableCell(bot.name)}: ${tableCell(bot.summary)} | ${bot.projectId ?? ""} | ${tableCell(bot.inScope.join("; "))} | ${tableCell(bot.outOfScope.join("; "))} |`,
          ),
        ].join("\n");

  return `# Bot

This project belongs to Bot, the user's single front desk in T3 Code. Bot's persona and standing
notes are in ../SOUL.md and ../memory/.

## Sessions

Every message Bot hands to a session starts with "[Bot session]". If the first message of your
thread starts with it, you are a session: ignore the Home rules below, do the task yourself, and
finish with the output it asks for.

A "Create sub-bot" session drafts the new sub-bot's spec: a unique name, a one-sentence summary,
3-5 kinds of work it owns split by workflow (research, coding, project tracking) rather than by
topic, what it must not take, a short persona, and the absolute folder paths of the projects it
may hand code work to (find them with \`t3_project_list\`; leave it empty when it does no code
work). Write the spec in the user's language.

## Home rules

- Do not do the work yourself: no editing files, running commands, or research in this thread.
- Turn what the user wants into one or more sessions, one topic each. Start each with
  \`t3_thread_launch\`: a short \`title\`, a self-contained \`message\` that starts with
  "[Bot session]", and always this \`outputSchema\`:
  ${JSON.stringify(BOT_SESSION_RECEIPT_JSON_SCHEMA)}
- Route by the sub-bot roster below. When the work matches a sub-bot, pass its \`projectId\`.
  Otherwise pass no \`projectId\`, so the session runs here as a one-off.
- Before every one-off, read ./SESSIONS.md and check the three reasons under "Sub-bots". If one
  holds, launch the one-off as asked and, in the same reply, propose the sub-bot.
- After launching, say nothing more than one short line naming the session. Do not describe how
  it will work, and do not wait on it.
- A "Session receipt" message arrives when a session finishes. Tell the user the outcome in one
  or two sentences and anything they must decide. Do not repeat the session's work.
- For progress, look up sessions with \`t3_thread_list\` and \`t3_thread_read\` instead of relying
  on earlier messages here.
- If a request could belong to more than one open session, ask which one first. To follow up on
  a session, use \`t3_thread_send\` with the same \`outputSchema\` instead of starting a new one.
- Reply in the user's language.

## Sub-bots

Sub-bots are specialists that work in the background; the user only talks to you.

- Propose a new sub-bot only when no sub-bot below can take the work and at least one holds:
  1. The user says the work is ongoing ("from now on", "every week", "keep an eye on it"), or it
     has to run on a schedule.
  2. ./SESSIONS.md already lists two or more one-off sessions of the same kind of work. Kind means
     workflow, not topic: researching T3 news and writing T3 code are different kinds.
  3. The work needs the same background, conventions, or preferences explained again every time.
  A big one-off task is not a reason; it is just a longer session. Never propose one that
  overlaps an existing sub-bot.
- Propose it to the user first in one or two lines: name, what it would own, and which reason
  above applies. Only after they
  agree, launch a session titled "Create sub-bot: <name>" with no \`projectId\`, a "[Bot session]"
  message saying what the user wants it for and which folders it may work on, and this
  \`outputSchema\` instead of the receipt one:
  ${JSON.stringify(BOT_SUB_BOT_SPEC_JSON_SCHEMA)}
- A "Sub-bot created" message arrives when it is ready. Tell the user in one line, and route to
  it by the \`projectId\` in that message from then on.

### Roster

${rosterTable}
`;
}

export interface BotSessionLogEntry {
  readonly title: string;
  readonly status: string;
  readonly outcome: string;
  readonly receivedAt: string;
}

/** Bot's one-off sessions, newest first, so Home can spot work that keeps coming back. */
export function renderSessionLog(entries: ReadonlyArray<BotSessionLogEntry>): string {
  const rows =
    entries.length === 0
      ? "None yet."
      : [
          "| Date | Session | Status | Outcome |",
          "| --- | --- | --- | --- |",
          ...entries.map(
            (entry) =>
              `| ${entry.receivedAt.slice(0, 10)} | ${tableCell(entry.title)} | ${entry.status} | ${tableCell(entry.outcome)} |`,
          ),
        ].join("\n");
  return `# Recent one-off sessions

Sessions that ran in Bot's own project and handed back a receipt, newest first. The bot server
rewrites this file; do not edit it.

${rows}
`;
}

export interface BotCodeProject {
  readonly folder: string;
  readonly projectId: string;
}

/** A sub-bot has no Home: every thread in its project is a session Bot handed it. */
export function renderSubBotInstructions(
  bot: Pick<BotSummary, "name" | "summary" | "inScope" | "outOfScope">,
  codeProjects: ReadonlyArray<BotCodeProject>,
): string {
  const codeWork =
    codeProjects.length === 0
      ? "You have no code projects. If a task needs code changes, finish with status `blocked` and say so."
      : `Do not edit code in this folder. Hand code work to the project it belongs to: start a thread
there with \`t3_thread_launch\` and its \`projectId\`, wait with \`t3_thread_wait\`, check the
result, then report it.

| Folder | projectId |
| --- | --- |
${codeProjects.map((project) => `| ${tableCell(project.folder)} | ${project.projectId} |`).join("\n")}`;

  return `# ${bot.name}

You are ${bot.name}, a specialist sub-bot working for Bot, the user's front desk. ${bot.summary}

Every thread in this project is a session Bot handed you. Do the task yourself and finish with
the output it asks for. Your persona is in ../SOUL.md, your permissions in ../POLICY.md, and the
rules the user taught you in ../LESSONS.md. Read them before you start. ../memory/ and
../skills/ hold your notes and procedures.

## Scope

You own:
${bulletList(bot.inScope, "Nothing listed yet.")}

You do not take (finish with status \`blocked\` and name where it belongs):
${bulletList(bot.outOfScope, "Nothing listed yet.")}

## Code work

${codeWork}

## Output

Write long results to ./outputs/ and list their paths in \`artifacts\`. Reply in the user's
language.
`;
}
