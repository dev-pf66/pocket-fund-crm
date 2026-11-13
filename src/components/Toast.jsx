import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react'

const ToastContext = createContext()

export function useToast() {
  return useContext(ToastContext)
}

let _toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((message, type = 'error') => {
    const id = ++_toastId
    setToasts(prev => [...prev, { id, message, type }])
    const duration = type === 'success' ? 3000 : 5000
    setTimeout(() => removeToast(id), duration)
  }, [removeToast])

  const toast = useMemo(() => ({
    error: (msg) => addToast(msg, 'error'),
    success: (msg) => addToast(msg, 'success'),
    info: (msg) => addToast(msg, 'info'),
    warn: (msg) => addToast(msg, 'warn'),
  }), [addToast])

  // `notify(message, type)` is the call-shaped form, for code that passes one
  // function down as a prop. `toast` is an OBJECT — `toast(msg)` throws
  // "toast is not a function". ColdCalls did exactly that at 13 call sites,
  // and the throw after a successful logCall skipped advance(): the dial was
  // saved but the screen stayed on the same lead (test/toast-shape.test.js).
  const notify = useCallback((message, type = 'info') => {
    addToast(message, ['error', 'success', 'info', 'warn'].includes(type) ? type : 'info')
  }, [addToast])

  const value = useMemo(() => ({ toast, notify }), [toast, notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <Toast key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ toast, onDismiss }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  return (
    <div
      className={`toast toast-${toast.type} ${visible ? 'toast-visible' : ''}`}
      onClick={onDismiss}
    >
      <span className="toast-icon">
        {toast.type === 'success' && '✓'}
        {toast.type === 'error' && '✕'}
        {toast.type === 'warn' && '!'}
        {toast.type === 'info' && 'i'}
      </span>
      <span className="toast-message">{toast.message}</span>
    </div>
  )
}
