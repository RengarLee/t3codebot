import { ThreadId, withMessageSenderNote } from "@t3tools/contracts";

import { BOT_WORKING_FOLDERS_UPDATE_JSON_SCHEMA } from "../../packages/bot/src/contracts.ts";
import {
  renderMainBotInstructions,
  renderSubBotInstructions,
} from "../../packages/bot/src/server/template.ts";
import type { McpToolUseCase } from "./run.ts";

const skillRoots = {
  botId: "tutor",
  sharedDir: "/bots/_shared/skills",
  ownDir: "/bots/tutor/skills",
};

const emptyNotes = { soul: "", policy: "", memory: "", user: "" };

const senderCases: ReadonlyArray<McpToolUseCase> = ["main", "sub"].flatMap((owner) => {
  const context =
    owner === "main"
      ? renderMainBotInstructions([], skillRoots, emptyNotes)
      : renderSubBotInstructions(
          {
            name: "Tutor",
            summary: "Teaches English.",
            inScope: ["English practice"],
            outOfScope: [],
          },
          [],
          skillRoots,
          emptyNotes,
        );
  return ["user", "agent"].map((sender) => ({
    id: `bot-session-${owner}-${sender}`,
    area: "bot-session",
    kind: sender === "user" ? "bad" : "control",
    pattern: "current-message-sender",
    experience:
      "A user enters a Bot-created session after MainBot's initial dispatch; the session must address the current sender.",
    source: {
      request:
        "Distinguish MainBot coordination from direct user conversation in Bot-created sessions.",
    },
    setup: {
      role: "top",
      context,
      priorTurns: [
        {
          role: "user",
          text: withMessageSenderNote(
            {
              createdBy: "agent",
              creationSource: "mcp",
              senderThreadId: ThreadId.make("mainbot-home"),
            },
            "[Bot session] Help the user practice English here. Return a receipt with status, outcome and artifacts when reporting to MainBot.",
          ),
        },
        {
          role: "assistant",
          text: '{"status":"needs_decision","outcome":"Ready for English practice.","artifacts":[]}',
        },
      ],
    },
    prompt: withMessageSenderNote(
      sender === "user"
        ? { createdBy: "user", creationSource: "web" }
        : {
            createdBy: "agent",
            creationSource: "mcp",
            senderThreadId: ThreadId.make("mainbot-home"),
          },
      "Before we continue, identify who sent this current message. Answer only HUMAN if it came directly from the person, or MAINBOT if it came from the coordinating agent. Do not use tools.",
      "agent",
    ),
    expect: {
      finalTextMust: [sender === "user" ? "^\\s*HUMAN\\s*$" : "^\\s*MAINBOT\\s*$"],
      callsMustNot: [
        { tool: "t3_thread_send" },
        { tool: "t3_thread_launch" },
        { tool: "delegate_task" },
        { tool: "t3_submit_output" },
      ],
    },
    maxSteps: 2,
  }));
});

export const botSessionCases: ReadonlyArray<McpToolUseCase> = [
  ...senderCases,
  ...[
    {
      id: "decision",
      status: "needs_decision",
      outcome: "会话已提交费用决策请求：课程每月100元，尚未获用户批准。",
      must: ["100", "批准|同意"],
    },
    {
      id: "result",
      status: "done",
      outcome: "已向主 Bot 返回检查结果：三张发票逾期，合计1200元。",
      must: ["三|3", "1200", "逾期"],
    },
    {
      id: "blocker",
      status: "blocked",
      outcome: "已通知主 Bot：无法读取报表，因为缺少共享文件夹的读取权限，需要用户授予读取权限。",
      must: ["读取权限", "共享文件夹"],
    },
  ].map((scenario): McpToolUseCase => ({
    id: `bot-home-useful-${scenario.id}`,
    area: "bot-session",
    kind: "bad",
    pattern: "answer-the-user-not-the-receipt",
    experience:
      "Home announces that a session submitted a result instead of giving the user useful information directly.",
    source: {
      request:
        "Keep Bot replies useful; receiving or forwarding another session's result is not useful information.",
    },
    setup: { role: "top", context: renderMainBotInstructions([], skillRoots, emptyNotes) },
    prompt: `Session finished (${scenario.status}): [任务详情](t3-thread://v1/example-session)\n${scenario.outcome}`,
    expect: {
      finalTextMust: scenario.must,
      textMustNot: [
        "已(?:经)?(?:收到|接收|接受|转发|转达|提交|返回|通知|汇报)",
        "(?:会话|主\\s*Bot|子\\s*Bot).{0,12}(?:结果|请求|回复)",
        "点击.{0,8}(?:详情|完整)",
      ],
    },
    maxSteps: 4,
  })),
  ...["main", "sub"].flatMap((owner) =>
    ["ready", "decision"].map((scenario): McpToolUseCase => ({
      id: `bot-session-${owner}-${scenario}`,
      area: "bot-session",
      kind: scenario === "ready" ? "bad" : "control",
      pattern: "interactive-readiness-is-not-a-decision",
      experience:
        "Home repeats its session link when an interactive session reports readiness as a decision.",
      source: { request: "Create an ongoing practice session and wait for the user to enter it." },
      setup: {
        role: "top",
        context:
          owner === "main"
            ? renderMainBotInstructions([], skillRoots, emptyNotes)
            : renderSubBotInstructions(
                {
                  name: "Tutor",
                  summary: "Teaches languages.",
                  inScope: ["Language practice"],
                  outOfScope: [],
                },
                [],
                skillRoots,
                emptyNotes,
              ),
      },
      prompt: withMessageSenderNote(
        {
          createdBy: "agent",
          creationSource: "mcp",
          senderThreadId: ThreadId.make("mainbot-home"),
        },
        scenario === "ready"
          ? "[Bot session] Prepare an ongoing language practice session. Wait for the user to enter before starting. Setup is complete and there are no blockers or decisions. Return only the JSON receipt with status, outcome and artifacts. Do not use tools."
          : "[Bot session] Prepare language practice. The requested course requires a paid subscription and the user has not approved the purchase. MainBot must ask them to approve it before you can proceed. Return only the JSON receipt with status, outcome and artifacts. Do not use tools.",
      ),
      expect: {
        callsMustNot: [{ tool: "t3_thread_send" }],
        finalTextMust: [
          scenario === "ready"
            ? '"status"\\s*:\\s*"waiting_user"'
            : '"status"\\s*:\\s*"needs_decision"',
        ],
      },
      maxSteps: 2,
    })),
  ),
  {
    id: "bot-home-add-working-folder",
    area: "bot-session",
    kind: "bad",
    pattern: "home-manages-working-folders-directly",
    experience:
      "Home tells the user to open Settings -> Bots manually even though the user explicitly asked to grant a folder.",
    source: {
      request:
        "Let Home update working folders directly via the structured update session instead of sending the user to Settings.",
    },
    setup: {
      role: "top",
      context: renderMainBotInstructions(
        [
          {
            id: "english-coach",
            role: "sub",
            name: "英语教练",
            status: "active",
            summary: "负责英语学习与日常练习。",
            inScope: ["英语学习", "口语与阅读练习"],
            outOfScope: ["代码修改"],
            workingFolders: [],
            version: "0.1.0",
            sessionMode: "fresh_per_run",
            skillsCount: 0,
            path: "/home/user/.t3/bots/english-coach",
            projectId: "proj-english",
            homeThreadId: null,
          },
        ],
        skillRoots,
        emptyNotes,
      ),
    },
    prompt: "帮我创建一个用来学习英语的助手，他可以看这个文件夹里的文件 /home/user/study/english",
    expect: {
      calls: [
        {
          tool: "t3_thread_launch",
          args: { outputSchema: BOT_WORKING_FOLDERS_UPDATE_JSON_SCHEMA },
        },
      ],
      textMustNot: ["Settings\\s*[→>-]+\\s*Bots", "设置\\s*[→>-]+\\s*Bots"],
    },
    maxSteps: 4,
  },
  {
    id: "bot-sub-working-folder-needs-decision",
    area: "bot-session",
    kind: "control",
    pattern: "sub-bot-cannot-self-escalate-folders",
    experience:
      "A sub-bot without access to a local folder asks MainBot via needs_decision instead of telling the user to open Settings or editing project settings itself.",
    source: {
      request:
        "Sub-bots request missing working folders via needs_decision so Home confirms with the user and applies the update.",
    },
    setup: {
      role: "top",
      context: renderSubBotInstructions(
        {
          name: "英语教练",
          summary: "负责英语学习与日常练习。",
          inScope: ["英语学习", "口语与阅读练习"],
          outOfScope: ["代码修改"],
        },
        [],
        skillRoots,
        emptyNotes,
      ),
    },
    prompt: withMessageSenderNote(
      {
        createdBy: "agent",
        creationSource: "mcp",
        senderThreadId: ThreadId.make("mainbot-home"),
      },
      "[Bot session] Check the study notes in /home/user/study/english and prepare a quiz. You do not have access to that folder yet. Return only the JSON receipt with status, outcome and artifacts. Do not use tools.",
    ),
    expect: {
      callsMustNot: [{ tool: "t3_project_update" }, { tool: "t3_thread_send" }],
      finalTextMust: ['"status"\\s*:\\s*"needs_decision"', "/home/user/study/english"],
      textMustNot: ["Settings\\s*[→>-]+\\s*Bots", "设置\\s*[→>-]+\\s*Bots"],
    },
    maxSteps: 2,
  },
];
