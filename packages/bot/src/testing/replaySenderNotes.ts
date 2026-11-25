export function materializeReplaySenderNotes<
  Entry extends { readonly type: string; readonly frame?: unknown },
>(
  entries: ReadonlyArray<Entry>,
  messages: ReadonlyArray<{ readonly text: string; readonly annotatedText: string }>,
) {
  const replacements = messages
    .filter(({ text, annotatedText }) => text !== "" && text !== annotatedText)
    .toSorted((left, right) => right.text.length - left.text.length);
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") {
      let rewritten = value;
      for (const { text, annotatedText } of replacements) {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(
          `(^|\\n\\n|<user_request>\\n)${escaped}(?=$|\\n\\n|\\n</user_request>)`,
          "g",
        );
        const note = annotatedText.slice(0, -text.length);
        rewritten = rewritten.replace(
          pattern,
          (match: string, prefix: string, offset: number, source: string) =>
            source.slice(0, offset + prefix.length).endsWith(note) ? match : prefix + annotatedText,
        );
      }
      return rewritten;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]));
  };
  return entries.map((entry) =>
    entry.type === "expect_outbound" ? { ...entry, frame: rewrite(entry.frame) } : entry,
  );
}
