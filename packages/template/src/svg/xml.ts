/**
 * A small XML reader, enough to walk an SVG.
 *
 * It exists because this package runs on Node, in a browser and on a phone, and
 * only one of those has a `DOMParser`. The office importer needs element names,
 * attributes and nesting and nothing else — no namespaces resolved, no entities
 * beyond the five predefined ones, no DOCTYPE at all. A DOCTYPE is refused
 * outright: entity expansion is the classic way an XML file attacks its parser,
 * and no SVG an author draws needs one.
 *
 * Text content is kept only as a flag plus the raw string, so the importer can
 * tell a `<style>` block from an empty one and spot lettering in a `<text>`.
 */

export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  /** Character data directly inside this element, with whitespace collapsed. */
  text: string
  /** 1-based line of the opening tag, for messages that point at the file. */
  line: number
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (line ${line})`)
    this.name = 'XmlParseError'
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Decode the predefined entities and numeric references; leave anything else as written. */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return ENTITIES[body] ?? whole
  })
}

const NAME_END = /[\s/>=]/

/** Parse a document and return its root element. Throws `XmlParseError`. */
export function parseXml(source: string): XmlElement {
  let index = 0
  let line = 1
  const stack: XmlElement[] = []
  let root: XmlElement | null = null

  const advance = (to: number) => {
    for (let at = index; at < to; at += 1) if (source.charCodeAt(at) === 10) line += 1
    index = to
  }
  const fail = (message: string): never => {
    throw new XmlParseError(message, line)
  }
  const current = (): XmlElement | null => stack[stack.length - 1] ?? null

  const appendText = (raw: string) => {
    const parent = current()
    if (parent === null) return
    const collapsed = raw.replace(/\s+/g, ' ').trim()
    if (collapsed.length === 0) return
    parent.text = parent.text.length === 0 ? collapsed : `${parent.text} ${collapsed}`
  }

  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open === -1) {
      appendText(source.slice(index))
      advance(source.length)
      break
    }
    if (open > index) appendText(source.slice(index, open))
    advance(open)

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4)
      if (end === -1) fail('A comment is never closed.')
      advance(end + 3)
      continue
    }
    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9)
      if (end === -1) fail('A CDATA section is never closed.')
      appendText(source.slice(index + 9, end))
      advance(end + 3)
      continue
    }
    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index + 2)
      if (end === -1) fail('A processing instruction is never closed.')
      advance(end + 2)
      continue
    }
    if (source.startsWith('<!', index)) {
      fail('A DOCTYPE or other declaration is not allowed in an office SVG.')
    }

    if (source.startsWith('</', index)) {
      const end = source.indexOf('>', index + 2)
      if (end === -1) fail('A closing tag is never finished.')
      const name = source.slice(index + 2, end).trim()
      const element = stack.pop()
      if (element === undefined) fail(`</${name}> closes nothing.`)
      else if (element.name !== name) fail(`</${name}> closes <${element.name}>.`)
      advance(end + 1)
      continue
    }

    // An opening tag.
    const nameStart = index + 1
    let at = nameStart
    while (at < source.length && !NAME_END.test(source[at] ?? '')) at += 1
    const name = source.slice(nameStart, at)
    if (name.length === 0) fail('A tag has no name.')
    const element: XmlElement = { name, attributes: {}, children: [], text: '', line }

    let selfClosing = false
    for (;;) {
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1
      if (at >= source.length) fail(`<${name}> is never closed.`)
      if (source.startsWith('/>', at)) {
        selfClosing = true
        at += 2
        break
      }
      if (source[at] === '>') {
        at += 1
        break
      }
      const attrStart = at
      while (at < source.length && !NAME_END.test(source[at] ?? '')) at += 1
      const attrName = source.slice(attrStart, at)
      if (attrName.length === 0) fail(`<${name}> has an unreadable attribute.`)
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1
      if (source[at] !== '=') {
        // An attribute with no value, which XML forbids but hand-written files have.
        element.attributes[attrName] = ''
        continue
      }
      at += 1
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1
      const quote = source[at]
      if (quote !== '"' && quote !== "'") {
        return fail(`${attrName} on <${name}> needs a quoted value.`)
      }
      const close = source.indexOf(quote, at + 1)
      if (close === -1) fail(`${attrName} on <${name}> has an unterminated value.`)
      element.attributes[attrName] = decodeEntities(source.slice(at + 1, close))
      at = close + 1
    }

    const parent = current()
    if (parent !== null) parent.children.push(element)
    else if (root === null) root = element
    else fail('There is more than one root element.')

    if (!selfClosing) stack.push(element)
    advance(at)
  }

  const unclosed = current()
  if (unclosed !== null) fail(`<${unclosed.name}> is never closed.`)
  if (root === null) throw new XmlParseError('The file has no elements.', line)
  return root
}

/** Depth-first walk, parents before children. */
export function* walk(element: XmlElement, depth = 0): Generator<[XmlElement, number]> {
  yield [element, depth]
  for (const child of element.children) yield* walk(child, depth + 1)
}
