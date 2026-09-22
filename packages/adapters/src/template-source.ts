import type { Template, TemplateIssue } from '@unityevolv/ofiskit-template'

/**
 * Where the office layout comes from.
 *
 * A file here, a database in unityofis. The engine reads a layout through this
 * and never anywhere else, which is why the same map component draws a template
 * someone downloaded from the free builder and one the product stores.
 */
export interface TemplateSource {
  /**
   * The layout for an office.
   *
   * Returns null when the office has no template, which a host may treat as "no
   * such office" rather than as an error.
   */
  get(officeId: string): Promise<Template | null>

  /**
   * How to reach the background image named in the template.
   *
   * The template stores a name, not a URL, because the same template is served
   * from a file system here and from object storage there. The host turns the
   * name into something a browser can fetch, and no hostname is ever a literal
   * in the engine.
   */
  imageUrl(officeId: string, name: string): string
}

/** A template file that could not be used, with everything wrong with it. */
export class TemplateInvalid extends Error {
  readonly issues: TemplateIssue[]

  constructor(where: string, issues: TemplateIssue[]) {
    super(
      `The template at ${where} is not usable:\n` +
        issues.map((issue) => `  - ${issue.path || 'template'}: ${issue.message}`).join('\n'),
    )
    this.name = 'TemplateInvalid'
    this.issues = issues
  }
}

/**
 * A template held in memory.
 *
 * For tests, and for the builder's preview, which has a layout in hand and no
 * file to read it from.
 */
export function staticTemplateSource(template: Template, imageBase = '/office'): TemplateSource {
  return {
    async get() {
      return template
    },
    imageUrl(_officeId, name) {
      return joinImagePath(imageBase, name)
    },
  }
}

/** A path, joined once, rather than concatenated at each call site. */
export function joinImagePath(imageBase: string, name: string): string {
  return `${imageBase.replace(/\/$/, '')}/${name.replace(/^\//, '')}`
}
