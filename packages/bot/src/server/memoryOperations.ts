import { BOT_MEMORY_MAX_BYTES, type BotMemoryOp } from "../contracts.ts";

const sensitive =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|(?:password|passwd|token|api[_ -]?key|secret|密码|口令|验证码)\s*[:=：]\s*\S+)/i;

export function applyMemoryOperations(
  content: string,
  operations: ReadonlyArray<BotMemoryOp>,
): string {
  if (operations.length > 3) throw new Error("At most three memory operations are allowed.");
  let result = content;
  for (const operation of operations) {
    const { op, old, text } = operation;
    if ([old, text].some((value) => value.length > 400 || /[\r\n]/.test(value))) {
      throw new Error("Memory operations must contain single lines of at most 400 characters.");
    }
    if (
      (op === "add" ? old !== "" : old.trim() === "") ||
      (op === "remove" ? text !== "" : text.trim() === "")
    ) {
      throw new Error("Invalid memory operation fields.");
    }
    if (sensitive.test(text)) throw new Error("Sensitive content cannot be remembered.");
    const lines = result.split("\n");
    const matches = lines.flatMap((line, index) =>
      line.replace(/\r$/, "") === `- ${old}` ? [index] : [],
    );
    const duplicate = lines.some((line) => line.replace(/\r$/, "") === `- ${text}`);
    if (op === "add") {
      if (!duplicate) result += `${result && !result.endsWith("\n") ? "\n" : ""}- ${text}\n`;
    } else {
      const index = matches[0];
      if (matches.length !== 1 || index === undefined)
        throw new Error("Memory line no longer matches uniquely.");
      if (op === "remove" || (duplicate && old !== text)) lines.splice(index, 1);
      else lines[index] = `- ${text}${lines[index]?.endsWith("\r") ? "\r" : ""}`;
      result = lines.join("\n");
    }
  }
  if (Buffer.byteLength(result, "utf8") > BOT_MEMORY_MAX_BYTES)
    throw new Error("Memory exceeds 4 KB.");
  return result;
}
