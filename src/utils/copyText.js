export function formatCopiedValue(value, withQuotes) {
  const text = String(value ?? "");
  return withQuotes ? `"${text.replaceAll('"', '""')}"` : text;
}
