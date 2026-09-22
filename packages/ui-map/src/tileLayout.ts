/**
 * How to lay a call's tiles out in the space it has.
 *
 * The way every video product fills a screen: try every number of columns, work out
 * how big a tile of the video's own shape could be for each, and keep the biggest.
 * Four people on a desktop come out as a two-by-two filling the window; four on a
 * phone held upright come out as a column, because four landscape pictures are
 * bigger stacked than squeezed side by side.
 *
 * The tile is the video's shape, so nothing has to be cropped to fill it. That is
 * the difference from dividing the space into equal cells and cropping each
 * picture to its cell, which fills every pixel and cuts off whoever is at the edge
 * of the frame.
 *
 * Pure, so the arithmetic is tested without a screen.
 */

/** A camera's shape. Most are 16:9, and a tile of any other shape crops or letterboxes. */
export const VIDEO_ASPECT = 16 / 9

export interface TileLayout {
  columns: number
  rows: number
  /** Whole pixels, rounded down, so the row always fits in the width it was given. */
  tileWidth: number
  tileHeight: number
}

export function tileLayout(
  count: number,
  width: number,
  height: number,
  gap = 8,
  aspect = VIDEO_ASPECT,
): TileLayout {
  if (count <= 0 || width <= 0 || height <= 0) {
    return { columns: 1, rows: Math.max(1, count), tileWidth: 0, tileHeight: 0 }
  }

  let best: TileLayout = { columns: 1, rows: count, tileWidth: 0, tileHeight: 0 }

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns)
    // As wide as the columns allow, unless the rows make it too tall for the space.
    const byWidth = (width - gap * (columns - 1)) / columns
    const byHeight = ((height - gap * (rows - 1)) / rows) * aspect
    const tileWidth = Math.min(byWidth, byHeight)

    if (tileWidth > best.tileWidth) {
      best = { columns, rows, tileWidth, tileHeight: tileWidth / aspect }
    }
  }

  return {
    columns: best.columns,
    rows: best.rows,
    tileWidth: Math.max(0, Math.floor(best.tileWidth)),
    tileHeight: Math.max(0, Math.floor(best.tileHeight)),
  }
}
