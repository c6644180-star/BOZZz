import { useId } from 'react'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import type { OrbQuality, OrbSize, ThemeName } from '../../types/bozz'

export function AppearanceSettings() {
  const { settings, updateSettings } = useBozzVoice()
  const themeId = useId()
  const qualityId = useId()
  const sizeId = useId()

  return (
    <section className="settings-group" aria-label="Appearance">
      <h3>Appearance</h3>
      <label className="select-row" htmlFor={themeId}>
        <span>
          Appearance
          <small>Gold and white is the BOZZ identity. Cyan is the cool alternate palette.</small>
        </span>
        <select
          id={themeId}
          value={settings.orbTheme}
          onChange={(event) => updateSettings({ orbTheme: event.target.value as ThemeName })}
        >
          <option value="gold">Gold</option>
          <option value="cyan">Cyan</option>
        </select>
      </label>
      <label className="select-row" htmlFor={qualityId}>
        <span>
          Orb quality
          <small>Low turns bloom off and reduces geometry for slower machines.</small>
        </span>
        <select
          id={qualityId}
          value={settings.orbQuality}
          onChange={(event) => updateSettings({ orbQuality: event.target.value as OrbQuality })}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="select-row" htmlFor={sizeId}>
        <span>
          Orb size
          <small>How much of the screen the orb takes on the home screen.</small>
        </span>
        <select
          id={sizeId}
          value={settings.orbSize}
          onChange={(event) => updateSettings({ orbSize: event.target.value as OrbSize })}
        >
          <option value="medium">Medium</option>
          <option value="large">Large</option>
          <option value="xl">Extra large</option>
        </select>
      </label>
      <label className="toggle-row">
        <span>
          Orb-only mode
          <small>Hides the wide command bar and navigation; they stay one click or key away.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.orbOnly}
          onChange={(event) => updateSettings({ orbOnly: event.target.checked })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Always show chat
          <small>Classic layout: the command bar and navigation stay visible under the orb.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.alwaysShowChat}
          onChange={(event) => updateSettings({ alwaysShowChat: event.target.checked })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Compact chat
          <small>Narrower chat panel with smaller text.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.compactChat}
          onChange={(event) => updateSettings({ compactChat: event.target.checked })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Reduce motion
          <small>Stops HUD sweeps, dust drift and the orb’s ambient rotation. Real state changes still show.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.reduceMotion}
          onChange={(event) => updateSettings({ reduceMotion: event.target.checked })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Background effects
          <small>Honeycomb lattice, gold dust and the sunburst behind the orb.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.backgroundEffects}
          onChange={(event) => updateSettings({ backgroundEffects: event.target.checked })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Show data widgets
          <small>CPU, RAM and last task. CPU and RAM show “Not connected” until the backend exposes them.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.showWidgets}
          onChange={(event) => updateSettings({ showWidgets: event.target.checked })}
        />
      </label>
    </section>
  )
}
