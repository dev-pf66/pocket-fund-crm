import { useState, useEffect } from 'react'

// Drop-in replacement for useState that mirrors the value to sessionStorage
// under `key`. Restores on mount (so in-progress form input survives page
// navigation within the same tab), writes on every change.
//
// Returns [state, setState, clear]. Call clear() after a successful submit
// to wipe the stored value AND reset the in-memory state to `initialValue`.
export function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw !== null ? JSON.parse(raw) : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state))
    } catch {
      // storage full / disabled — safe to ignore, persistence is best-effort
    }
  }, [key, state])

  function clear() {
    // Empty catch is intentional: clearing storage is best-effort, and a failure
    // here must not block resetting the in-memory state on the next line.
    // eslint-disable-next-line no-empty
    try { sessionStorage.removeItem(key) } catch {}
    setState(initialValue)
  }

  return [state, setState, clear]
}
