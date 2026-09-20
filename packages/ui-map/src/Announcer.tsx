import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

/**
 * Things that happen *to* you, said out loud.
 *
 * A knock, somebody admitting you, a call starting, a move being refused: all of
 * these are drawn somewhere on the screen, and somebody using a screen reader
 * will not know any of them happened. Drawing is not telling.
 *
 * Two regions rather than one, because the distinction matters to how a screen
 * reader behaves: `polite` waits for a pause, `assertive` interrupts. Almost
 * everything is polite. A knock is assertive, because somebody is standing
 * outside the door waiting for an answer.
 */

interface AnnouncerValue {
  announce(message: string, urgency?: 'polite' | 'assertive'): void
}

/**
 * Appended to repeat an announcement.
 *
 * Most screen readers ignore a live region whose text has not changed, so two
 * people knocking one after the other would be announced once. A zero-width
 * space makes it a different string and is not read out or drawn.
 */
const REPEAT_MARK = String.fromCharCode(0x200b)

const AnnouncerContext = createContext<AnnouncerValue | null>(null)

export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  const previous = useRef('')

  const announce = useCallback((message: string, urgency: 'polite' | 'assertive' = 'polite') => {
    const text = message === previous.current ? `${message}${REPEAT_MARK}` : message
    previous.current = text
    if (urgency === 'assertive') setAssertive(text)
    else setPolite(text)
  }, [])

  const value = useMemo(() => ({ announce }), [announce])

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      {/*
        Visually hidden rather than display:none. A hidden region is not read at
        all, which is the mistake that makes a live region look implemented and
        do nothing.
      */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  )
}

export function useAnnounce(): AnnouncerValue['announce'] {
  // A component outside the provider should still work, silently, rather than
  // taking the page down over an announcement.
  return useContext(AnnouncerContext)?.announce ?? (() => {})
}
