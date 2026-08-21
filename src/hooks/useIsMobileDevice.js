import { useState } from 'react'

// True when the client is a real mobile device (phone), not merely a
// narrow desktop window. UA-based + touch heuristic so a resized Chrome
// window never triggers the mobile layout.
export function useIsMobileDevice() {
  // detect() runs in the lazy initializer, so the very first render already has
  // the right answer. There is no SSR here (Vite SPA), so the old mount-effect
  // that re-ran detect() only ever produced a redundant second render.
  const [isMobile] = useState(() => detect())

  return isMobile
}

function detect() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const uaMobile = /Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
  return uaMobile && coarse
}
