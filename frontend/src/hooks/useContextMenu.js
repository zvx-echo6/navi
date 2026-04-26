import { useRef, useCallback } from 'react'

/**
 * useContextMenu - Combined right-click and long-press trigger
 *
 * Returns event handlers to attach to a container element.
 * Fires onTrigger with { x, y, originalEvent } when:
 * - Right-click (desktop) - immediate
 * - Long-press 450ms with <8px movement (touch) - after delay
 *
 * @param {function} onTrigger - Callback receiving { x, y, originalEvent }
 * @param {object} options
 * @param {number} options.delay - Long-press delay in ms (default 450)
 * @param {number} options.moveThreshold - Max movement in px before abort (default 8)
 */
export default function useContextMenu(onTrigger, options = {}) {
  const { delay = 450, moveThreshold = 8 } = options

  const timerRef = useRef(null)
  const startPosRef = useRef({ x: 0, y: 0 })
  const triggeredRef = useRef(false)

  // Clear any pending timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Right-click handler (desktop)
  const onContextMenu = useCallback((e) => {
    e.preventDefault()
    onTrigger?.({
      x: e.clientX,
      y: e.clientY,
      originalEvent: e,
    })
  }, [onTrigger])

  // Touch start - begin long-press timer
  const onTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return

    const touch = e.touches[0]
    startPosRef.current = { x: touch.clientX, y: touch.clientY }
    triggeredRef.current = false

    clearTimer()
    timerRef.current = setTimeout(() => {
      if (!triggeredRef.current) {
        triggeredRef.current = true
        onTrigger?.({
          x: startPosRef.current.x,
          y: startPosRef.current.y,
          originalEvent: e,
        })
      }
    }, delay)
  }, [onTrigger, delay, clearTimer])

  // Touch move - abort if moved too far
  const onTouchMove = useCallback((e) => {
    if (!timerRef.current || triggeredRef.current) return

    const touch = e.touches[0]
    const dx = touch.clientX - startPosRef.current.x
    const dy = touch.clientY - startPosRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > moveThreshold) {
      clearTimer()
    }
  }, [moveThreshold, clearTimer])

  // Touch end - clear timer
  const onTouchEnd = useCallback(() => {
    clearTimer()
  }, [clearTimer])

  // Touch cancel - clear timer
  const onTouchCancel = useCallback(() => {
    clearTimer()
  }, [clearTimer])

  return {
    onContextMenu,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  }
}
