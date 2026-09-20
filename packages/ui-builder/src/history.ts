import { useCallback, useState } from 'react'

/**
 * Undo and redo.
 *
 * Drawing a layout is fiddly and the author will make mistakes; a tool that
 * cannot take one back gets used cautiously, which is exactly the wrong way to
 * use a drawing tool.
 *
 * Whole snapshots rather than a command log. A template is small, the number of
 * edits in a session is in the hundreds, and a command log would mean writing an
 * inverse for every operation and getting one of them subtly wrong.
 */
export interface History<T> {
  value: T
  /** Replace the value and push the previous one onto the undo stack. */
  set(next: T): void
  /**
   * Replace without recording a step.
   *
   * For the middle of a drag: dragging a room across the canvas is one edit, not
   * sixty, and an undo stack full of one-pixel moves is useless.
   */
  replace(next: T): void
  /** Close the current drag, recording where it started. */
  commit(before: T): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
}

export function useHistory<T>(initial: T): History<T> {
  const [past, setPast] = useState<T[]>([])
  const [value, setValue] = useState(initial)
  const [future, setFuture] = useState<T[]>([])

  const set = useCallback(
    (next: T) => {
      setPast((stack) => [...stack.slice(-49), value])
      setValue(next)
      // A new edit after an undo abandons the redo branch, which is what every
      // editor does and what everybody expects.
      setFuture([])
    },
    [value],
  )

  const replace = useCallback((next: T) => setValue(next), [])

  const commit = useCallback((before: T) => {
    setPast((stack) => [...stack.slice(-49), before])
    setFuture([])
  }, [])

  const undo = useCallback(() => {
    setPast((stack) => {
      const previous = stack[stack.length - 1]
      if (previous === undefined) return stack
      setFuture((forward) => [value, ...forward])
      setValue(previous)
      return stack.slice(0, -1)
    })
  }, [value])

  const redo = useCallback(() => {
    setFuture((stack) => {
      const next = stack[0]
      if (next === undefined) return stack
      setPast((backward) => [...backward, value])
      setValue(next)
      return stack.slice(1)
    })
  }, [value])

  return {
    value,
    set,
    replace,
    commit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
