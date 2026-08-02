import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useConnections } from '../stores/connections'

/**
 * Lắng nghe phím tắt từ application menu (main gửi `app:shortcut`).
 */
export function useAppShortcuts(opts?: {
  onAbout?: () => void
  onShortcutsHelp?: () => void
}): void {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const activeId = useConnections((s) => s.activeId)
  const onAbout = opts?.onAbout
  const onShortcutsHelp = opts?.onShortcutsHelp

  useEffect(() => {
    return window.pve.app.onShortcut((action) => {
      if (action === 'settings') {
        void navigate({ to: '/settings' })
        return
      }
      if (action.startsWith('nav:')) {
        const path = action.slice(4)
        void navigate({ to: path as '/' })
        return
      }
      if (action === 'search') {
        const el = document.querySelector<HTMLInputElement>('[data-global-search]')
        el?.focus()
        el?.select()
        return
      }
      if (action === 'refresh') {
        if (activeId) void queryClient.invalidateQueries({ queryKey: ['pve', activeId] })
        return
      }
      if (action === 'about') {
        onAbout?.()
        return
      }
      if (action === 'shortcuts') {
        onShortcutsHelp?.()
      }
    })
  }, [navigate, queryClient, activeId, onAbout, onShortcutsHelp])
}
