import { useId } from 'react'
import { useBozzVoice } from '../../hooks/useBozzVoice'
import { desktopBridge } from '../../services/desktopBridge'
import type { MiniDock, MiniMonitor, MiniOrbSize, MiniWanderSpeed } from '../../types/bozz'

export function MiniOrbSettings() {
  const { settings, updateSettings } = useBozzVoice()
  const bridge = desktopBridge()
  const sizeId = useId()
  const speedId = useId()
  const dockId = useId()
  const monitorId = useId()
  const opacityId = useId()
  const mini = settings.miniOrb

  const patch = (next: Partial<typeof mini>) => updateSettings({ miniOrb: { ...mini, ...next } })

  if (!bridge) {
    return (
      <section className="settings-group" aria-label="Mini orb">
        <h3>Mini orb</h3>
        <p className="panel-note">Mini mode needs the desktop app.</p>
      </section>
    )
  }

  return (
    <section className="settings-group" aria-label="Mini orb">
      <h3>Mini orb</h3>
      <label className="toggle-row">
        <span>
          Wander around the screen
          <small>Slow drift inside the current display’s work area. It never covers the taskbar.</small>
        </span>
        <input
          type="checkbox"
          checked={mini.wander}
          disabled={mini.dock !== 'free'}
          onChange={(event) => patch({ wander: event.target.checked })}
        />
      </label>
      <label className="select-row" htmlFor={speedId}>
        <span>
          Wander speed
          <small>Used while wandering is on and the orb is not docked.</small>
        </span>
        <select
          id={speedId}
          value={mini.wanderSpeed}
          disabled={!mini.wander || mini.dock !== 'free'}
          onChange={(event) => patch({ wanderSpeed: event.target.value as MiniWanderSpeed })}
        >
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
        </select>
      </label>
      <label className="select-row" htmlFor={dockId}>
        <span>
          Dock to a corner
          <small>Free allows wandering and dragging. A corner keeps the orb in place.</small>
        </span>
        <select
          id={dockId}
          value={mini.dock}
          onChange={(event) => patch({ dock: event.target.value as MiniDock })}
        >
          <option value="free">Free (drag or wander)</option>
          <option value="top-left">Top left</option>
          <option value="top-right">Top right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-right">Bottom right</option>
        </select>
      </label>
      <label className="select-row" htmlFor={sizeId}>
        <span>
          Size
          <small>Small is 240 × 250 px; medium is 320 × 320 px.</small>
        </span>
        <select
          id={sizeId}
          value={mini.size}
          onChange={(event) => patch({ size: event.target.value as MiniOrbSize })}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
        </select>
      </label>
      <label className="select-row" htmlFor={monitorId}>
        <span>
          Display
          <small>Follow the cursor, or stay on the primary display.</small>
        </span>
        <select
          id={monitorId}
          value={mini.monitor}
          onChange={(event) => patch({ monitor: event.target.value as MiniMonitor })}
        >
          <option value="cursor">Follow the cursor’s display</option>
          <option value="primary">Primary display only</option>
        </select>
      </label>
      <label className="select-row" htmlFor={opacityId}>
        <span>
          Opacity
          <small>{Math.round(mini.opacity * 100)}% — applies to the whole mini window.</small>
        </span>
        <input
          id={opacityId}
          type="range"
          min={0.35}
          max={1}
          step={0.01}
          value={mini.opacity}
          onChange={(event) => patch({ opacity: Number(event.target.value) })}
        />
      </label>
      <label className="toggle-row">
        <span>
          Pause on battery power
          <small>Stops wandering and orb animation while the laptop is unplugged.</small>
        </span>
        <input
          type="checkbox"
          checked={mini.pauseOnBattery}
          onChange={(event) => patch({ pauseOnBattery: event.target.checked })}
        />
      </label>
      <p className="panel-note">
        Drag the orb to place it manually; wandering pauses for 60 seconds afterwards. Click expands, double-click
        listens, right-click opens the mini menu. Use Ctrl+Alt+M to switch modes.
      </p>
      <p>
        <button type="button" className="secondary-action" onClick={() => bridge.setMode('mini')}>
          Test mini mode
        </button>
      </p>
    </section>
  )
}
