import { Lexer, type MarkedToken } from "marked"

export interface ParseState {
  content: string
  tokens: MarkedToken[]
  stableTokenCount?: number
}

/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 * Compares token.raw at each offset - matching tokens keep same object reference.
 */
export function parseMarkdownIncremental(
  newContent: string,
  prevState: ParseState | null,
  trailingUnstable: number = 2,
): ParseState {
  if (!prevState || prevState.tokens.length === 0) {
    try {
      const tokens = Lexer.lex(newContent, { gfm: true }) as MarkedToken[]
      return {
        content: newContent,
        tokens,
        stableTokenCount: Math.max(0, tokens.length - trailingUnstable),
      }
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }

  const appended = newContent.startsWith(prevState.content) ? newContent.slice(prevState.content.length) : ""
  const tail = prevState.tokens.at(-1)
  const proseParts = appended.includes("\n") ? appended.split(/(\n{2,})/) : []
  if (
    proseParts.length > 1 &&
    !appended.includes("\r") &&
    proseParts.every((part, index) =>
      index % 2 === 1 ? /^\n{2,}$/.test(part) : !part.includes("\n") && (index === 0 || !part || /^\p{L}/u.test(part)),
    ) &&
    tail?.type === "paragraph" &&
    tail.raw === tail.text &&
    /^(?:\p{L}|\p{N})/u.test(tail.raw) &&
    prevState.tokens.reduce((length, token) => length + token.raw.length, 0) === prevState.content.length
  ) {
    const tokens: MarkedToken[] = [
      ...prevState.tokens.slice(0, -1),
      {
        ...tail,
        raw: tail.raw + proseParts[0],
        text: tail.text + proseParts[0],
        tokens: Lexer.lexInline(tail.text + proseParts[0], { gfm: true }),
      },
      ...proseParts.slice(1).flatMap((part, index): MarkedToken[] => {
        if (index % 2 === 0) return [{ type: "space", raw: part }]
        if (!part) return []
        return [{ type: "paragraph", raw: part, text: part, tokens: Lexer.lexInline(part, { gfm: true }) }]
      }),
    ]
    return {
      content: newContent,
      tokens,
      stableTokenCount: Math.max(0, tokens.length - trailingUnstable),
    }
  }

  if (
    appended &&
    !appended.includes("\n") &&
    !appended.includes("\r") &&
    tail?.type === "paragraph" &&
    tail.raw === tail.text &&
    /^(?:\p{L}|\p{N})/u.test(tail.raw) &&
    prevState.tokens.reduce((length, token) => length + token.raw.length, 0) === prevState.content.length
  ) {
    const text = tail.text + appended
    const inline = tail.tokens
    const inlineText = inline?.length === 1 && inline[0].type === "text" ? inline[0] : undefined
    return {
      content: newContent,
      tokens: [
        ...prevState.tokens.slice(0, -1),
        {
          ...tail,
          raw: text,
          text,
          tokens:
            inlineText && inlineText.raw === tail.text && /^[\p{L}\p{N} ]+$/u.test(appended)
              ? [{ ...inlineText, raw: text, text }]
              : Lexer.lexInline(text, { gfm: true }),
        },
      ],
      stableTokenCount: prevState.tokens.length - 1,
    }
  }

  // Find how many tokens from start are unchanged
  let offset = 0
  let reuseCount = 0

  for (const token of prevState.tokens) {
    const tokenLength = token.raw.length
    if (offset + tokenLength <= newContent.length && newContent.startsWith(token.raw, offset)) {
      reuseCount++
      offset += tokenLength
    } else {
      break
    }
  }

  // Keep last N tokens unstable (e.g. "# Hello" might become "# Hello World")
  reuseCount = Math.max(0, reuseCount - trailingUnstable)

  offset = 0
  for (let i = 0; i < reuseCount; i++) {
    offset += prevState.tokens[i].raw.length
  }

  const stableTokens = prevState.tokens.slice(0, reuseCount)
  const remainingContent = newContent.slice(offset)

  if (!remainingContent) {
    return {
      content: newContent,
      tokens: stableTokens,
      stableTokenCount: stableTokens.length,
    }
  }

  try {
    const newTokens = Lexer.lex(remainingContent, { gfm: true }) as MarkedToken[]
    return {
      content: newContent,
      tokens: [...stableTokens, ...newTokens],
      stableTokenCount: trailingUnstable === 0 ? stableTokens.length + newTokens.length : stableTokens.length,
    }
  } catch {
    try {
      const fullTokens = Lexer.lex(newContent, { gfm: true }) as MarkedToken[]
      return { content: newContent, tokens: fullTokens, stableTokenCount: 0 }
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }
}
