import { expect, test } from '@playwright/test'

import { join, leave, officeIsEmpty, room, seeIn, walkIn } from './helpers.js'

/**
 * Two browsers, one office.
 *
 * Everything here could almost be a component test, and one thing could not:
 * whether two people actually see each other. That needs two browsers, a real
 * socket and a real server, because what breaks is the agreement between them and
 * a mocked client agrees with itself every time.
 */

test.beforeEach(async ({ request }) => {
  await officeIsEmpty(request)
})

test('two people see each other move between rooms', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')

  // Both land in reception, and each can see the other there.
  await seeIn(ada.page, 'Reception', 'Grace')
  await seeIn(grace.page, 'Reception', 'Ada')

  await join(ada.page, 'Studio')

  // The one that matters: Grace's screen, which nobody touched.
  await seeIn(grace.page, 'Studio', 'Ada')
  await expect(
    room(grace.page, 'Reception').getByRole('img', { name: /^Ada,/ }),
  ).toHaveCount(0)

  await leave(ada)
  await leave(grace)
})

test('a reload puts somebody back in the room they were in', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')
  await join(ada.page, 'Studio')
  await seeIn(ada.page, 'Studio', 'Ada')

  await ada.page.reload()

  // Not reception. Coming back to the lobby every time you refresh is the kind of
  // small rudeness that makes a product feel careless — and the name is not typed
  // again either.
  await seeIn(ada.page, 'Studio', 'Ada')
  await expect(ada.page.getByRole('region', { name: /office map/i })).toBeVisible()

  await leave(ada)
})

test('a room says it is locked, and knocking is offered in place of joining', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')

  await join(ada.page, 'Studio')
  await room(ada.page, 'Studio').getByRole('button', { name: 'Lock' }).click()

  // From outside, on the other browser: the door is shut and the control changes.
  await expect(room(grace.page, 'Studio')).toHaveAttribute(
    'aria-label',
    /locked, press Enter to knock/i,
  )
  await expect(room(grace.page, 'Studio').getByRole('button', { name: 'Knock' })).toBeEnabled()

  await leave(ada)
  await leave(grace)
})

test('the list view shows the same office as the map', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')

  await join(grace.page, 'Studio')
  await seeIn(ada.page, 'Studio', 'Grace')

  await ada.page.getByRole('button', { name: 'List' }).click()

  // The same state and the same actions, which is the only reason it is safe to
  // offer as the accessible alternative at all.
  const list = ada.page.getByRole('navigation', { name: /rooms/i })
  await expect(list).toBeVisible()
  await expect(
    list.getByRole('list', { name: /people in Studio/i }).getByRole('img', { name: /^Grace,/ }),
  ).toBeVisible()

  await leave(ada)
  await leave(grace)
})

test('a second device follows the first, because presence is per user', async ({ browser }) => {
  // Two contexts with the same email is one person on two devices: each context
  // has its own storage, so each gets its own device id.
  const laptop = await walkIn(browser, 'Ada')
  const phone = await walkIn(browser, 'Ada')

  await join(laptop.page, 'Studio')

  // Moving on one device moves the person, so the other device sees it too —
  // without anybody touching the phone.
  await expect(phone.page.getByText(/You are in Studio/i)).toBeVisible({ timeout: 10_000 })

  // And there is still one Ada in the room, not one per device. Presence is per
  // user, and the map says the same thing the engine does.
  await expect(room(phone.page, 'Studio').getByRole('img', { name: /^Ada,/ })).toHaveCount(1)

  await leave(laptop)
  await leave(phone)
})
