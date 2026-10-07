import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { leave, officeIsEmpty, walkIn } from './helpers.js'

/**
 * Every page, in both themes, through axe.
 *
 * Not a substitute for using the thing with a screen reader, and not meant to
 * be: it is the floor. A missing label, a contrast that only fails in dark, a
 * landmark nobody named — the mistakes a reviewer misses because the page looks
 * fine to them. Run by `npm run test:a11y`.
 */

/** What axe found, reduced to what a failure message needs to say. */
async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    where: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

test.beforeEach(async ({ request }) => {
  await officeIsEmpty(request)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`in the ${colorScheme} theme`, () => {
    test('the way in', async ({ browser }) => {
      const context = await browser.newContext({ colorScheme })
      const page = await context.newPage()
      await page.goto('/')
      await page.getByLabel('Email').waitFor()

      expect(await violations(page)).toEqual([])
      await context.close()
    })

    test('the office', async ({ browser }) => {
      const ada = await walkIn(browser, 'Ada', { context: { colorScheme } })

      expect(await violations(ada.page)).toEqual([])
      await leave(ada)
    })

    test('the builder', async ({ browser }) => {
      const context = await browser.newContext({ colorScheme })
      const page = await context.newPage()
      await page.goto('/builder')
      await page.waitForLoadState('networkidle')

      expect(await violations(page)).toEqual([])
      await context.close()
    })
  })
}
