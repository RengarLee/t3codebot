import { describe, expect, it } from "@effect/vitest";

import {
  renderBotFiles,
  renderMainBotInstructions,
  renderSubBotInstructions,
  type BotStandingNotes,
} from "./template.ts";

const skillRoots = {
  botId: "tutor",
  sharedDir: "/bots/_shared/skills",
  ownDir: "/bots/tutor/skills",
};

const emptyNotes: BotStandingNotes = {
  instructions: "",
  user: "",
  memory: "",
};

describe("bot prompt templates", () => {
  it("generates zero SOUL/POLICY boilerplate and writes INSTRUCTIONS.md only when provided", () => {
    const bareFiles = new Map(
      renderBotFiles({
        id: "tutor",
        name: "English Tutor",
        summary: "Helps with daily English lessons.",
        inScope: ["Daily lessons"],
        outOfScope: ["Coding"],
        projects: [],
        workingFolders: [],
        createdAt: "2026-11-27T00:00:00.000Z",
      }),
    );

    expect(bareFiles.has("SOUL.md")).toBe(false);
    expect(bareFiles.has("POLICY.md")).toBe(false);
    expect(bareFiles.has("INSTRUCTIONS.md")).toBe(false);
    expect(bareFiles.has("MEMORY.md")).toBe(true);

    const tailoredFiles = new Map(
      renderBotFiles({
        id: "tutor",
        name: "English Tutor",
        summary: "Helps with daily English lessons.",
        inScope: ["Daily lessons"],
        outOfScope: ["Coding"],
        instructions: "Teach like a patient private tutor.",
        projects: [],
        workingFolders: [],
        createdAt: "2026-11-27T00:00:00.000Z",
      }),
    );

    expect(tailoredFiles.get("INSTRUCTIONS.md")).toBe("Teach like a patient private tutor.\n");
  });

  it("compiles system boundaries, natural style, and faithful Home dispatch without boilerplate blocks", () => {
    const main = renderMainBotInstructions([], skillRoots, emptyNotes);
    expect(main).toContain("## Custom instructions and memory");
    expect(main).not.toContain("<instructions>");
    expect(main).not.toContain("<persona>");
    expect(main).not.toContain("<policy>");
    expect(main).toContain("## Boundaries");
    expect(main).toContain("### Response style");
    expect(main).toContain("write one brief plain line before your first tool call");
    expect(main).toContain("Keep the `message` faithful to the user's actual request");
    expect(main).toContain("Do not invent unasked progress recaps");
    expect(main).toContain("defer to\nthose docs instead of inventing a conflicting syllabus");
  });

  it("injects custom instructions when present and keeps natural response style and system boundaries", () => {
    const sub = renderSubBotInstructions(
      {
        name: "English Tutor",
        summary: "Helps with daily English lessons.",
        inScope: ["Daily lessons"],
        outOfScope: ["Coding"],
      },
      [],
      skillRoots,
      {
        instructions: "Teach in plain, friendly sentences.",
        user: "",
        memory: "",
      },
    );

    expect(sub).toContain("## Custom instructions and memory");
    expect(sub).toContain("<instructions>\nTeach in plain, friendly sentences.\n</instructions>");
    expect(sub).not.toContain("<persona>");
    expect(sub).not.toContain("<policy>");
    expect(sub).not.toContain("chief of staff");
    expect(sub).toContain("## Response style");
    expect(sub).toContain("## Boundaries");
    expect(sub).toContain("write one brief plain line before your first tool call");
    expect(sub).toContain("except in a scheduled run or a structured-output-only task");
    expect(sub).toContain("Leave out file paths, logs, IDs, past scores");
    expect(sub).toContain("Do not turn a direct request into a progress summary or a menu");
    expect(sub).toContain(
      "custom instructions, memory, and the user's project files take priority",
    );
  });
});
