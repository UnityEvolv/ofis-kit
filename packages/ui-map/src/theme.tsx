import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Light and dark, per person.
 *
 * Theme is a per-user setting rather than a per-office one, which has a visible
 * consequence: two people standing in the same room may be looking at different
 * background images over identical geometry. That is deliberate, and it is why
 * the template carries two image slots against one set of room coordinates.
 *
 * Everything else follows from `data-theme` on the document element, because
 * every colour in the product comes from a unitykit token and the tokens are
 * defined per theme. No component here chooses a colour.
 */

export type Theme = 'light' | 'dark'
export type ThemeChoice = Theme | 'system'

interface ThemeValue {
  /** What is actually being shown right now. */
  theme: Theme
  /** What the person chose, which may be to follow the system. */
  choice: ThemeChoice
  setChoice(choice: ThemeChoice): void
}

const ThemeContext = createContext<ThemeValue | null>(null)

const STORAGE_KEY = 'ofiskit:theme'

/** Reading storage throws in some privacy modes, and that must not break the app. */
function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice)
  const [system, setSystem] = useState<Theme>(() =>
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )

  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const theme: Theme = choice === 'system' ? system : choice

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // Tells the browser to draw form controls, scrollbars and the address bar
    // to match, which is the difference between a dark page and a dark app.
    document.documentElement.style.colorScheme = theme
  }, [theme])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A remembered preference is a convenience. Losing it is survivable.
    }
  }, [])

  const value = useMemo(() => ({ theme, choice, setChoice }), [theme, choice, setChoice])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) {
    // A sensible answer rather than a crash: a component rendered outside the
    // provider should still draw, in light mode, rather than take the page down.
    return { theme: 'light', choice: 'system', setChoice: () => {} }
  }
  return value
}
