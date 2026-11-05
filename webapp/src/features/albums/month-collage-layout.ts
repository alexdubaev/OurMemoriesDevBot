import type { AlbumSource } from './model'

export const monthPhotoGap = 2
type Tile = { source: AlbumSource; index: number; x: number; y: number; width: number; height: number }
type Layout = { tiles: Tile[]; height: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const ratio = ({ attachment }: AlbumSource) => attachment?.width && attachment.height
  ? clamp(attachment.width / attachment.height, 0.55, 2.15)
  : 1

/** Pack each received page independently, so appending pages cannot repack a visible row. */
export function monthCollageLayout(pages: readonly AlbumSource[][], width: number, hasCover: boolean): Layout {
  const tiles: Tile[] = []
  if (width <= monthPhotoGap * 2) return { tiles, height: 0 }
  let y = 0
  let index = hasCover ? 1 : 0
  for (const page of pages) {
    for (let start = 0; start < page.length;) {
      const remaining = page.length - start
      const rowSize = remaining === 4 || remaining === 5 ? 2 : Math.min(3, remaining)
      const row = page.slice(start, start + rowSize)
      const [first, second, third] = row
      if (start % 2 === 0 && second && third && ratio(first) < 1.2) {
        const height = width * 0.66
        const left = (width - monthPhotoGap) * clamp(0.56 + (ratio(first) - 1) * 0.12, 0.48, 0.64)
        const right = width - monthPhotoGap - left
        const upper = (height - monthPhotoGap) * clamp(ratio(third) / (ratio(second) + ratio(third)), 0.37, 0.63)
        tiles.push(
          { source: first, index: index++, x: 0, y, width: left, height },
          { source: second, index: index++, x: left + monthPhotoGap, y, width: right, height: upper },
          { source: third, index: index++, x: left + monthPhotoGap, y: y + upper + monthPhotoGap, width: right, height: height - upper - monthPhotoGap },
        )
        y += height + monthPhotoGap
      } else {
        const available = width - (rowSize - 1) * monthPhotoGap
        const sum = row.reduce((total, source) => total + ratio(source), 0)
        const height = clamp(available / sum, width * 0.24, width * 0.66)
        let x = 0
        for (const source of row) {
          const tileWidth = available * ratio(source) / sum
          tiles.push({ source, index: index++, x, y, width: tileWidth, height })
          x += tileWidth + monthPhotoGap
        }
        y += height + monthPhotoGap
      }
      start += rowSize
    }
  }
  return { tiles, height: Math.max(0, y - monthPhotoGap) }
}
