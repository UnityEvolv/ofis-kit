import { Alert, Button, Icon } from '@unityevolv/unitykit'
import {
  BuilderSteps,
  loadPromptDocument,
  type PromptDocument,
} from '@unityevolv/ofiskit-ui-builder'
import type { Template } from '@unityevolv/ofiskit-template'
import { useEffect, useState } from 'react'

/**
 * The builder, hosted as a page.
 *
 * The component takes a layout and emits a layout; this page is the host that
 * decides what to do with it, and here that means downloading `template.json`
 * and telling the person where to put it. In the wrapper apps the same
 * component is hosted by a page that saves to a database instead.
 *
 * Entirely client-side, which is why it can live on Pages next to the
 * documentation while the office itself needs a running process.
 */
export function BuilderPage({ onBack }: { onBack?: () => void }) {
  const [prompt, setPrompt] = useState<PromptDocument | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // Fetched rather than bundled, so improving the prompt reaches every author
  // without releasing the builder.
  useEffect(() => {
    loadPromptDocument('/background-prompt.json')
      .then(setPrompt)
      .catch((cause: unknown) => setFailed(cause instanceof Error ? cause.message : 'unknown'))
  }, [])

  function download(finished: Template) {
    const blob = new Blob([`${JSON.stringify(finished, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'template.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-base-300 bg-base-100 px-3 py-1.5">
        <span className="text-sm font-medium">Office builder</span>
        {onBack && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onBack}>
            <Icon name="chevron-left" size="sm" /> Back
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1">
        {failed && (
          <Alert variant="danger" className="m-4">
            The background prompt could not be loaded: {failed}
          </Alert>
        )}

        {!prompt && !failed && <p className="p-6 text-sm text-base-content/70">Loading…</p>}

        {prompt && (
          <BuilderSteps
            document={prompt}
            saveLabel="Download template.json"
            onSave={download}
            saveHint={(files) => (
              <>
                When you are done, download <code>template.json</code> and put it in the{' '}
                <code>config</code> folder next to your background images, named{' '}
                <code>{files.light}</code>
                {files.dark && (
                  <>
                    {' '}
                    and <code>{files.dark}</code>
                  </>
                )}
                . Restart the server and that is your office.
              </>
            )}
          />
        )}
      </div>
    </div>
  )
}
