import { expect, test, type Page } from '@playwright/test'

import { join, leave, officeIsEmpty, seeIn, walkIn } from './helpers.js'

/**
 * A real call between two real browsers.
 *
 * This is the only test in the repository that could not be written any other
 * way. Everything else about the office can be checked with a component test; a
 * call cannot, because the thing that breaks is two browsers failing to agree on
 * a connection, and a mocked peer agrees with itself every time.
 *
 * Chromium runs with fake media devices, so `getUserMedia` succeeds on a machine
 * with no camera and produces a known tone. No credentials are involved, which is
 * why this can run on a public repository.
 */

/** Ask the page what its own peer connections are actually doing. */
async function connectionStates(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = globalThis as unknown as { __ofiskitPeers?: RTCPeerConnection[] }
    return (seen.__ofiskitPeers ?? []).map((peer) => peer.connectionState)
  })
}

/**
 * Watch every peer connection the page makes.
 *
 * Installed before the app loads, by wrapping the constructor. The alternative is
 * asserting on what the UI drew, which would pass with two tiles on screen and no
 * media flowing between them — exactly the failure this test exists to catch.
 */
async function watchPeers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = globalThis as unknown as {
      __ofiskitPeers?: RTCPeerConnection[]
      RTCPeerConnection: typeof RTCPeerConnection
    }
    scope.__ofiskitPeers = []
    const Original = scope.RTCPeerConnection
    scope.RTCPeerConnection = function (...args: ConstructorParameters<typeof RTCPeerConnection>) {
      const peer = new Original(...args)
      scope.__ofiskitPeers?.push(peer)
      return peer
    } as unknown as typeof RTCPeerConnection
    scope.RTCPeerConnection.prototype = Original.prototype
  })
}

test.beforeEach(async ({ request }) => {
  await officeIsEmpty(request)
})

test('two people in a room hear each other', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada', { before: watchPeers })
  const grace = await walkIn(browser, 'Grace', { before: watchPeers })

  await join(ada.page, 'Studio')
  await join(grace.page, 'Studio')
  await seeIn(ada.page, 'Studio', 'Grace')

  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await grace.page.getByRole('button', { name: 'Turn on microphone' }).click()

  // Both are in the call as far as the office is concerned.
  await expect(ada.page.getByRole('button', { name: 'Leave call' })).toBeVisible()
  await expect(grace.page.getByRole('button', { name: 'Leave call' })).toBeVisible()

  // And, the part that matters: the peer connection actually completed. The
  // server never saw a byte of this — it only relayed the offer and the answer.
  await expect
    .poll(() => connectionStates(ada.page), { timeout: 20_000 })
    .toContain('connected')
  await expect.poll(() => connectionStates(grace.page), { timeout: 20_000 }).toContain('connected')

  await leave(ada)
  await leave(grace)
})

test('leaving the call keeps you in the room', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')

  await join(ada.page, 'Studio')
  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await expect(ada.page.getByRole('button', { name: 'Leave call' })).toBeVisible()

  await ada.page.getByRole('button', { name: 'Leave call' }).click()

  // Presence and the call are separate things: leaving the conversation is not
  // leaving the room.
  await expect(ada.page.getByRole('button', { name: 'Turn on microphone' })).toBeVisible()
  // Scoped to the bar: the announcer's live region says the same words, which is
  // correct for each and ambiguous for a locator.
  await expect(ada.page.getByRole('toolbar')).toContainText(/You are in Studio/i)

  await leave(ada)
})

test('leaving the room leaves the call', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')

  await join(ada.page, 'Studio')
  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await expect(ada.page.getByRole('button', { name: 'Leave call' })).toBeVisible()

  await ada.page.getByRole('button', { name: /back to reception/i }).click()

  // The conversation belongs to the room. Reception has no calls at all, so the
  // control is gone rather than offering to join one.
  await expect(ada.page.getByRole('button', { name: /call/i })).toHaveCount(0)

  await leave(ada)
})

test('a fifth participant is refused, and told the number', async ({ browser }) => {
  // Five browsers, and a four-way mesh to build before the fifth is even asked:
  // genuinely slow rather than stuck.
  test.slow()

  // The provider declares four, and the cap is the provider's rather than a
  // number the call layer picked.
  const people = []
  for (const name of ['One', 'Two', 'Three', 'Four']) {
    const person = await walkIn(browser, name)
    await join(person.page, 'Studio')
    await person.page.getByRole('button', { name: 'Turn on microphone' }).click()
    await expect(person.page.getByRole('button', { name: 'Leave call' })).toBeVisible()
    people.push(person)
  }

  const fifth = await walkIn(browser, 'Five')
  await join(fifth.page, 'Studio')

  /*
   * The fifth person cannot press it, and is told why.
   *
   * Disabled and visible rather than hidden, with the reason beside the controls
   * where a touch screen can read it — a tooltip is invisible on one. The server
   * refuses a fifth leg independently, which the engine's own tests cover: the
   * disabled state is a convenience and never the control.
   */
  await expect(fifth.page.getByRole('button', { name: 'Turn on microphone' })).toBeDisabled({
    timeout: 10_000,
  })
  await expect(fifth.page.getByRole('note')).toContainText(/this call is full \(4 people\)/i)

  for (const person of [...people, fifth]) await leave(person)
})

test('the other person is actually audible', async ({ browser }) => {
  // The failure this catches is invisible: peer connections succeed, the tiles
  // appear, the indicators move, and nobody can hear anybody, because a stream
  // that is never attached to an element is a stream the browser does not play.
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')

  await join(ada.page, 'Studio')
  await join(grace.page, 'Studio')
  await seeIn(ada.page, 'Studio', 'Grace')

  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await grace.page.getByRole('button', { name: 'Turn on microphone' }).click()

  // An audio element, with a stream on it, playing by itself.
  const playing = async (page: typeof ada.page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('audio')].map((element) => ({
        hasStream: element.srcObject !== null,
        muted: element.muted,
      })),
    )

  await expect.poll(() => playing(ada.page), { timeout: 20_000 }).toContainEqual({
    hasStream: true,
    muted: false,
  })
  await expect.poll(() => playing(grace.page), { timeout: 20_000 }).toContainEqual({
    hasStream: true,
    muted: false,
  })

  await leave(ada)
  await leave(grace)
})

test('the microphone joins with audio only, and the camera adds video without interrupting it', async ({
  browser,
}) => {
  // The story's done-when, and the rule that catches people out: entering a room
  // never joins its call, and each control joins with exactly what was pressed.
  const ada = await walkIn(browser, 'Ada', { before: watchPeers })
  const grace = await walkIn(browser, 'Grace')

  await join(ada.page, 'Studio')
  await join(grace.page, 'Studio')
  await seeIn(grace.page, 'Studio', 'Ada')

  // Being in the room is not being in the call.
  await expect(ada.page.getByRole('button', { name: 'Turn on microphone' })).toBeVisible()
  await expect(ada.page.getByRole('button', { name: 'Leave call' })).toHaveCount(0)

  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()

  // In, with audio. The camera stays off until it is pressed.
  await expect(ada.page.getByRole('button', { name: 'Mute microphone' })).toBeVisible()
  await expect(ada.page.getByRole('button', { name: 'Turn on camera' })).toBeVisible()

  // Grace can see that Ada is in the call and has no camera on.
  await expect
    .poll(
      async () =>
        grace.page.evaluate(async () => {
          const response = await fetch('/v1/office')
          const office = (await response.json()) as {
            people: Array<{ displayName: string; devices: Array<{ inCall: boolean; cameraOn: boolean }> }>
          }
          return office.people.find((one) => one.displayName === 'Ada')?.devices[0]
        }),
      { timeout: 10_000 },
    )
    .toMatchObject({ inCall: true, cameraOn: false })

  // Grace joins too, so there is somebody to be connected to — and so the camera
  // going on has a connection to renegotiate.
  await grace.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await expect.poll(() => connectionStates(ada.page), { timeout: 20_000 }).toContain('connected')

  await ada.page.getByRole('button', { name: 'Turn on camera' }).click()
  await expect(ada.page.getByRole('button', { name: 'Turn off camera' })).toBeVisible()

  /*
   * The camera went on and the audio was never interrupted.
   *
   * The same connection, renegotiated: still `connected`, and never `failed` or
   * back to `connecting`. Turning a camera on renegotiating the whole connection
   * from scratch is the failure this asserts against.
   */
  expect(await connectionStates(ada.page)).toContain('connected')
  await expect(ada.page.getByRole('button', { name: 'Mute microphone' })).toBeVisible()

  await leave(ada)
  await leave(grace)
})

test('the call view swaps the map for the call, and the toggle brings it back', async ({
  browser,
}) => {
  const ada = await walkIn(browser, 'Ada')
  await join(ada.page, 'Studio')
  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()

  await ada.page.getByRole('button', { name: 'Show the call full size' }).click()

  // The map is gone and the call has the space.
  await expect(ada.page.getByTestId('call-view')).toBeVisible()
  await expect(ada.page.getByRole('region', { name: /office map/i })).toHaveCount(0)

  await ada.page.getByRole('button', { name: 'Show the office map' }).click()

  // A different view of the same office rather than a different place, so it comes
  // straight back.
  await expect(ada.page.getByRole('region', { name: /office map/i })).toBeVisible()

  await leave(ada)
})
