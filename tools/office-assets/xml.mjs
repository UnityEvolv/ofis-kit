/**
 * A small XML reader for the asset tools: elements, attributes, nesting, and
 * the source span of every element so a tool can copy it out verbatim.
 *
 * A JavaScript twin of packages/template/src/svg/xml.ts, kept separate because
 * the tools run as plain Node scripts without a build step. It is used only on
 * files in this repository, so it does not carry the DOCTYPE refusal and the
 * safety checks that the importer applies to uploads.
 */

const NAME_END = /[\s/>=]/

/**
 * Parse a document.
 *
 * Returns the root element; every element has `name`, `attributes`, `children`,
 * `start` and `end` (character offsets into `source`, end exclusive), so
 * `source.slice(start, end)` is the element's text exactly as written.
 */
export function parseXml(source) {
  let index = 0
  const stack = []
  let root = null

  const fail = (message) => {
    const line = source.slice(0, index).split('\n').length
    throw new Error(`${message} (line ${line})`)
  }

  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open === -1) break
    index = open

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4)
      if (end === -1) fail('A comment is never closed.')
      index = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9)
      if (end === -1) fail('A CDATA section is never closed.')
      index = end + 3
      continue
    }
    if (source.startsWith('<?', index) || source.startsWith('<!', index)) {
      const end = source.indexOf('>', index + 2)
      if (end === -1) fail('A declaration is never closed.')
      index = end + 1
      continue
    }
    if (source.startsWith('</', index)) {
      const end = source.indexOf('>', index + 2)
      if (end === -1) fail('A closing tag is never finished.')
      const name = source.slice(index + 2, end).trim()
      const element = stack.pop()
      if (element === undefined) fail(`</${name}> closes nothing.`)
      if (element.name !== name) fail(`</${name}> closes <${element.name}>.`)
      element.end = end + 1
      index = end + 1
      continue
    }

    const nameStart = index + 1
    let at = nameStart
    while (at < source.length && !NAME_END.test(source[at])) at += 1
    const name = source.slice(nameStart, at)
    if (name.length === 0) fail('A tag has no name.')
    const element = { name, attributes: {}, children: [], start: index, end: -1 }

    let selfClosing = false
    for (;;) {
      while (at < source.length && /\s/.test(source[at])) at += 1
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
      while (at < source.length && !NAME_END.test(source[at])) at += 1
      const attrName = source.slice(attrStart, at)
      while (at < source.length && /\s/.test(source[at])) at += 1
      if (source[at] !== '=') {
        element.attributes[attrName] = ''
        continue
      }
      at += 1
      while (at < source.length && /\s/.test(source[at])) at += 1
      const quote = source[at]
      if (quote !== '"' && quote !== "'") fail(`${attrName} on <${name}> needs a quoted value.`)
      const close = source.indexOf(quote, at + 1)
      if (close === -1) fail(`${attrName} on <${name}> has an unterminated value.`)
      element.attributes[attrName] = source.slice(at + 1, close)
      at = close + 1
    }

    const parent = stack[stack.length - 1]
    if (parent !== undefined) parent.children.push(element)
    else if (root === null) root = element
    else fail('There is more than one root element.')

    if (selfClosing) element.end = at
    else stack.push(element)
    index = at
  }

  if (stack.length > 0) fail(`<${stack[stack.length - 1].name}> is never closed.`)
  if (root === null) throw new Error('The file has no elements.')
  return root
}

/** The ids an element's text references: `url(#x)` and `href="#x"`. */
export function referencedIds(text) {
  const ids = new Set()
  for (const match of text.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) ids.add(match[1])
  for (const match of text.matchAll(/href=["']#([^"']+)["']/g)) ids.add(match[1])
  return ids
}
