import { readFile, stat } from 'node:fs/promises'

import { parseTemplate, type Template } from '@unityevolv/ofiskit-template'

import { TemplateInvalid, joinImagePath, type TemplateSource } from './template-source.js'

/*
 * The one template source that needs a file system, kept apart from the rest so
 * that everything else in this package runs in a browser and on a phone.
 */

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
      return joinImagePath(imageBase, name)
    },
  }
}
