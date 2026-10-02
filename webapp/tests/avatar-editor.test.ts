import { expect, test } from 'bun:test'
import { avatarCropStyle, avatarCropToPercentages, percentagesToAvatarCrop } from '../src/features/avatar/avatar-crop'
import { avatarCropSchema } from '../../packages/contracts/src/avatar-crop'

test('react-easy-crop percentage area converts to normalized canonical crop without pixel coordinates', () => {
  const percent = { x: 28, y: 12.5, width: 45, height: 80 }
  expect(percentagesToAvatarCrop(percent)).toEqual({ x: 0.28, y: 0.125, width: 0.45, height: 0.8 })
  expect(avatarCropToPercentages(percentagesToAvatarCrop(percent))).toEqual(percent)
})

test('normalized crop renderer uses the same image rectangle in every surface', () => {
  expect(avatarCropStyle({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 })).toMatchObject({
    width: '200%', height: '125%', left: '-50%', top: '-12.5%', objectFit: 'fill',
  })
  expect(avatarCropStyle({ x: 0, y: 0, width: 1, height: 1 })).toBeUndefined()
})

test('floating-point edge at 100 percent remains valid without pixel rounding', () => {
  const crop = percentagesToAvatarCrop({ x: 0.00023333333333333333, y: 0, width: 99.99976666666667, height: 100 })
  expect(crop.width).toBe(1 - crop.x)
  expect(crop.x + crop.width).toBe(1)
  expect(avatarCropSchema.parse(crop)).toEqual(crop)
  expect(crop.x).toBe(0.000002333333333333333)
})
