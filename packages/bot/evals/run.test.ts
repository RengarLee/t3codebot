import { expect, it } from "@effect/vitest";
import { gradeExtraction, gradeResponse } from "./grade.ts";

it("rejects omitted preferences and unwanted control memories", () => {
  expect(gradeExtraction({ skill: null, memory: [] }, true)).toBe(false);
  expect(gradeExtraction({ skill: null, memory: [] }, false)).toBe(true);
  const answer = {
    skill: null,
    memory: [{ op: "add", scope: "user", old: "", text: "Prefers Chinese." }],
  } as const;
  expect(gradeExtraction(answer, true)).toBe(true);
  expect(gradeExtraction(answer, false)).toBe(false);
  expect(
    gradeExtraction({ ...answer, memory: [{ ...answer.memory[0], scope: "bot" }] }, true),
  ).toBe(false);
});

it("does not accept English answers or a token Chinese greeting", () => {
  expect(gradeResponse("Leaves look green because of chlorophyll.")).toBe(false);
  expect(gradeResponse("你好. Leaves look green because of chlorophyll.")).toBe(false);
  expect(
    gradeResponse(
      "叶子看起来是绿色的，因为叶绿素吸收红光和蓝光，反射较多绿光。我们看见的主要是这些反射的绿光。",
    ),
  ).toBe(true);
});
