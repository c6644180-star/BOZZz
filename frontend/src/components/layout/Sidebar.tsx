import { NavLink } from 'react-router-dom'
import { X } from 'lucide-react'
import { EagleMark } from '../orb/eagle'
import { navItems } from '../../config/nav'
import type { ConnStatus } from '../../types/bozz'

const statusCopy: Record<ConnStatus, { title: string; detail: string; tone: string }> = {
  checking: { title: 'Checking link', detail: 'Probing local backend', tone: 'pending' },
  online: { title: 'Local API online', detail: 'Backend /health reachable', tone: 'ok' },
  offline: { title: 'Local interface', detail: 'No backend connection', tone: 'off' },
}

export function Sidebar({ mobileOpen, onClose, status }: { mobileOpen: boolean; onClose: () => void; status: ConnStatus }) {
  const s = statusCopy[status]
  const sections = ['Operate', 'Intelligence', 'System'] as const
  return (
    <aside className={`left-rail ${mobileOpen ? 'open' : ''}`}>
      <button className="rail-close" onClick={onClose} aria-label="Close navigation"><X /></button>
      <div className="rail-brand"><EagleMark /><strong>BOZZ</strong><span>Your Personal AI Companion</span></div>
      <nav aria-label="Main navigation">
        {sections.map((section) => (
          <div className="nav-section" key={section}>
            <span className="nav-section-title">{section}</span>
            {navItems.filter((item) => item.section === section).map(({ label, path, icon: Icon, available = true }) => (
              available ? (
                <NavLink key={label} to={path} end={path === '/'} className={({ isActive }) => (isActive ? 'selected' : '')} onClick={onClose}>
                  <Icon /><span>{label}</span>
                </NavLink>
              ) : (
                <span className="nav-planned" key={label} title={`${label} is planned after the Command Center`}>
                  <Icon /><span>{label}</span><small>PLANNED</small>
                </span>
              )
            ))}
          </div>
        ))}
      </nav>
      <div className={`rail-status tone-${s.tone}`}><i /><div><strong>{s.title}</strong><span>{s.detail}</span></div></div>
    </aside>
  )
}
