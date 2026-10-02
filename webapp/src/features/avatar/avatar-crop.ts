export type AvatarCrop = { x: number; y: number; width: number; height: number }
export type CroppedAreaPercentages = { x: number; y: number; width: number; height: number }

export const fullAvatarCrop: AvatarCrop = { x: 0, y: 0, width: 1, height: 1 }

export function percentagesToAvatarCrop(area: CroppedAreaPercentages): AvatarCrop {
  const crop = { x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100 }
  // Percentage decimals can sum to just over one after IEEE-754 division.
  // Correct only that machine-epsilon edge; keep real input errors visible to schema validation.
  const epsilon = Number.EPSILON * 4
  if (crop.x + crop.width > 1 && crop.x + crop.width - 1 <= epsilon) crop.width = 1 - crop.x
  if (crop.y + crop.height > 1 && crop.y + crop.height - 1 <= epsilon) crop.height = 1 - crop.y
  return crop
}

export function avatarCropToPercentages(crop: AvatarCrop): CroppedAreaPercentages {
  const percent = (value: number) => Math.round(value * 100_000_000) / 1_000_000
  return { x: percent(crop.x), y: percent(crop.y), width: percent(crop.width), height: percent(crop.height) }
}

export function avatarCropStyle(crop?: AvatarCrop | null): import('react').CSSProperties | undefined {
  if (!crop || (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1)) return undefined
  return {
    position: 'absolute',
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${-crop.x * 100 / crop.width}%`,
    top: `${-crop.y * 100 / crop.height}%`,
    maxWidth: 'none',
    objectFit: 'fill',
  }
}
