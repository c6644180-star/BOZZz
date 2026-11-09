import { Camera, Eye, Hand } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ModulePage } from '../components/layout/ModulePage'
import { useHgi } from '../components/hgi/hgiContext'

export default function VisionPage() {
  const { enabled, starting, metrics } = useHgi()

  return (
    <ModulePage
      title="Vision"
      subtitle="Hand tracking now lives in one shared gesture engine. Scene, object and screen understanding is still not connected."
      tone="preview"
    >
      <div className="preview-block">
        <Eye />
        <h2>Vision understanding — not connected</h2>
        <p>
          There is no scene, object, OCR or screen-analysis service in this build, so this page does not pretend to
          see anything. The camera preview that used to live here has moved into the Gesture Lab, where frames are
          used only for local landmark tracking and are never recorded or uploaded.
        </p>
        <p>
          Gesture engine status:{' '}
          <strong>
            {starting ? 'starting camera…' : enabled ? `running · ${metrics.fps} fps · ${metrics.hands} hand${metrics.hands === 1 ? '' : 's'}` : 'off — camera released'}
          </strong>
        </p>
        <div className="preview-actions">
          <Link className="hgi-btn hgi-btn--accent" to="/gesture">
            <Hand /> Open Gesture Lab
          </Link>
          <span className="hgi-card__note">
            <Camera /> Camera only activates after you press Start gestures there.
          </span>
        </div>
      </div>
    </ModulePage>
  )
}
