import {
  Bell,
  BrainCircuit,
  Eye,
  Folder,
  MessageSquare,
  Route,
  Settings,
  Smartphone,
  Telescope,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

const ITEMS = [
  { label: 'Chat', path: '/chat', icon: MessageSquare },
  { label: 'Projects', path: '/projects', icon: Folder },
  { label: 'Research', path: '/research', icon: Telescope },
  { label: 'Vision', path: '/vision', icon: Eye },
  { label: 'Devices', path: '/devices', icon: Smartphone },
  { label: 'Memory', path: '/memory', icon: BrainCircuit },
  { label: 'Intent Map', path: '/intent-map', icon: Route },
  { label: 'Notifications', path: '/notifications', icon: Bell },
  { label: 'Settings', path: '/settings', icon: Settings },
]

export function HudNav() {
  return (
    <nav className="hud-nav" aria-label="Quick destinations">
      {ITEMS.map(({ label, path, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) => (isActive ? 'hud-nav__item is-active' : 'hud-nav__item')}
          aria-label={label}
          title={label}
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
