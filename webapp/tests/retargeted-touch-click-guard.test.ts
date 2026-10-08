import { describe, expect, test } from 'bun:test'

import { installRetargetedTouchClickGuard } from '../src/features/feed/presentation/retargeted-touch-click-guard'

function pointerEvent(type: string, pointerId: number) {
  const event = new Event(type) as Event & { pointerId: number; isPrimary: boolean }
  Object.assign(event, { pointerId, isPrimary: true })
  return event
}

function clickEvent(detail: number, x = 40, y = 50) {
  const event = new Event('click', { cancelable: true }) as Event & { detail: number; clientX: number; clientY: number }
  Object.assign(event, { detail, clientX: x, clientY: y })
  return event
}

describe('retargeted touch click guard', () => {
  test('consumes only the compatibility click following its owned touch release', () => {
    const document = new EventTarget() as unknown as Document
    const view = new EventTarget() as unknown as Window
    const cleanup = installRetargetedTouchClickGuard(document, view, 7, 40, 50)

    const beforeRelease = clickEvent(1)
    document.dispatchEvent(beforeRelease)
    expect(beforeRelease.defaultPrevented).toBe(false)

    document.dispatchEvent(pointerEvent('pointerup', 8))
    const afterForeignRelease = clickEvent(1)
    document.dispatchEvent(afterForeignRelease)
    expect(afterForeignRelease.defaultPrevented).toBe(false)

    document.dispatchEvent(pointerEvent('pointerup', 7))
    const keyboardWhileArmed = clickEvent(0)
    document.dispatchEvent(keyboardWhileArmed)
    expect(keyboardWhileArmed.defaultPrevented).toBe(false)
    const elsewhereWhileArmed = clickEvent(1, 100, 100)
    document.dispatchEvent(elsewhereWhileArmed)
    expect(elsewhereWhileArmed.defaultPrevented).toBe(false)

    const retargeted = clickEvent(1)
    document.dispatchEvent(retargeted)
    expect(retargeted.defaultPrevented).toBe(true)

    // The matching click consumed the guard; these assertions are secondary
    // checks that cleanup leaves future keyboard and unrelated clicks alone.
    const keyboard = clickEvent(0)
    document.dispatchEvent(keyboard)
    expect(keyboard.defaultPrevented).toBe(false)
    const elsewhere = clickEvent(1, 100, 100)
    document.dispatchEvent(elsewhere)
    expect(elsewhere.defaultPrevented).toBe(false)
    cleanup()
  })

  test('retains ownership across the next task and expires when no compatibility click arrives', async () => {
    const document = new EventTarget() as unknown as Document
    const view = new EventTarget() as unknown as Window
    const cleanup = installRetargetedTouchClickGuard(document, view, 12, 40, 50)
    document.dispatchEvent(pointerEvent('pointerup', 12))

    await new Promise((resolve) => setTimeout(resolve, 20))
    const nextTaskClick = clickEvent(1)
    document.dispatchEvent(nextTaskClick)
    expect(nextTaskClick.defaultPrevented).toBe(true)

    const expires = installRetargetedTouchClickGuard(document, view, 13, 40, 50)
    document.dispatchEvent(pointerEvent('pointerup', 13))
    await new Promise((resolve) => setTimeout(resolve, 950))
    const afterExpiry = clickEvent(1)
    document.dispatchEvent(afterExpiry)
    expect(afterExpiry.defaultPrevented).toBe(false)

    cleanup()
    expires()
  })

  test('releases protection on a fresh pointer, cancellation, blur, or explicit cleanup', () => {
    const document = new EventTarget() as unknown as Document
    const view = new EventTarget() as unknown as Window
    const cleanup = installRetargetedTouchClickGuard(document, view, 7, 40, 50)
    document.dispatchEvent(pointerEvent('pointerdown', 8))
    document.dispatchEvent(pointerEvent('pointerup', 7))
    const freshTap = clickEvent(1)
    document.dispatchEvent(freshTap)
    expect(freshTap.defaultPrevented).toBe(false)

    const next = installRetargetedTouchClickGuard(document, view, 9, 40, 50)
    document.dispatchEvent(pointerEvent('pointercancel', 9))
    document.dispatchEvent(pointerEvent('pointerup', 9))
    const afterCancel = clickEvent(1)
    document.dispatchEvent(afterCancel)
    expect(afterCancel.defaultPrevented).toBe(false)

    const afterBlur = installRetargetedTouchClickGuard(document, view, 10, 40, 50)
    view.dispatchEvent(new Event('blur'))
    document.dispatchEvent(pointerEvent('pointerup', 10))
    const afterWindowBlur = clickEvent(1)
    document.dispatchEvent(afterWindowBlur)
    expect(afterWindowBlur.defaultPrevented).toBe(false)
    cleanup()
    next()
    afterBlur()

    const explicit = installRetargetedTouchClickGuard(document, view, 11, 40, 50)
    explicit()
    document.dispatchEvent(pointerEvent('pointerup', 11))
    const afterCleanup = clickEvent(1)
    document.dispatchEvent(afterCleanup)
    expect(afterCleanup.defaultPrevented).toBe(false)
  })
})
