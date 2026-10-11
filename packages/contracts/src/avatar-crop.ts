import { z } from 'zod'

export const avatarCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
}).strict().refine((crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1,
  'Avatar crop must stay within the image bounds')

export type AvatarCrop = z.infer<typeof avatarCropSchema>
