import { useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  Box,
  Boxes,
  Cuboid,
  FileWarning,
  Loader2,
  Maximize2,
  Minus,
  MousePointerClick,
  Plus,
  RotateCcw,
  RotateCw,
  Upload,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { ModulePage } from '../components/layout/ModulePage'
import { ModelViewer, type ModelFileInfo, type ModelScenePayload, type ModelViewerApi } from '../l3dme/ModelViewer'
import { ModelIntelligencePanel } from '../components/l3dme/ModelIntelligencePanel'
import type { ModelMode, ModelViewerState } from '../l3dme/modelControl'
import '../styles/l3dme.css'

const INITIAL_VIEWER_STATE: ModelViewerState = {
  loaded: false,
  source: 'No model',
  mode: 'solid',
  explode: 0,
  selectedPart: null,
  parts: [],
  cameraAzimuth: 0,
  cameraDistance: 0,
  revision: 0,
}

const MODES: Array<{ id: ModelMode; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'transparent', label: 'Transparent' },
]

export default function ModelViewerPage() {
  const viewer = useRef<ModelViewerApi | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<ModelViewerState>(INITIAL_VIEWER_STATE)
  const [fileInfo, setFileInfo] = useState<ModelFileInfo | null>(null)
  const [scenePayload, setScenePayload] = useState<ModelScenePayload | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    void viewer.current?.loadFiles(files)
  }

  return (
    <ModulePage
      title="L3DME 3D Model Viewer"
      subtitle="Load a local GLB or glTF file and inspect its real mesh names. Files are read by this browser tab only; nothing is uploaded, and no model description is invented."
      tone="local"
    >
      <div className="l3dme-layout">
        <section className="l3dme-stage" aria-label="3D model viewport">
          <ModelViewer
            ref={viewer}
            onStateChange={setState}
            onLoading={setLoading}
            onError={setError}
            onFileInfo={setFileInfo}
            onSceneParts={setScenePayload}
          />

          {loading && (
            <div className="l3dme-overlay" role="status">
              <Loader2 />
              Loading the model locally…
            </div>
          )}

          {error && (
            <div className="l3dme-error" role="alert">
              <AlertTriangle />
              <div>
                <strong>Model could not be shown</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          <div className="l3dme-stage-hud" aria-live="polite">
            <span className="workspace-chip"><Cuboid /> {state.source}</span>
            <span className="workspace-chip">
              {state.loaded ? `${state.parts.length} part(s) · ${state.mode}` : 'No model loaded'}
            </span>
          </div>

          <div className="l3dme-hint">
            <MousePointerClick />
            Drag to orbit · scroll or pinch to zoom · right-drag or two-finger drag to pan · click a part to select it
          </div>
        </section>

        <aside className="l3dme-controls" aria-label="Model controls">
          <section className="workflow-panel">
            <div className="workflow-panel-head">
              <h2><Upload /> Model source</h2>
              <span className="workspace-chip">Local only</span>
            </div>
            <p className="workflow-note">
              Choose one <code>.glb</code> or <code>.gltf</code> file. For a <code>.gltf</code> that uses separate
              files, select its <code>.bin</code> and textures in the same picker so the browser can resolve them.
            </p>
            <div className="inline-actions">
              <button
                type="button"
                className="primary-action"
                onClick={() => fileInput.current?.click()}
                disabled={loading}
              >
                <Upload /> Choose model files
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => viewer.current?.loadSample()}
                disabled={loading}
              >
                <Boxes /> Built-in sample
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              multiple
              hidden
              onChange={pickFiles}
            />

            {fileInfo && (
              <dl className="l3dme-file-info">
                <div><dt>File</dt><dd>{fileInfo.name}</dd></div>
                <div><dt>Size</dt><dd>{fileInfo.sizeLabel}</dd></div>
                <div><dt>Origin</dt><dd>{fileInfo.kind === 'sample' ? 'Generated in this tab' : 'Local file picker'}</dd></div>
              </dl>
            )}

            {fileInfo?.large && (
              <p className="l3dme-warning" role="status">
                <FileWarning />
                This model is over 50 MB. Loading may be slow or run out of memory on 8 GB machines. Pixel ratio is
                capped at 1.5 and rendering pauses while the tab is hidden.
              </p>
            )}
          </section>

          <section className="workflow-panel">
            <div className="workflow-panel-head">
              <h2><Box /> View</h2>
            </div>
            <div className="l3dme-mode-row" role="group" aria-label="Material mode">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={state.mode === mode.id ? 'l3dme-chip is-active' : 'l3dme-chip'}
                  aria-pressed={state.mode === mode.id}
                  onClick={() => viewer.current?.setMode(mode.id)}
                  disabled={!state.loaded}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <label className="l3dme-slider">
              <span>
                Exploded view
                <small>{Math.round(state.explode * 100)}% · top-level parts move outward from the model centre</small>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(state.explode * 100)}
                disabled={!state.loaded}
                onChange={(event) => viewer.current?.explode(Number(event.target.value) / 100)}
              />
            </label>

            <div className="l3dme-button-grid">
              <button type="button" className="secondary-action" onClick={() => viewer.current?.rotate(-15)} disabled={!state.loaded}>
                <RotateCcw /> Rotate left
              </button>
              <button type="button" className="secondary-action" onClick={() => viewer.current?.rotate(15)} disabled={!state.loaded}>
                <RotateCw /> Rotate right
              </button>
              <button type="button" className="secondary-action" onClick={() => viewer.current?.zoom(1.2)} disabled={!state.loaded}>
                <Plus /> Zoom in
              </button>
              <button type="button" className="secondary-action" onClick={() => viewer.current?.zoom(0.8)} disabled={!state.loaded}>
                <Minus /> Zoom out
              </button>
              <button type="button" className="secondary-action" onClick={() => viewer.current?.reset()} disabled={!state.loaded}>
                <Maximize2 /> Reset view
              </button>
            </div>
          </section>

          <section className="workflow-panel">
            <div className="workflow-panel-head">
              <h2><Cuboid /> Parts</h2>
              <span className="workspace-chip">{state.parts.length}</span>
            </div>
            {state.parts.length === 0 ? (
              <p className="workflow-note">No meshes are loaded.</p>
            ) : (
              <ul className="l3dme-parts">
                {state.parts.map((part, index) => (
                  <li key={`${part}-${index}`}>
                    <button
                      type="button"
                      className={state.selectedPart === part ? 'is-active' : ''}
                      onClick={() => viewer.current?.selectPart(part)}
                      title={`Select the mesh named ${part}`}
                    >
                      <span>{part}</span>
                      <small>{state.selectedPart === part ? 'selected' : 'select'}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="l3dme-selected">
              Selected part: <strong>{state.selectedPart ?? 'none'}</strong>
            </p>
            <p className="workflow-note">
              Names come from the mesh names stored in the file. BOZZ does not add part descriptions.
            </p>
          </section>

          <ModelIntelligencePanel
            payload={scenePayload}
            selectedName={state.selectedPart}
            viewerRef={viewer}
            onSelect={(name) => viewer.current?.selectPart(name)}
            onStatus={setNotice}
          />
          {notice && <p className="workflow-note" role="status">{notice}</p>}
        </aside>
      </div>

      <section className="workflow-panel l3dme-commands">
        <div className="workflow-panel-head">
          <h2><Cuboid /> Command bar</h2>
          <span className="workspace-chip">Intent Map task · verification required</span>
        </div>
        <p>
          Keep this page open and type or say one of these in the command bar: <code>rotate the model</code>,{' '}
          <code>wireframe</code>, <code>transparent</code>, <code>explode</code>, <code>zoom in</code>,{' '}
          <code>reset the model</code>, or <code>select part Cube</code>. Each command becomes a six-stage Intent Map
          task. BOZZ reports success only after the viewer state confirms the change.
        </p>
        <p className="workflow-note">
          The viewer exposes the same typed control API to future voice and HGI input. No hand-tracking code runs on
          this page. Module status: <Link to="/modules">open the Module Registry</Link>.
        </p>
      </section>
    </ModulePage>
  )
}
