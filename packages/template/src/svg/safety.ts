import { TemplateError, issue, type TemplateIssue } from '../errors.js'
import { walk, type XmlElement } from './xml.js'

/**
 * What an SVG may contain before the product will show it as an office.
 *
 * The picture is served to every member of the office, so it is treated as
 * untrusted even when a staff designer drew it. The rule is an allow-list: a
 * drawing is shapes, paint and the handful of filter primitives a flat
 * illustration uses. Scripts, embedded documents, links to anywhere else and
 * raster images are refused with the element named, never silently removed,
 * because an author who is told what was wrong fixes the file while one whose
 * file was quietly altered ships something they have not seen.
 *
 * Text is handled by the office rules, not here: it is not a safety problem,
 * it is a product one (room names are drawn by the product, never painted).
 */

export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'title',
  'desc',
  'metadata',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'switch',
  'style',
  'text',
  'tspan',
  'textPath',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feComposite',
  'feDropShadow',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'feTurbulence',
  'feDisplacementMap',
  'feDiffuseLighting',
  'feSpecularLighting',
  'feDistantLight',
  'fePointLight',
  'feSpotLight',
])

/** Elements refused with a reason of their own, because authors ask why. */
const REFUSED_ELEMENTS: Record<string, string> = {
  script: 'runs code',
  foreignObject: 'embeds a document',
  image: 'embeds a raster image; draw everything as shapes',
  iframe: 'embeds a page',
  a: 'is a link',
  animate: 'animates; office pictures are still',
  animateTransform: 'animates; office pictures are still',
  animateMotion: 'animates; office pictures are still',
  set: 'animates; office pictures are still',
}

/** The largest file accepted, in bytes. A drawn office is tens of kilobytes. */
export const MAX_SVG_BYTES = 1_000_000

/** A CSS value that reaches outside the file: a `url()` to anything but an id, or an import. */
const UNSAFE_CSS = /url\(\s*['"]?\s*(?!#)|@import|expression\(/i

/** Check one parsed SVG tree and list every reason it cannot be shown. */
export function checkSvgSafety(root: XmlElement): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  const seenElements = new Set<string>()

  for (const [element] of walk(root)) {
    const path = `svg:line ${element.line}`

    if (!ALLOWED_ELEMENTS.has(element.name)) {
      // One complaint per kind, not one per instance: a file with forty
      // `<image>` tags has one problem.
      if (!seenElements.has(element.name)) {
        seenElements.add(element.name)
        const why = REFUSED_ELEMENTS[element.name]
        issues.push(
          issue(
            TemplateError.SVG_UNSAFE,
            path,
            why === undefined
              ? `<${element.name}> is not something an office picture may contain.`
              : `<${element.name}> ${why}, and an office picture may not contain it.`,
            { element: element.name },
          ),
        )
      }
      continue
    }

    for (const [name, value] of Object.entries(element.attributes)) {
      const lower = name.toLowerCase()
      if (lower.startsWith('on')) {
        issues.push(
          issue(
            TemplateError.SVG_UNSAFE,
            path,
            `<${element.name}> has an event handler (${name}), which an office picture may not have.`,
            { element: element.name, attribute: name },
          ),
        )
        continue
      }
      if (lower === 'href' || lower === 'xlink:href') {
        if (!value.startsWith('#')) {
          issues.push(
            issue(
              TemplateError.SVG_UNSAFE,
              path,
              `<${element.name}> links to "${value}". An office picture may only reference its own ids (#…).`,
              { element: element.name, attribute: name },
            ),
          )
        }
        continue
      }
      if (lower === 'style' && UNSAFE_CSS.test(value)) {
        issues.push(
          issue(
            TemplateError.SVG_UNSAFE,
            path,
            `<${element.name}> has a style that reaches outside the file.`,
            { element: element.name, attribute: name },
          ),
        )
      }
    }

    if (element.name === 'style' && UNSAFE_CSS.test(element.text)) {
      issues.push(
        issue(
          TemplateError.SVG_UNSAFE,
          path,
          'A <style> block reaches outside the file (url() or @import).',
          { element: 'style' },
        ),
      )
    }
  }

  return issues
}
