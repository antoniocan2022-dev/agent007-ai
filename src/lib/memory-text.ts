/**
 * Memory text boundary.
 *
 * Prisma's query engine is strict about JSON/Unicode strings. A JavaScript
 * string can contain a lone UTF-16 surrogate when upstream code truncates or
 * slices text in the middle of an emoji. Such a value can surface as
 * `unexpected end of hex escape` inside Prisma's JSON parser.
 *
 * All memory text crosses this boundary before it is persisted or formatted.
 */
export function sanitizeMemoryText(input: string): string {
  let output = ''

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i)

    // Preserve valid surrogate pairs (emoji and other astral code points).
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[i] + input[i + 1]
        i += 1
        continue
      }
      output += '\ufffd'
      continue
    }

    // Replace an unpaired low surrogate.
    if (code >= 0xdc00 && code <= 0xdfff) {
      output += '\ufffd'
      continue
    }

    // PostgreSQL text cannot safely contain NUL bytes.
    if (code === 0) {
      output += '\ufffd'
      continue
    }

    output += input[i]
  }

  // Canonical normalization keeps equivalent Unicode representations stable.
  return output.normalize('NFC')
}

export function hasUnsafeMemoryText(input: string): boolean {
  return sanitizeMemoryText(input) !== input
}

export function sanitizeMemoryFields(fields: {
  key: string
  value: string
  category: string
}): typeof fields {
  return {
    key: sanitizeMemoryText(fields.key),
    value: sanitizeMemoryText(fields.value),
    category: sanitizeMemoryText(fields.category),
  }
}
