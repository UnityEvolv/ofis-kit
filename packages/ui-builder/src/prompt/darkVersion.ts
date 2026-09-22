/**
 * The dark version of an SVG background: the same office, after hours.
 *
 * Made from the light picture rather than drawn separately, because two drawings
 * of one office drift apart, and the symptom is a desk that exists in one theme
 * and not the other. Only an SVG can be recoloured this way; its colours are
 * text, so rewriting them rewrites the picture and nothing else. A raster image
 * would need a filter, and a filter darkens the lamps along with the walls.
 *
 * The rules are general, not tuned to any one drawing:
 *
 * - Pale colours (walls, floors, paper, sky) become dark, muted surfaces. They are
 *   most of the picture, so they are what makes it read as dark.
 * - Mid and deep colours (furniture, books, plants) are only dimmed, so the rooms
 *   keep their character and stay a step above the walls.
 * - Bright, warm, saturated colours are lights (lamps, bulbs, signs) and keep
 *   their colour, since that is what a lit office looks like at night.
 * - A white sheen laid over something stays white but quieter, and a glow fades
 *   to under half. Shadows get stronger, because a shadow at the old strength
 *   vanishes on a dark wall.
 *
 * Pure string work with no DOM, so it can be tested directly.
 */

/**
 * A hex colour, but not an id reference: `href="#bed"` and `url(#bed)` name an
 * element, and recolouring one would break the drawing.
 */
const COLOUR = /(?<!href=")(?<!url\()#([0-9a-f]{6}|[0-9a-f]{3})\b/gi

export function darkVersion(svg: string): string {
  return adjustOverlays(svg).replace(COLOUR, (match) => night(expand(match.toLowerCase())))
}

/**
 * Highlights and shadows, which are about opacity more than colour.
 *
 * Handled before the colour pass, which would otherwise darken a white sheen into
 * a grey smear. The colours are written as markers the colour pass turns back
 * into pure white and black; pure white or black anywhere else (paper, ink) is
 * ordinary colour and goes through the curve.
 */
function adjustOverlays(svg: string): string {
  return (
    svg
      // A white sheen: stays white, at about a third of its strength.
      .replace(
        /fill="#fff(?:fff)?"(\s+)opacity="([\d.]+)"/gi,
        (_, space: string, opacity: string) =>
          `fill="${KEEP_WHITE}"${space}opacity="${round(Number(opacity) * 0.35)}"`,
      )
      // A black overlay: a shadow, which needs to be stronger to show on a dark wall.
      .replace(
        /fill="#000(?:000)?"(\s+)opacity="([\d.]+)"/gi,
        (_, space: string, opacity: string) =>
          `fill="${KEEP_BLACK}"${space}opacity="${round(Math.min(0.4, Number(opacity) * 3))}"`,
      )
      // A glow is a gradient fading to nothing. At full strength on a dark wall it
      // reads as fog rather than light, so it is kept, at under half.
      .replace(
        /stop-opacity="([\d.]+)"/gi,
        (_, opacity: string) => `stop-opacity="${round(Number(opacity) * 0.45)}"`,
      )
      // Drop shadows: black, and stronger.
      .replace(/flood-color="[^"]*"/gi, `flood-color="${KEEP_BLACK}"`)
      .replace(
        /flood-opacity="([\d.]+)"/gi,
        (_, opacity: string) => `flood-opacity="${round(Math.min(0.6, Number(opacity) * 2))}"`,
      )
  )
}

/** Markers for overlays: one step off pure white and black, which no drawing will miss. */
const KEEP_WHITE = '#fffffe'
const KEEP_BLACK = '#000001'

/**
 * One colour at night.
 *
 * Lightness at or below 0.6 is scaled to 80%. Above it, lightness falls from
 * 0.48 to 0.17 for pure white, which puts walls and paper at a dark theme's
 * surface level while furniture stays a step above them. Pale colours also lose
 * half their saturation: a wall tinted enough to tell rooms apart by day is loud
 * at night.
 */
function night(hex: string): string {
  if (hex === KEEP_WHITE) return '#ffffff'
  if (hex === KEEP_BLACK) return '#000000'

  const [h, s, l] = toHsl(hex)
  if (isLight(h, s, l)) return hex

  const dark = l <= 0.6 ? l * 0.8 : 0.48 - ((l - 0.6) / 0.4) * 0.31
  return toHex(h, s * (l <= 0.6 ? 0.85 : 0.5), dark)
}

/**
 * A light source: a warm (orange to yellow), strongly saturated, bright colour.
 *
 * Narrow on purpose. Keeping a colour that should have darkened leaves a bright
 * patch on a dark wall, which is worse than a lamp that dims a little.
 */
function isLight(h: number, s: number, l: number): boolean {
  const degrees = h * 360
  return degrees >= 38 && degrees <= 60 && s >= 0.75 && l >= 0.55 && l <= 0.85
}

function expand(hex: string): string {
  if (hex.length !== 4) return hex
  const [, r = '0', g = '0', b = '0'] = hex
  return `#${r}${r}${g}${g}${b}${b}`
}

function toHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6
  return [h, s, l]
}

function toHex(h: number, s: number, l: number): string {
  const channel = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}
