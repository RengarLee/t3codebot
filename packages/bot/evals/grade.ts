import type { SkillReviewResult } from "../src/contracts.ts";

export function gradeExtraction(result: SkillReviewResult, extract: boolean) {
  return extract
    ? result.memory.some(
        (op) => op.scope === "user" && op.op === "add" && /Chinese|中文|汉语/i.test(op.text),
      )
    : result.memory.length === 0;
}

export function gradeResponse(text: string) {
  return (text.match(/[\u3400-\u9fff]/g)?.length ?? 0) > 20;
}
