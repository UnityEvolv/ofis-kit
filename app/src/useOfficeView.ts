import { useMediaQuery, usePersisted, type OfficeView } from '@unityevolv/ofiskit-ui-map'

/**
 * Map or list, and whether this is a phone-sized screen.
 *
 * A landscape office fitted to a phone's width is a strip a few centimetres tall,
 * with room bars covering most of every room, which is the map at its least
 * useful. The list carries the same people, the same actions and the same live
 * state, so a narrow screen starts there — and a person who picks the map is
 * remembered as having picked it, because that was a choice and this is only the
 * default.
 *
 * The same breakpoint as Tailwind's `sm`, so what this decides and what the
 * stylesheet lays out agree about which screens are phones.
 */
export const PHONE_QUERY = '(max-width: 639px)'

export function useOfficeView(): {
  view: OfficeView
  setView(view: OfficeView): void
  narrow: boolean
} {
  const narrow = useMediaQuery(PHONE_QUERY)
  const [chosen, setView] = usePersisted<OfficeView | null>('ofiskit:view', null)

  return { view: chosen ?? (narrow ? 'list' : 'map'), setView, narrow }
}
