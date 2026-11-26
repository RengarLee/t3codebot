import type { BUILTIN_SKILL_NAMES } from "../contracts.ts";

const SKILL_IMPROVER = `---
name: skill-improver
description: How to propose, apply, and write down improvements to skills, always with the user's OK. Use it when the user corrects how a kind of task is done, when a technique worked that is worth keeping, or when a skill turned out wrong or outdated.
---

# Improving skills

Skills are the procedures every bot follows. They change only with the user's OK: the user decides,
you do the typing. Every change is recorded as a revision (when, why, in which thread, what it said
before), so the user can always see what happened and go back. The two entries you write below are
how that record gets its "why".

Your AGENTS.md has a "Skills" section with your bot id and the two skill folders:

- the shared folder, read by every bot (a change there reaches all of them);
- your own folder, read only by you.

Call the folder a skill lives in its skills root. A skill is \`<skills root>/<name>/SKILL.md\`. Names
are lowercase letters, digits, and single hyphens, at most 64 characters, and are unique across the
shared folder and your own.

## When to propose a change

Propose one when:

- the user corrects how a whole kind of task is done, not only this time;
- you found a non-obvious technique that worked and would save the next run real effort;
- you followed a skill and it was wrong, out of date, or missing a step.

Do not propose one for a one-time preference, a fact about the user (that belongs in memory), or a
guess you cannot back up. One lesson, one proposal.

Pick the shared folder when the lesson helps any bot, your own folder when it only concerns your
kind of work.

## How to propose

1. Write one new file, \`<skills root>/.inbox/<uuid>.json\` (create the \`.inbox\` folder if it is
   missing, and use a fresh uuid so entries never collide):

   \`\`\`json
   {
     "kind": "suggest",
     "name": "<skill name>",
     "action": "update",
     "signal": "correction",
     "message": "<the lesson in one to three sentences>",
     "botId": "<your bot id>"
   }
   \`\`\`

   \`action\` is \`create\` for a new skill or \`update\` for an existing one. \`signal\` is
   \`correction\`, \`technique\`, or \`outdated_skill\`.

2. Tell the user in one sentence what you suggested.
3. Do NOT edit any skill file. The user accepts or dismisses the suggestion in Settings.

## How to apply a change

Edit a skill only after one of these: the user agreed to your proposal in chat, a message tells you
the user approved a suggestion, or the user asked you for this change.

1. FIRST write \`<skills root>/.inbox/<uuid>.json\`:

   \`\`\`json
   {
     "kind": "change",
     "name": "<skill name>",
     "basis": "user_request",
     "reason": "<why, in one sentence>",
     "botId": "<your bot id>"
   }
   \`\`\`

   \`basis\` is \`user_request\` when the user asked for the change in their own words, or
   \`suggested\` when they approved a suggestion. For \`suggested\`, add
   \`"suggestionId": "<the id you were given>"\`.

2. THEN edit \`<skills root>/<name>/SKILL.md\`. Delete a skill only when the user asked you to.
3. Tell the user in one sentence what changed.

One entry per skill you touch, always before its edit. The server reads the entry after your run
ends and records the revision with your reason.

## How to write a skill

- Start with a front matter block holding \`name\` and a \`description\` that says what the skill
  does and when to use it.
- Put the procedure first: numbered steps, in the order you do them.
- Attach each pitfall to the step it belongs to, with the reason it bites.
- Keep it general. No dates, no names of people, no details of one particular task.
- When improving, change the sentence that was wrong in place. Keep everything the user did not
  show to be wrong.
- State each lesson once. If a step already covers it, sharpen that step instead of adding another.
`;

/** Skills shipped with the bot module; each is written to the shared folder once, when missing. */
export const BUILTIN_SKILL_FILES: Readonly<Record<(typeof BUILTIN_SKILL_NAMES)[number], string>> = {
  "skill-improver": SKILL_IMPROVER,
};
