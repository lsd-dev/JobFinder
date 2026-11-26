/** Small text helpers shared by adapters and matchers. */

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/** HTML (possibly entity-escaped, as Greenhouse returns it) to plain text. */
export function htmlToText(html: string | undefined | null): string {
  if (!html) return "";
  let s = html;
  // Greenhouse double-escapes: decode once if it looks escaped.
  if (/&lt;\w/.test(s)) s = decodeEntities(s);
  return decodeEntities(
    s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|div|h\d|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Lowercase, strip punctuation noise, collapse whitespace. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
}

/** Firestore-safe document id piece. */
export function safeId(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
}
