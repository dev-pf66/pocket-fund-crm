import { useState, useEffect } from 'react'

// True when the client is a real mobile device (phone), not merely a
// narrow desktop window. UA-based + touch heuristic so a resized Chrome
// window never triggers the mobile layout.
export function useIsMobileDevice() {
  const [isMobile, setIsMobile] = useState(() => detect())

  useEffect(() => {
    setIsMobile(detect())
  }, [])

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
