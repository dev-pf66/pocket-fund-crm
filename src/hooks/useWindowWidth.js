import { useState, useEffect } from 'react'

// Tracks window.innerWidth, throttled via rAF so rapid resize events don't
// cause render thrash. Use for layout branches that can't be expressed in
// pure CSS (e.g. swapping a table for stacked cards on narrow screens).
export function useWindowWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    let pending = false
    function onResize() {
      if (pending) return
      pending = true
      window.requestAnimationFrame(() => {
        setWidth(window.innerWidth)
        pending = false
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return width
}
