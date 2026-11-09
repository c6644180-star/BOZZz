import { Keyboard, MonitorCog, OctagonAlert, Pause, ShieldCheck } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { navItems } from '../../config/nav'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { useHgi } from '../hgi/hgiContext'

const SECTIONS = ['Operate', 'Intelligence', 'System'] as const

export function MenuPanel({ onClose }: { onClose: () => void }) {
  const { pauseInteraction } = useBozzVoice()
  const { desktopState } = useHgi()

  function emergencyStop() {
    pauseInteraction('Emergency stop activated. Voice, camera, gestures, and desktop control have been stopped.')
    window.dispatchEvent(new Event('bozz-emergency-stop'))
    onClose()
  }

  return (
    <div className="page-menu">
      <p className="panel-note">Every screen is still here. The command center now shows only the orb and the command bar.</p>
      {SECTIONS.map((section) => (
        <section key={section} className="menu-section" aria-label={section}>
          <h3>{section}</h3>
          <ul>
            {navItems
              .filter((item) => item.section === section)
              .map(({ label, path, icon: Icon, available = true }) => (
                <li key={`${section}-${label}`}>
                  {available ? (
                    <NavLink
                      to={path}
                      end={path === '/'}
                      onClick={onClose}
                      className={({ isActive }) => (isActive ? 'menu-link is-active' : 'menu-link')}
                    >
                      <Icon />
                      <span>{label}</span>
                    </NavLink>
                  ) : (
                    <span className="menu-link is-planned" aria-disabled="true">
                      <Icon />
                      <span>{label}</span>
                      <small>Planned</small>
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}

      <div className="menu-footer">
        <span className="menu-lock">
          <ShieldCheck />
          Desktop control: {desktopState}
        </span>
        <div className="menu-footer__actions">
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              onClose()
              window.dispatchEvent(new Event('bozz:open-desktop'))
            }}
          >
            <MonitorCog />
            Desktop Control
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              window.dispatchEvent(new Event('bozz:show-shortcuts'))
              onClose()
            }}
          >
            <Keyboard />
            Shortcuts
          </button>
          <button type="button" className="secondary-action" onClick={() => pauseInteraction('BOZZ interaction paused.')}>
            <Pause />
            Pause
          </button>
          <button type="button" className="secondary-action is-danger" onClick={emergencyStop}>
            <OctagonAlert />
            Emergency stop
          </button>
        </div>
        <p>Pause stops voice input, speech output, and in-flight chat replies. Emergency stop also releases the camera and stops the desktop mouse. Neither confirms an action on your behalf.</p>
      </div>
    </div>
  )
}
