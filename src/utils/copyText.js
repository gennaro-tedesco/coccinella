export function formatCopiedValue(value, quote) {
  const text = String(value ?? "");
  return quote ? `${quote}${text.replaceAll(quote, quote + quote)}${quote}` : text;
}
