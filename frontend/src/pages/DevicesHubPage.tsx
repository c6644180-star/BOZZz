import { Cpu, Link2Off, MonitorSmartphone, ShieldOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ModulePage } from '../components/layout/ModulePage'

export default function DevicesHubPage() {
  return (
    <ModulePage
      title="DEI Devices Hub"
      subtitle="Device Environment Integration is not connected. This page is a status shell only; it cannot discover, pair with or control a device."
      tone="preview"
    >
      <div className="placeholder-status">
        <span className="module-status status-not-connected"><ShieldOff /> Module status: Not connected</span>
        <p>
          No device adapter is installed. Device control and network permissions are off by default. The existing
          Devices page is unchanged and is not controlled from here.
        </p>
      </div>

      <div className="preview-block">
        <MonitorSmartphone />
        <h2>What this module will do</h2>
        <p>
          DEI is intended to provide one permissioned registry for local devices: discover a device, show its real
          connection state, and expose only the controls you explicitly grant. It will not infer a device is online
          when it is not.
        </p>
        <ul className="dei-plan-list">
          <li><Cpu /> Explicit device registry with model and firmware details supplied by the device</li>
          <li><Link2Off /> Opt-in pairing and connection state, with a visible disconnected state</li>
          <li><ShieldOff /> Per-device permission grants and an audit entry for every control action</li>
        </ul>
        <p className="workflow-note">
          No device is currently connected. There are no fake devices or status values on this page.
        </p>
        <div className="preview-actions">
          <Link className="hgi-btn hgi-btn--accent" to="/modules">Open Module Registry</Link>
        </div>
      </div>
    </ModulePage>
  )
}
