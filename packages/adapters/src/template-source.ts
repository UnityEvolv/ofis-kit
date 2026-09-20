import { readFile, stat } from 'node:fs/promises'

import { parseTemplate, type Template, type TemplateIssue } from '@unityevolv/ofiskit-template'

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

export interface FileTemplateSourceOptions {
  /** The template.json to read. */
  path: string
  /**
   * Where the app serves the background images from, as a path and never an
   * origin. The app is served from the same place, so a path is all that is
   * needed and a hostname here would have to be reconfigured to move the
   * product to another domain.
   */
  imageBase?: string
  /**
   * Re-read the file when it changes on disk.
   *
   * On in development, so editing the office is a save and a refresh rather than
   * a restart. Off in production: the file is not going to change under a
   * running process, and checking its timestamp on every read is work for
   * nothing.
   */
  watch?: boolean
}

/**
 * The free office's template source: one file on disk.
 *
 * This is the office. Replace `config/template.json` and the image beside it and
 * you have replaced the office; nothing else in the product needs to know. That
 * is deliberately the entire configuration surface for a layout.
 *
 * The file is validated on every read, not only at startup, because it is a file
 * a person edits by hand and the failure to catch is a typo rather than a
 * corruption. An invalid file raises with every problem listed, so the fix is
 * one pass rather than five restarts.
 */
export function fileTemplateSource(options: FileTemplateSourceOptions): TemplateSource {
  const { path, imageBase = '/office', watch = false } = options

  let cached: { template: Template; modifiedAt: number } | null = null

  return {
    async get(): Promise<Template> {
      if (cached && !watch) return cached.template

      if (cached && watch) {
        const { mtimeMs } = await stat(path)
        if (mtimeMs === cached.modifiedAt) return cached.template
      }

      const json = await readFile(path, 'utf8')
      const result = parseTemplate(json)
      if (!result.ok) throw new TemplateInvalid(path, result.issues)

      const { mtimeMs } = await stat(path)
      cached = { template: result.value, modifiedAt: mtimeMs }
      return result.value
    },

    imageUrl(_officeId: string, name: string): string {
      // A path, joined once, rather than concatenated at each call site.
      return `${imageBase.replace(/\/$/, '')}/${name.replace(/^\//, '')}`
    },
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
      return `${imageBase.replace(/\/$/, '')}/${name.replace(/^\//, '')}`
    },
  }
}
