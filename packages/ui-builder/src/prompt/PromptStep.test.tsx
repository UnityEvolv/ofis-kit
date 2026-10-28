import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import { PromptStep } from './PromptStep.js'
import type { OfficePrompt, PromptDocument } from './prompt.js'

/**
 * The second way to a picture: a prompt per theme and view, copied as it is.
 * The texts here are stand-ins; the real ones are generated and checked in
 * tools/office-prompt, which is the only place their content is tested.
 */

const here = dirname(fileURLToPath(import.meta.url))
let prompt: PromptDocument

beforeAll(async () => {
  const path = join(here, '..', '..', '..', '..', 'docs', 'background-prompt.json')
  prompt = JSON.parse(await readFile(path, 'utf8')) as PromptDocument
})

const PROMPTS: OfficePrompt[] = [
  {
    id: 'modern-cut',
    theme: 'modern',
    view: 'cut',
    label: 'Modern office, cutaway',
    text: 'MODERN',
  },
  { id: 'galaxy-top', theme: 'galaxy', view: 'top', label: 'Galaxy, top-down', text: 'GALAXY' },
]

/**
 * user-event installs a clipboard of its own when it is set up, so the copy
 * is read back from that rather than from a stub put in place beforehand.
 */
async function copied(): Promise<string> {
  return navigator.clipboard.readText()
}

describe('the office prompts', () => {
  it('are not offered when the host has none', () => {
    render(<PromptStep document={prompt} shape="landscape" onShapeChange={() => {}} />)
    expect(screen.queryByText('Or have your AI draw the office')).toBeNull()
  })

  it('copy the one for the chosen theme and view', async () => {
    const person = userEvent.setup()
    render(
      <PromptStep
        document={prompt}
        shape="landscape"
        onShapeChange={() => {}}
        officePrompts={PROMPTS}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Modern office, cutaway', pressed: true }),
    ).toBeTruthy()
    const copyOffice = () => screen.getByRole('button', { name: /office prompt$/ })
    await person.click(copyOffice())
    expect(await copied()).toBe('MODERN')
    expect(copyOffice()).toHaveTextContent('Copied office prompt')

    await person.click(screen.getByRole('button', { name: 'Galaxy, top-down' }))
    expect(screen.getByRole('textbox', { name: 'The office prompt' })).toHaveValue('GALAXY')
    await person.click(copyOffice())
    expect(await copied()).toBe('GALAXY')

    // The picture prompt's own copy button is unchanged by the second one.
    await person.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await copied()).toContain('floor plan')
  })
})
