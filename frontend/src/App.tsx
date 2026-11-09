import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { TopBar } from './components/layout/TopBar'
import { SlideOver } from './components/layout/SlideOver'
import { MenuPanel } from './components/layout/MenuPanel'
import { SettingsPanel } from './components/layout/SettingsPanel'
import { HistoryPanel } from './components/history/HistoryPanel'
import { ChatPanel } from './components/chat/ChatPanel'
import { DesktopControlSlideOver } from './components/hgi/DesktopControlSlideOver'
import { BozzVoiceProvider } from './components/BozzVoiceProvider'
import { HgiProvider } from './components/hgi/HgiProvider'
import { HgiRuntime } from './components/hgi/HgiRuntime'
import { HudFrame } from './components/hud/HudFrame'
import { ShortcutsOverlay } from './components/hud/ShortcutsOverlay'
import { ToastHost } from './components/hud/ToastHost'
import { VoiceClarificationBar } from './components/hud/VoiceClarificationBar'
import { MiniOrbBridge } from './components/mini/MiniOrbBridge'
import { useBackendStatus } from './hooks/useBackendStatus'
import { useBozzVoice } from './hooks/useBozzVoice'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { isDesktopApp } from './services/desktopBridge'
import { pushToast } from './services/toast'
import { togglePanel, type ShellPanel } from './home/panels'
import type { ConnStatus } from './types/bozz'
import MiniOrbPage from './pages/MiniOrbPage'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import ProjectsPage from './pages/ProjectsPage'
import ResearchPage from './pages/ResearchPage'
import VisionPage from './pages/VisionPage'
import DevicesPage from './pages/DevicesPage'
import MemoryPage from './pages/MemoryPage'
import IntentMapPage from './pages/IntentMapPage'
import NotificationsPage from './pages/NotificationsPage'
import SettingsPage from './pages/SettingsPage'
import SystemPage from './pages/SystemPage'
import GesturePage from './pages/GesturePage'
import ModulesPage from './pages/ModulesPage'
import CallsPage from './pages/CallsPage'
import DevicesHubPage from './pages/DevicesHubPage'
import './App.css'
import './styles/modules.css'
import './styles/hud.css'
import './styles/hgi.css'
import './styles/bci.css'
import './styles/mini.css'
import './styles/holo.css'

const ModelViewerPage = lazy(() => import('./pages/ModelViewerPage'))
const SpatialPage = lazy(() => import('./pages/SpatialPage'))
const MessagesPage = lazy(() => import('./pages/MessagesPage'))

type Panel = ShellPanel

function NavigationBridge() {
  const navigate = useNavigate()
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const path = (event as CustomEvent<unknown>).detail
      if (typeof path === 'string' && path.startsWith('/')) navigate(path)
    }
    window.addEventListener('bozz:navigate', onNavigate)
    return () => window.removeEventListener('bozz:navigate', onNavigate)
  }, [navigate])
  return null
}

function RouteView({ status }: { status: ConnStatus }) {
  const location = useLocation()
  return (
    <div className="route-view" key={location.pathname}>
      <Suspense fallback={<p className="route-loading" role="status">Loading module…</p>}>
        <Routes>
          <Route path="/" element={<HomePage status={status} />} />
          <Route path="/chat" element={<ChatPage status={status} />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/vision" element={<VisionPage />} />
          <Route path="/gesture" element={<GesturePage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/intent-map" element={<IntentMapPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/spatial" element={<SpatialPage />} />
          <Route path="/3d" element={<ModelViewerPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/calls" element={<CallsPage />} />
          <Route path="/devices-hub" element={<DevicesHubPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system" element={<SystemPage status={status} />} />
          <Route path="*" element={<HomePage status={status} />} />
        </Routes>
      </Suspense>
    </div>
  )
}

function Shell() {
  const [panel, setPanel] = useState<Panel>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const status = useBackendStatus()
  const { settings, orbState, tts, ttsServer, mic, messages } = useBozzVoice()
  const miniAvailable = isDesktopApp()
  const [chatReadCount, setChatReadCount] = useState(() => messages.length)
  const closePanel = useCallback(() => {
    if (panel === 'chat') setChatReadCount(messages.length)
    setPanel(null)
  }, [messages.length, panel])
  const replacePanel = useCallback(
    (target: Exclude<Panel, null>) => {
      if (panel === 'chat' || target === 'chat') setChatReadCount(messages.length)
      setPanel(target)
    },
    [messages.length, panel],
  )
  const togglePanelTo = useCallback(
    (target: Exclude<Panel, null>) => {
      if (panel === 'chat' || target === 'chat') setChatReadCount(messages.length)
      setPanel((current) => togglePanel(current, target))
    },
    [messages.length, panel],
  )
  const toggleShortcuts = useCallback(() => setShortcutsOpen((open) => !open), [])
  const previousStatus = useRef<ConnStatus>('checking')
  useKeyboardShortcuts(toggleShortcuts)
  const voiceOutput = ttsServer.configured
    ? `ElevenLabs · ${ttsServer.model}`
    : tts.available
      ? 'Browser voice fallback'
      : 'Unavailable'
  const voiceInput = mic.available ? (mic.listening ? 'Listening now' : 'Available') : 'Unsupported'
  // The dot is a real signal: a BOZZ message arrived after Chat was last read.
  const chatUnread =
    panel !== 'chat' && messages.slice(chatReadCount).some((message) => message.from === 'bozz')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.orbTheme
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'
    root.dataset.effects = settings.backgroundEffects ? 'on' : 'off'
    root.dataset.orbSize = settings.orbSize
  }, [settings.orbTheme, settings.reduceMotion, settings.backgroundEffects, settings.orbSize])

  // Let the home screen know when a slide-over opens so it can close the composer.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bozz:panel', { detail: panel }))
  }, [panel])

  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = status
    if (previous === status) return
    if (status === 'offline') {
      pushToast(
        'warning',
        'Local backend offline',
        'Chat, workflow runs and ElevenLabs voice need the backend at 127.0.0.1:8000.',
      )
    } else if (status === 'online' && previous === 'offline') {
      pushToast('success', 'Local backend connected', 'The backend is reachable again.')
    }
  }, [status])

  useEffect(() => {
    const openHistory = () => replacePanel('history')
    const openMenu = () => replacePanel('menu')
    const openSettings = () => replacePanel('settings')
    const openDesktop = () => replacePanel('desktop')
    const openChat = () => {
      setChatReadCount(messages.length)
      setPanel('chat')
    }
    const toggleChat = () => {
      setChatReadCount(messages.length)
      setPanel((current) => togglePanel(current, 'chat'))
    }
    const openShortcuts = () => setShortcutsOpen(true)
    window.addEventListener('bozz:open-history', openHistory)
    window.addEventListener('bozz:open-menu', openMenu)
    window.addEventListener('bozz:open-settings', openSettings)
    window.addEventListener('bozz:open-desktop', openDesktop)
    window.addEventListener('bozz:open-chat', openChat)
    window.addEventListener('bozz:toggle-chat', toggleChat)
    window.addEventListener('bozz:show-shortcuts', openShortcuts)
    window.addEventListener('bozz:close-panels', closePanel)
    return () => {
      window.removeEventListener('bozz:open-history', openHistory)
      window.removeEventListener('bozz:open-menu', openMenu)
      window.removeEventListener('bozz:open-settings', openSettings)
      window.removeEventListener('bozz:open-desktop', openDesktop)
      window.removeEventListener('bozz:open-chat', openChat)
      window.removeEventListener('bozz:toggle-chat', toggleChat)
      window.removeEventListener('bozz:show-shortcuts', openShortcuts)
      window.removeEventListener('bozz:close-panels', closePanel)
    }
  }, [closePanel, messages.length, replacePanel])

  return (
    <div className="app-shell">
      <NavigationBridge />
      <HudFrame />
      <TopBar
        status={status}
        orbState={orbState}
        voiceOutput={voiceOutput}
        voiceInput={voiceInput}
        historyOpen={panel === 'history'}
        menuOpen={panel === 'menu'}
        settingsOpen={panel === 'settings'}
        chatOpen={panel === 'chat'}
        chatUnread={chatUnread}
        miniAvailable={miniAvailable}
        onHistory={() => togglePanelTo('history')}
        onMenu={() => togglePanelTo('menu')}
        onSettings={() => togglePanelTo('settings')}
        onChat={() => togglePanelTo('chat')}
        onMini={() => window.bozzDesktop?.setMode('mini')}
        onMinimize={() => window.bozzDesktop?.setMode('mini')}
      />

      <main className="app-main">
        <RouteView status={status} />
      </main>

      <SlideOver open={panel === 'history'} side="left" id="history-panel" title="History" onClose={closePanel}>
        <HistoryPanel backend={status} onClose={closePanel} />
      </SlideOver>
      <SlideOver open={panel === 'menu'} side="right" id="menu-panel" title="Menu" onClose={closePanel}>
        <MenuPanel onClose={closePanel} />
      </SlideOver>
      <SlideOver open={panel === 'settings'} side="right" id="settings-panel" title="Settings" onClose={closePanel}>
        <SettingsPanel backend={status} onClose={closePanel} />
      </SlideOver>
      <SlideOver open={panel === 'desktop'} side="right" id="desktop-control-panel" title="Desktop Control" onClose={closePanel}>
        <DesktopControlSlideOver />
      </SlideOver>
      <SlideOver
        open={panel === 'chat'}
        side="right"
        id="chat-panel"
        title="Chat"
        variant="chat"
        compact={settings.compactChat}
        modal={false}
        onClose={closePanel}
      >
        <ChatPanel />
      </SlideOver>

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ToastHost />
      <VoiceClarificationBar />

      <HgiRuntime />
      <MiniOrbBridge />
    </div>
  )
}

function RootRoutes() {
  const location = useLocation()
  // The floating mini window is a separate surface: it must not mount a second
  // microphone, speech engine or camera. It subscribes to bridge state instead.
  if (location.pathname === '/mini') return <MiniOrbPage />
  return (
    <BozzVoiceProvider>
      <HgiProvider>
        <Shell />
      </HgiProvider>
    </BozzVoiceProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <RootRoutes />
    </BrowserRouter>
  )
}
