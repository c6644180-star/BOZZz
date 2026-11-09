import { Smartphone } from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'

export default function DevicesPage() {
  return (
    <ModulePage title="Devices" subtitle="Planned module: paired laptops, phones and smart devices via a local device service." tone="preview">
      <div className="preview-block">
        <Smartphone />
        <h2>No device service connected</h2>
        <p>Device lists, battery levels and control actions would come from a paired backend. Nothing is paired yet, so this panel shows no devices rather than invented ones.</p>
        <p className="preview-when">It will go live when the backend exposes a devices API.</p>
      </div>
    </ModulePage>
  )
}
