const REMOVED_CONTENT_TAGS = new Set(["script", "style", "template", "noscript"]);
const PARAGRAPH_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tr",
  "ul",
]);

interface HtmlTagToken {
  closing: boolean;
  end: number;
  name: string;
  selfClosing: boolean;
}

export function normalizeJanitorSourceText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;

  const decoded = decodeHtmlEntities(value).replace(/\r\n?/g, "\n");
  const text = stripMarkup(decoded)
    .replace(/\u00a0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > 0 ? text : null;
}

function stripMarkup(source: string): string {
  let output = "";
  let cursor = 0;
  let removedContentTag: string | null = null;
  let removedContentDepth = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart === -1) {
      if (!removedContentTag) output += source.slice(cursor);
      break;
    }

    if (!removedContentTag) output += source.slice(cursor, tagStart);

    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      cursor = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }

    const tag = parseTag(source, tagStart);
    if (!tag) {
      if (looksLikeUnclosedRemovedContentTag(source, tagStart)) break;
      if (!removedContentTag) output += "<";
      cursor = tagStart + 1;
      continue;
    }

    cursor = tag.end;

    if (removedContentTag) {
      if (tag.name === removedContentTag) {
        if (tag.closing) {
          removedContentDepth -= 1;
          if (removedContentDepth === 0) removedContentTag = null;
        } else if (!tag.selfClosing) {
          removedContentDepth += 1;
        }
      }
      continue;
    }

    if (REMOVED_CONTENT_TAGS.has(tag.name)) {
      if (!tag.closing && !tag.selfClosing) {
        removedContentTag = tag.name;
        removedContentDepth = 1;
      }
      continue;
    }

    if (tag.name === "br") {
      output += "\n";
    } else if (PARAGRAPH_TAGS.has(tag.name)) {
      output += "\n\n";
    }
  }

  return output;
}

function parseTag(source: string, start: number): HtmlTagToken | null {
  let cursor = start + 1;
  let closing = false;

  if (source[cursor] === "/") {
    closing = true;
    cursor += 1;
  }

  const nameStart = cursor;
  if (!/[A-Za-z]/.test(source[cursor] ?? "")) return parseSpecialTag(source, start);

  cursor += 1;
  while (/[A-Za-z0-9:-]/.test(source[cursor] ?? "")) cursor += 1;
  const name = source.slice(nameStart, cursor).toLowerCase();
  let quote: '"' | "'" | null = null;

  while (cursor < source.length) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      let contentEnd = cursor - 1;
      while (/\s/.test(source[contentEnd] ?? "")) contentEnd -= 1;
      return {
        closing,
        end: cursor + 1,
        name,
        selfClosing: source[contentEnd] === "/",
      };
    }
    cursor += 1;
  }

  return null;
}

function parseSpecialTag(source: string, start: number): HtmlTagToken | null {
  const marker = source[start + 1];
  if (marker !== "!" && marker !== "?") return null;
  const end = source.indexOf(">", start + 2);
  if (end === -1) return null;
  return { closing: false, end: end + 1, name: "", selfClosing: true };
}

function looksLikeUnclosedRemovedContentTag(source: string, start: number): boolean {
  const remainder = source.slice(start);
  return /^<\/?(?:script|style|template|noscript)\b/i.test(remainder);
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  bull: "•",
  cent: "¢",
  copy: "©",
  divide: "÷",
  euro: "€",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: "\u00a0",
  ndash: "–",
  pound: "£",
  quot: '"',
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  times: "×",
  yen: "¥",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z][a-z\d]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
      if (named) return NAMED_ENTITIES[named.toLowerCase()] ?? entity;

      const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", decimal ? 10 : 16);
      if (
        !Number.isInteger(codePoint)
        || codePoint <= 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return entity;
      }

      return String.fromCodePoint(codePoint);
    },
  );
}
