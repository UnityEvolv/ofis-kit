import { Alert, Button, Input } from '@unityevolv/unitykit'
import { useState } from 'react'

/**
 * The way in: an email and a name.
 *
 * The email is who you are and nothing checks it. There is no account, no
 * password and no verification, because there is no database for any of that to
 * live in. The screen says so plainly rather than letting somebody assume
 * otherwise and type something they would not want a stranger to see.
 */

export interface EntryScreenProps {
  onEnter(entry: { email: string; name: string }): Promise<string | null>
  /** True on the public demo, which anybody with the link can walk into. */
  demo: boolean
  initial?: { email: string; name: string } | null
}

export function EntryScreen({ onEnter, demo, initial }: EntryScreenProps) {
  const [email, setEmail] = useState(initial?.email ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(await onEnter({ email: email.trim(), name: name.trim() }))
    setBusy(false)
  }

  return (
    <main className="grid min-h-full place-items-center p-4">
      <div className="w-full max-w-sm">
        {demo && (
          <Alert variant="warn" title="This is a public demo" className="mb-4">
            Anyone with the link can walk in. Please do not say anything private. The office empties
            whenever the server restarts, because nothing here is stored.
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-3">
          <Input
            label="Email"
            help="This is who you are here. Nothing checks it and nothing is sent to it."
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ada@example.com"
          />

          <Input
            label="Name"
            help="What people see under your avatar."
            required
            autoComplete="name"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada"
          />

          {problem && <Alert variant="danger">{problem}</Alert>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Opening the door…' : 'Walk in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-base-content/60">
          No accounts, no chat, no database. You land in reception.
        </p>
      </div>
    </main>
  )
}
