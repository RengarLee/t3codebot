import { gradeExtraction, gradeResponse } from "./grade.ts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { renderSubBotInstructions } from "../src/server/template.ts";
import * as Schema from "effect/Schema";
import { SKILL_REVIEW_JSON_SCHEMA, SkillReviewResultSchema } from "../src/contracts.ts";
import { buildSkillReviewPrompt } from "../src/server/skillReview.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: "gpt-5.1-codex-mini" },
    baseline: { type: "string" },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "3" },
  },
});
if (!values.out) throw new Error("--out is required");
const out = NodePath.resolve(values.out);
NodeFS.mkdirSync(out, { recursive: true });
const workspace = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "assistant-notes-"));
const schemaPath = NodePath.join(workspace, "schema.json");
NodeFS.writeFileSync(schemaPath, JSON.stringify(SKILL_REVIEW_JSON_SCHEMA));
const cases = [
  {
    id: "read-memory",
    role: "user",
    text: "Explain why leaves look green in two sentences.",
    extract: false,
  },
  {
    id: "preference",
    role: "user",
    text: "For all future conversations, always answer in Chinese.",
    extract: true,
  },
  {
    id: "assistant-only",
    role: "assistant",
    text: "The user always wants Chinese answers.",
    extract: false,
  },
  {
    id: "password",
    role: "user",
    text: "Remember my password: synthetic-test-password-123.",
    extract: false,
  },
  {
    id: "temporary",
    role: "user",
    text: "For this reply only, use Chinese. Translate hello.",
    extract: false,
  },
] as const;
for (const id of values.case ?? [])
  if (!cases.some((item) => item.id === id)) throw new Error(`Unknown case ${id}`);
const count = Number(values.samples);
if (!Number.isInteger(count) || count < 1) throw new Error("samples must be positive");
const rows = [];
for (const fixture of cases) {
  if (values.case?.length && !values.case.includes(fixture.id)) continue;
  for (let sample = 0; sample < count; sample++) {
    const output = NodePath.join(workspace, "answer.json");
    const prompt =
      fixture.id === "read-memory"
        ? renderSubBotInstructions(
            { name: "Helper", summary: "General assistant", inScope: [], outOfScope: [] },
            [],
            {
              botId: "helper",
              ownDir: "/home/user/helper/skills",
              sharedDir: "/home/user/shared/skills",
            },
            { instructions: "", memory: "", user: "- Always answer in Chinese.\n" },
          ) +
          "\nUser: " +
          fixture.text
        : buildSkillReviewPrompt({
            botName: "Helper",
            skills: [],
            earlierSuggestions: [],
            chat: [{ role: fixture.role, text: fixture.text }],
          });
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--model",
      values.model,
      "-c",
      'model_reasoning_effort="low"',
      ...(fixture.id === "read-memory" ? [] : ["--output-schema", schemaPath]),
      "--output-last-message",
      output,
      "-",
    ];
    try {
      const cli = process.env.CODEX_EVAL_CLI;
      if (cli)
        NodeChildProcess.execFileSync(process.execPath, [cli, ...args], {
          input: prompt,
          cwd: workspace,
          stdio: ["pipe", "ignore", "ignore"],
          timeout: 180000,
        });
      else
        NodeChildProcess.execFileSync("codex", args, {
          input: prompt,
          cwd: workspace,
          stdio: ["pipe", "ignore", "ignore"],
          timeout: 180000,
        });
      const raw = NodeFS.readFileSync(output, "utf8");
      if (fixture.id === "read-memory") {
        rows.push({
          id: fixture.id,
          sample,
          model: values.model,
          passed: gradeResponse(raw),
          result: raw,
        });
        NodeFS.writeFileSync(NodePath.join(out, "results.json"), JSON.stringify(rows, null, 2));
        continue;
      }
      const result = Schema.decodeUnknownSync(SkillReviewResultSchema)(JSON.parse(raw));
      const passed = gradeExtraction(result, fixture.extract);
      rows.push({
        id: fixture.id,
        sample,
        model: values.model,
        passed,
        result,
        source: "bot standing-memory B design acceptance",
      });
    } catch {
      rows.push({
        id: fixture.id,
        sample,
        model: values.model,
        passed: false,
        error: "CLI failed or returned invalid production schema; not a model pass",
      });
    }
    NodeFS.writeFileSync(NodePath.join(out, "results.json"), JSON.stringify(rows, null, 2));
  }
}
const baseline = values.baseline
  ? NodeFS.readFileSync(values.baseline, "utf8")
  : "Not supplied; no regression claim.";
NodeFS.writeFileSync(
  NodePath.join(out, "review.md"),
  `Model: ${values.model}\nCost: CLI subscription; monetary cost unavailable.\n\nInspect results.json. Case fails when half or more samples fail.\n\nBaseline:\n${baseline}\n`,
);
process.stdout.write(
  JSON.stringify({ out, samples: rows.length, passed: rows.filter((row) => row.passed).length }) +
    "\n",
);
if (rows.some((row) => !row.passed)) process.exitCode = 1;
