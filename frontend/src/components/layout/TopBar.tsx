import { History, Menu, MessagesSquare, Minimize2, Settings } from 'lucide-react'
import type { ConnStatus, OrbState } from '../../types/bozz'

const STATUS_LABEL: Record<ConnStatus, string> = {
  online: 'Backend online',
  checking: 'Checking backend',
  offline: 'Backend offline',
}

export function TopBar({
  status,
  orbState,
  voiceOutput,
  voiceInput,
  historyOpen,
  menuOpen,
  settingsOpen,
  chatOpen,
  chatUnread,
  miniAvailable,
  onHistory,
  onMenu,
  onSettings,
  onChat,
  onMini,
  onMinimize,
}: {
  status: ConnStatus
  orbState: OrbState
  voiceOutput: string
  voiceInput: string
  historyOpen: boolean
  menuOpen: boolean
  settingsOpen: boolean
  chatOpen: boolean
  chatUnread: boolean
  miniAvailable: boolean
  onHistory: () => void
  onMenu: () => void
  onSettings: () => void
  onChat: () => void
  onMini: () => void
  onMinimize: () => void
}) {
  const summary = `Backend: ${STATUS_LABEL[status]}. Voice output: ${voiceOutput}. Voice input: ${voiceInput}. Orb: ${orbState}.`

  return (
    <div className="app-topbar">
      <div className="app-topbar__side">
        <button
          type="button"
          className={`topbar-history ${historyOpen ? 'is-open' : ''}`}
          onClick={onHistory}
          data-panel-keep-open
          aria-expanded={historyOpen}
          aria-controls="history-panel"
          title="History (H)"
        >
          <History />
          <span>History</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onMenu}
          data-panel-keep-open
          aria-expanded={menuOpen}
          aria-controls="menu-panel"
          aria-label="Open menu"
          title="Menu"
        >
          <Menu />
        </button>
      </div>

      <div className="app-brand">
        <span className="app-brand__name">BOZZ</span>
        <span className="app-brand__tagline">Dream. Plan. Create. Connect.</span>
      </div>

      <div className="app-topbar__side">
        <button
          type="button"
          className={`icon-button topbar-chat${chatOpen ? ' is-open' : ''}`}
          onClick={onChat}
          data-panel-keep-open
          aria-expanded={chatOpen}
          aria-controls="chat-panel"
          aria-label={chatUnread ? 'Open chat, new message' : 'Open chat (C)'}
          title={chatUnread ? 'Chat · new message (C)' : 'Chat (C)'}
        >
          <MessagesSquare />
          {chatUnread && <span className="topbar-chat__dot" aria-hidden="true" />}
        </button>
        {miniAvailable && (
          <button
            type="button"
            className="icon-button"
            onClick={onMini}
            aria-label="Switch to mini orb mode"
            title="Mini orb (Ctrl+Alt+M)"
          >
            <Minimize2 />
          </button>
        )}
        {miniAvailable && (
          <button
            type="button"
            className="icon-button"
            onClick={onMinimize}
            aria-label="Minimize BOZZ window"
            title="Minimize window"
          >
            <Minimize2 />
          </button>
        )}
        <span className="status-indicator" tabIndex={0} aria-label={summary}>
          <span className="status-dot" data-status={status} />
          <span className="status-tip" role="tooltip">
            <span><b>Backend</b>{STATUS_LABEL[status]}</span>
            <span><b>Voice</b>{voiceOutput}</span>
            <span><b>Input</b>{voiceInput}</span>
            <span><b>Orb</b>{orbState}</span>
          </span>
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onSettings}
          data-panel-keep-open
          aria-expanded={settingsOpen}
          aria-controls="settings-panel"
          aria-label="Open settings"
          title="Settings"
        >
          <Settings />
        </button>
      </div>
    </div>
  )
}
