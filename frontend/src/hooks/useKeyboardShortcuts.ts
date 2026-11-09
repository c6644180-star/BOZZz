import { useCallback, useEffect } from 'react'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useKeyboardShortcuts(onShortcuts: () => void) {
  const focusCommandBar = useCallback(() => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('[data-command-input], [data-home-composer]'),
    )
    inputs.find((input) => input.offsetParent !== null && !input.closest('[inert]'))?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const typing = isTyping(event.target)

      if (event.key === '?' && !typing) {
        event.preventDefault()
        onShortcuts()
        return
      }
      if (event.key === '/' && !typing) {
        event.preventDefault()
        window.dispatchEvent(new Event('bozz:focus-composer'))
        requestAnimationFrame(focusCommandBar)
        return
      }
      if (event.key === 'Escape') {
        window.dispatchEvent(new Event('bozz:close-panels'))
        return
      }
      if (typing) return
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault()
        window.dispatchEvent(new Event('bozz:open-history'))
        return
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        window.dispatchEvent(new Event('bozz:toggle-chat'))
        return
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        window.dispatchEvent(new Event('bozz:toggle-nav'))
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focusCommandBar, onShortcuts])
}
