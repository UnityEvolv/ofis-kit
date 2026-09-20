import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

/**
 * The bits every end-to-end test needs.
 *
 * Each person is their own browser context, not just another tab: a context has
 * its own storage, so two people are two devices rather than two windows
 * belonging to the same person. Getting that wrong makes the presence tests
 * pass for the wrong reason.
 */

export interface Person {
  context: BrowserContext
  page: Page
  name: string
}

/** Open a browser as somebody, walk in, and wait until the office is drawn. */
export async function walkIn(browser: Browser, name: string): Promise<Person> {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'] })
  const page = await context.newPage()

  await page.goto('/')
  await page.getByLabel('Email').fill(`${name.toLowerCase()}@example.com`)
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Walk in' }).click()

  // The map is a landmark region, so waiting for it is waiting for the office.
  await page.getByRole('region', { name: /office map/i }).waitFor()

  return { context, page, name }
}

/** The room group on the map, which is what a screen reader reads too. */
export function room(page: Page, name: string) {
  return page.getByRole('group', { name: new RegExp(`^${name},`, 'i') })
}

/** Move into a room by its name, the way a person would. */
export async function join(page: Page, name: string): Promise<void> {
  await room(page, name).getByRole('button', { name: 'Join' }).click()
}

/** Wait until somebody is visible in a given room, from this page's point of view. */
export async function seeIn(page: Page, roomName: string, who: string): Promise<void> {
  await room(page, roomName)
    .getByRole('img', { name: new RegExp(`^${who},`) })
    .waitFor({ timeout: 10_000 })
}

export async function leave(person: Person): Promise<void> {
  await person.context.close()
}

/**
 * Wait until nobody is left in the office.
 *
 * One server serves the whole run, so a person from the previous test is still
 * standing in a room for the length of the disconnect grace period. Two people
 * called Ada is an ambiguous locator and a confusing failure; starting each test
 * from an empty office removes a whole class of flake.
 *
 * It asks over the office's own read API, which is the same view a host would
 * use, rather than reaching into the server.
 */
export async function officeIsEmpty(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get('/v1/office')
        const office = (await response.json()) as { people: unknown[] }
        return office.people.length
      },
      { timeout: 20_000, message: 'waiting for the office to empty between tests' },
    )
    .toBe(0)
}
