import { expect, test, type Browser, type Page } from '@playwright/test'

import { join, leave, officeIsEmpty, room, seeIn, walkIn } from './helpers.js'

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

test('the tiles appear beside the office, and your own is pinned', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')

  await join(ada.page, 'Studio')
  await join(grace.page, 'Studio')
  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await grace.page.getByRole('button', { name: 'Turn on microphone' }).click()

  // A strip on this office, because its canvas is landscape: width to spare and
  // height at a premium.
  const strip = ada.page.getByTestId('call-tiles')
  await expect(strip).toHaveAttribute('data-placement', 'top')

  // Two tiles: Ada's own, pinned, and Grace's.
  await expect(strip.getByTestId(/^tile-/)).toHaveCount(2)
  await expect(strip.getByText('You')).toBeVisible()

  // And the map is still there beside them.
  await expect(ada.page.getByRole('region', { name: /office map/i })).toBeVisible()

  await leave(ada)
  await leave(grace)
})

test('muting somebody for yourself silences them for you and nobody else', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')

  await join(ada.page, 'Studio')
  await join(grace.page, 'Studio')
  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await grace.page.getByRole('button', { name: 'Turn on microphone' }).click()

  await ada.page.getByRole('button', { name: /mute grace for yourself only/i }).click()

  // Muted on Ada's side: the audio element for Grace's leg, and nothing else.
  await expect
    .poll(() =>
      ada.page.evaluate(() => [...document.querySelectorAll('audio')].map((one) => one.muted)),
    )
    .toEqual([true])
  await expect(ada.page.getByText(/muted for you/i)).toBeVisible()

  // Grace is not told, and hears Ada exactly as before.
  await expect(grace.page.getByText(/muted for you/i)).toHaveCount(0)
  await expect
    .poll(() =>
      grace.page.evaluate(() => [...document.querySelectorAll('audio')].map((one) => one.muted)),
    )
    .toEqual([false])

  await leave(ada)
  await leave(grace)
})

test('a call is visible from outside the room, and the speaker lights up inside it', async ({
  browser,
}) => {
  // The story's done-when, both halves. The first is what somebody standing
  // somewhere else sees; the second is what somebody in the room sees.
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')
  const cleo = await walkIn(browser, 'Cleo')

  await join(ada.page, 'Studio')
  await join(grace.page, 'Studio')
  await ada.page.getByRole('button', { name: 'Turn on microphone' }).click()
  await grace.page.getByRole('button', { name: 'Turn on microphone' }).click()

  /*
   * Cleo never went anywhere near Studio.
   *
   * She is in reception, looking at the map, and the room bar tells her there is
   * a conversation in there and how many people are in it — which is the whole
   * reason the call is on the bar rather than only inside the room.
   */
  await expect(room(cleo.page, 'Studio').getByRole('img', { name: /call with 2 people/i })).toBeVisible({
    timeout: 10_000,
  })

  // And the same thing said to a screen reader arrowing between rooms.
  await expect(room(cleo.page, 'Studio')).toHaveAttribute(
    'aria-label',
    /call with 2 people/i,
  )

  /*
   * Inside the room, whoever is talking lights up.
   *
   * Chromium's fake microphone plays a repeating tone rather than silence, so Ada
   * is talking as far as the level meter is concerned — but only while her tab is
   * the one in front, because Chromium throttles a background tab's timers to
   * roughly once a second and the meter then samples between the beeps. Nothing
   * about the product depends on that; a person talking is looking at their own
   * screen. So Ada is brought to the front, and the assertion is still made on
   * Grace's page, which is the point: Grace sees who is talking.
   */
  await ada.page.bringToFront()

  await expect(
    room(grace.page, 'Studio').getByRole('img', { name: /^Ada,.*speaking/i }),
  ).toBeVisible({ timeout: 15_000 })

  await leave(ada)
  await leave(grace)
  await leave(cleo)
})

test('a raised hand reaches everybody and moves that person to the front', async ({ browser }) => {
  // The story's done-when. Six people would be the honest demonstration of the
  // paging half, but the provider's cap is four — so the ordering is asserted on
  // the strip, which is the thing paging reads.
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')
  const cleo = await walkIn(browser, 'Cleo')

  for (const person of [ada, grace, cleo]) {
    await join(person.page, 'Studio')
    await person.page.getByRole('button', { name: 'Turn on microphone' }).click()
    await expect(person.page.getByRole('button', { name: 'Leave call' })).toBeVisible()
  }

  await cleo.page.getByRole('button', { name: 'Raise your hand' }).click()

  // Everybody sees it, and the avatar on the map says it as well as drawing it.
  await expect(ada.page.getByRole('img', { name: /^Cleo,.*hand raised/i })).toBeVisible({
    timeout: 10_000,
  })

  /*
   * And she is first among the others.
   *
   * Your own tile is pinned and is not one of the five, so the order being asserted
   * is the order of everybody else — which is exactly what paging slices.
   */
  await expect
    .poll(
      async () =>
        ada.page
          .getByTestId('call-tiles')
          .getByTestId(/^tile-/)
          .evaluateAll((tiles) =>
            tiles.map((tile) => tile.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
          ),
      { timeout: 10_000 },
    )
    .toEqual([
      expect.stringContaining('You'),
      expect.stringContaining('Cleo'),
      expect.stringContaining('Grace'),
    ])

  // Pressing it again puts it down, and the badge goes with it.
  await cleo.page.getByRole('button', { name: 'Lower your hand' }).click()
  await expect(ada.page.getByRole('img', { name: /^Cleo,.*hand raised/i })).toHaveCount(0, {
    timeout: 10_000,
  })

  for (const person of [ada, grace, cleo]) await leave(person)
})

test('a reaction appears over the right person and clears on its own', async ({ browser }) => {
  const ada = await walkIn(browser, 'Ada')
  const grace = await walkIn(browser, 'Grace')

  await join(ada.page, 'Studio')
  await join(grace.page, 'Studio')
  for (const person of [ada, grace]) {
    await person.page.getByRole('button', { name: 'Turn on microphone' }).click()
    await expect(person.page.getByRole('button', { name: 'Leave call' })).toBeVisible()
  }

  await grace.page.getByRole('button', { name: 'React' }).click()
  await grace.page.getByRole('button', { name: /react with applause/i }).click()

  // Over Grace's tile on Ada's screen, and nowhere near Ada's own.
  const gracesTile = ada.page.getByTestId(/^tile-/).filter({ hasText: 'Grace' })
  await expect(gracesTile.getByTestId('reaction-float')).toBeVisible({ timeout: 10_000 })
  await expect(
    ada.page.getByTestId(/^tile-/).filter({ hasText: 'You' }).getByTestId('reaction-float'),
  ).toHaveCount(0)

  /*
   * And it goes by itself, with nobody dismissing it.
   *
   * Nothing about a reaction is stored — not on the server, not in the office
   * state, not on the client — so this is the assertion that it really is an event
   * rather than something that will still be on screen in an hour.
   */
  await expect(ada.page.getByTestId('reaction-float')).toHaveCount(0, { timeout: 15_000 })

  await leave(ada)
  await leave(grace)
})

/**
 * Two people in the studio call, microphones on.
 *
 * The share tests all start here, and none of them is about joining.
 */
async function calling(browser: Browser, names: string[]) {
  const people = []
  for (const name of names) {
    const person = await walkIn(browser, name)
    await join(person.page, 'Studio')
    await person.page.getByRole('button', { name: 'Turn on microphone' }).click()
    await expect(person.page.getByRole('button', { name: 'Leave call' })).toBeVisible()
    people.push(person)
  }
  return people
}

test('a share takes over everybody’s view, and gives it back', async ({ browser }) => {
  const [ada, grace] = await calling(browser, ['Ada', 'Grace'])
  if (!ada || !grace) throw new Error('both people are needed')

  // Grace is looking at the office, which is where the automatic switch matters:
  // somebody on the map would otherwise never see what was put on screen.
  await expect(grace.page.getByRole('region', { name: /office map/i })).toBeVisible()

  await ada.page.getByRole('button', { name: 'Share your screen' }).click()

  /*
   * The story's done-when, from the other person's browser.
   *
   * Chromium picked the source without a click, and everything after that is the
   * product: the slot, the diff, the view switching, and the stage.
   */
  await expect(grace.page.getByTestId('call-view')).toBeVisible({ timeout: 15_000 })
  await expect(grace.page.getByLabel('Ada: shared screen')).toBeVisible({ timeout: 15_000 })

  /*
   * And it is really the screen, playing.
   *
   * A stream from a peer carries nothing that says whether it is a face or a
   * spreadsheet, so the sharer says which of its streams is the screen and the
   * receiver files it accordingly. An element with a name and no frames in it would
   * satisfy everything above and be exactly the bug that mistake produces.
   */
  await expect
    .poll(
      () =>
        grace.page
          .getByLabel('Ada: shared screen')
          .evaluate((element) => (element as HTMLVideoElement).videoWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0)

  // And the sharer has a reminder and a way out, in whichever view they are in.
  await expect(ada.page.getByTestId('sharing-banner')).toBeVisible()
  // Never a mirror: her own screen is not played back to her.
  await expect(ada.page.getByTestId('share-stage')).toHaveText(/you are sharing your screen/i)

  await ada.page.getByTestId('sharing-banner').getByRole('button', { name: /stop sharing/i }).click()

  // Back to the map she was on, which is the half that makes the switch acceptable
  // rather than annoying.
  await expect(grace.page.getByTestId('share-stage')).toHaveCount(0, { timeout: 15_000 })
  await expect(grace.page.getByRole('region', { name: /office map/i })).toBeVisible()
  await expect(ada.page.getByTestId('sharing-banner')).toHaveCount(0)

  await leave(ada)
  await leave(grace)
})

test('a second share asks first, and then takes the slot', async ({ browser }) => {
  const [ada, grace] = await calling(browser, ['Ada', 'Grace'])
  if (!ada || !grace) throw new Error('both people are needed')

  await ada.page.getByRole('button', { name: 'Share your screen' }).click()
  await expect(grace.page.getByLabel('Ada: shared screen')).toBeVisible({ timeout: 15_000 })

  // The control says what it would do rather than what it is, because pressing it
  // ends somebody else's share.
  await grace.page.getByRole('button', { name: 'Share your screen instead' }).click()

  const dialog = grace.page.getByRole('dialog')
  await expect(dialog).toContainText(/ada is sharing/i)
  await dialog.getByRole('button', { name: 'Take over' }).click()

  /*
   * One slot, so one share.
   *
   * Ada's own client stops capturing because the server told her socket to, which is
   * the only way a share can end on a machine the server cannot reach into.
   */
  await expect(ada.page.getByLabel('Grace: shared screen')).toBeVisible({ timeout: 15_000 })
  await expect(ada.page.getByTestId('sharing-banner')).toHaveCount(0)
  await expect(grace.page.getByTestId('sharing-banner')).toBeVisible()

  await leave(ada)
  await leave(grace)
})
