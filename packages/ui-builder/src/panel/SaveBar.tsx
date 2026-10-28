import { Alert, Button, Icon } from '@unityevolv/unitykit'
import type { TemplateIssue } from '@unityevolv/ofiskit-template'

/**
 * Whether the layout is valid, and the one button that ends the job.
 *
 * Live, with the reasons visible: an author finds out while they are causing a
 * problem rather than when they try to save. Saving is refused while anything is
 * wrong, because the template is going somewhere that will have to render it.
 */

/** Enough to show what kind of trouble it is in without filling the panel. */
const SHOWN = 6

export function SaveBar(props: {
  issues: TemplateIssue[]
  /** Worth knowing, not worth refusing: shown under the verdict, never blocking it. */
  notes?: string[]
  saveLabel: string
  onSave(): void
}) {
  const { issues, notes = [] } = props

  return (
    <section className="border-t border-base-300 pt-3">
      {issues.length === 0 ? (
        <p className="flex items-center gap-1 text-sm text-success">
          <Icon name="check" size="sm" /> This layout is valid.
        </p>
      ) : (
        <Alert variant="warn" title={`${issues.length} to fix`}>
          <ul className="mt-1 space-y-1 text-xs">
            {issues.slice(0, SHOWN).map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-base-content/75">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <Button className="mt-3 w-full" disabled={issues.length > 0} onClick={props.onSave}>
        <Icon name="download" size="sm" /> {props.saveLabel}
      </Button>
    </section>
  )
}
