import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  EyeOff,
  Loader2,
  RotateCcw,
  ScanSearch,
  Send,
  Sparkles,
  Upload,
} from 'lucide-react'
import { requestChat } from '../../services/backend'
import { loadAdaptiveSettings } from '../../adaptive/settings'
import { diagnostics } from '../../adaptive/diagnostics'
import { downloadJson, saveModelSummary } from '../../adaptive/report'
import { loadCachedAnalysis, runModelAnalysis, clearAnalysisCache } from '../../l3dme/analysis/analyzeModel'
import { labelStateFor, type ModelAnalysis, type ModelPartAnalysis } from '../../l3dme/analysis/intelligence'
import {
  confirmLabel,
  exportSidecar,
  importSidecar,
  loadSidecar,
  resetSidecar,
  setHidden,
  setNote,
  type ModelSidecar,
} from '../../l3dme/analysis/sidecar'
import type { ModelScenePayload, ModelViewerApi } from '../../l3dme/ModelViewer'
import type { RefObject } from 'react'

export interface ModelIntelligencePanelProps {
  payload: ModelScenePayload | null
  selectedName: string | null
  viewerRef: RefObject<ModelViewerApi | null>
  onSelect: (name: string) => void
  onStatus: (message: string) => void
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function compactNumber(value: number): string {
  return value.toLocaleString()
}

const QUALITY_LABEL = {
  meaningful: 'Meaningful',
  weak: 'Weak',
  generic: 'Generic',
} as const

export function ModelIntelligencePanel(props: ModelIntelligencePanelProps) {
  const { payload, selectedName, viewerRef, onSelect, onStatus } = props
  const [analysis, setAnalysis] = useState<ModelAnalysis | null>(null)
  const [progress, setProgress] = useState<{ value: number; detail: string } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [cached, setCached] = useState(false)
  const [sidecar, setSidecarState] = useState<ModelSidecar | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aiConfirm, setAiConfirm] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)
  const [showAllParts, setShowAllParts] = useState(false)
  const importRef = useRef<HTMLInputElement | null>(null)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  const selectedPart: ModelPartAnalysis | null = analysis && selectedName
    ? analysis.parts.find((part) => part.name === selectedName) ?? null
    : null
  const selectedConfirmation = selectedPart && sidecar ? sidecar.confirmedLabels[selectedPart.nodePath] : undefined

  const applyHidden = useCallback((nextSidecar: ModelSidecar) => {
    const api = viewerRef.current
    if (!api) return
    if (nextSidecar.hidden.length === 0) return
    for (const path of nextSidecar.hidden) {
      const name = path.split('/').pop()?.split('#')[0]
      if (name) api.setPartVisible(name, false)
    }
  }, [viewerRef])

  const publishSummary = useCallback((result: ModelAnalysis, nextSidecar: ModelSidecar) => {
    const confirmedLabels = Object.keys(nextSidecar.confirmedLabels).length
    saveModelSummary({
      createdAt: result.createdAt,
      parts: result.totals.parts,
      triangles: result.totals.triangles,
      genericParts: result.genericParts,
      confirmedLabels,
      analysisMs: result.analysisMs,
      warnings: result.warnings.length,
    })
  }, [])

  const startAnalysis = useCallback(async (input: ModelScenePayload) => {
    setAnalyzing(true)
    setError(null)
    setProgress({ value: 0.02, detail: 'Starting local analysis…' })
    try {
      const result = await runModelAnalysis(
        {
          hash: input.hash,
          fileName: input.fileName,
          parts: input.parts,
          bounds: input.bounds,
          center: input.center,
          warnings: input.warning ? [input.warning] : [],
        },
        (update) => setProgress({ value: update.progress, detail: update.detail }),
      )
      setAnalysis(result)
      setCached(false)
      setProgress(null)
      diagnostics.recordModelAnalysis({
        ms: result.analysisMs,
        parts: result.totals.parts,
        triangles: result.totals.triangles,
        warnings: result.warnings.length,
      })
      const nextSidecar = loadSidecar(result.hash, result.fileName)
      setSidecarState(nextSidecar)
      applyHidden(nextSidecar)
      publishSummary(result, nextSidecar)
      onStatusRef.current(
        `Model analysed: ${result.totals.parts} parts, ${compactNumber(result.totals.triangles)} triangles in ${result.analysisMs} ms.`,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The model analysis failed.')
      setProgress(null)
    } finally {
      setAnalyzing(false)
    }
  }, [applyHidden, publishSummary])

  useEffect(() => {
    const input = payload
    setAnalysis(null)
    setProgress(null)
    setError(null)
    setAiAnswer(null)
    setAiConfirm(false)
    setLabelDraft('')
    setNoteDraft('')
    if (!input) return
    setSidecarState(loadSidecar(input.hash, input.fileName))
    const hit = loadCachedAnalysis(input.hash)
    if (hit) {
      setAnalysis(hit)
      setCached(true)
      const nextSidecar = loadSidecar(hit.hash, hit.fileName)
      setSidecarState(nextSidecar)
      applyHidden(nextSidecar)
      publishSummary(hit, nextSidecar)
      onStatusRef.current(`Showing cached analysis for ${hit.fileName} (${hit.analysisMs} ms when measured).`)
      return
    }
    const settings = loadAdaptiveSettings()
    if (!settings.models.autoAnalyze) {
      setProgress({ value: 0, detail: 'Automatic analysis is off. Press “Analyse this model”.' })
      return
    }
    void startAnalysis(input)
  }, [payload, applyHidden, publishSummary, startAnalysis])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: unknown }>).detail
      const name = detail && typeof detail.name === 'string' ? detail.name.trim() : ''
      const part = analysis && selectedName ? analysis.parts.find((item) => item.name === selectedName) : null
      if (!name) return
      if (!part || !analysis) {
        onStatusRef.current('Select the part first, then say “this is …” to label it.')
        return
      }
      const next = confirmLabel(analysis.hash, analysis.fileName, part.nodePath, name)
      setSidecarState(next)
      publishSummary(analysis, next)
      setLabelDraft('')
      onStatusRef.current(`Label for “${part.name}” saved as “${name}”. This label lives in a sidecar file keyed by the model hash.`)
    }
    window.addEventListener('bozz:label-part', handler)
    return () => window.removeEventListener('bozz:label-part', handler)
  }, [analysis, selectedName, publishSummary])

  const confirmSelection = useCallback(() => {
    if (!analysis || !selectedPart) return
    const next = confirmLabel(analysis.hash, analysis.fileName, selectedPart.nodePath, labelDraft)
    setSidecarState(next)
    publishSummary(analysis, next)
    setLabelDraft('')
    onStatusRef.current(`Confirmed “${labelDraft.trim()}” for ${selectedPart.name}.`)
  }, [analysis, selectedPart, labelDraft, publishSummary])

  const clearLabel = useCallback(() => {
    if (!analysis || !selectedPart) return
    const next = confirmLabel(analysis.hash, analysis.fileName, selectedPart.nodePath, '')
    setSidecarState(next)
    publishSummary(analysis, next)
    onStatusRef.current(`Label for ${selectedPart.name} removed; the suggestion state is shown again.`)
  }, [analysis, selectedPart, publishSummary])

  const saveNoteForSelection = useCallback(() => {
    if (!analysis || !selectedPart) return
    const next = setNote(analysis.hash, analysis.fileName, selectedPart.nodePath, noteDraft)
    setSidecarState(next)
    onStatusRef.current(noteDraft.trim() ? `Note saved for ${selectedPart.name}.` : `Note cleared for ${selectedPart.name}.`)
  }, [analysis, selectedPart, noteDraft])

  const toggleHidden = useCallback((part: ModelPartAnalysis) => {
    if (!analysis) return
    const hiddenNow = sidecar ? sidecar.hidden.includes(part.nodePath) : false
    const next = setHidden(analysis.hash, analysis.fileName, part.nodePath, !hiddenNow)
    setSidecarState(next)
    viewerRef.current?.setPartVisible(part.name, hiddenNow)
    onStatusRef.current(`${hiddenNow ? 'Showed' : 'Hid'} ${part.name} in this view. The file was not changed.`)
  }, [analysis, sidecar, viewerRef])

  const revealAll = useCallback(() => {
    if (!analysis) return
    let next = sidecar ?? loadSidecar(analysis.hash, analysis.fileName)
    for (const path of [...next.hidden]) next = setHidden(analysis.hash, analysis.fileName, path, false)
    for (const part of analysis.parts) viewerRef.current?.setPartVisible(part.name, true)
    setSidecarState(next)
    onStatusRef.current('Every part is visible again. Hidden-state records were cleared.')
  }, [analysis, sidecar, viewerRef])

  const doExport = useCallback(() => {
    if (!analysis || !sidecar) return
    downloadJson(`bozz-model-sidecar-${analysis.hash.slice(0, 12)}.json`, exportSidecar(sidecar))
  }, [analysis, sidecar])

  const doImport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !analysis) return
    try {
      const text = await file.text()
      const next = importSidecar(text, analysis.hash, analysis.fileName)
      setSidecarState(next)
      applyHidden(next)
      publishSummary(analysis, next)
      onStatusRef.current(
        next.hash === analysis.hash
          ? 'Sidecar imported. Confirmed labels and notes were restored for this exact model hash.'
          : 'That sidecar belongs to a different model hash, so nothing was changed.',
      )
    } catch {
      setError('That file is not a valid BOZZ model sidecar JSON document.')
    }
  }, [analysis, applyHidden, publishSummary])

  const doReset = useCallback(() => {
    if (!analysis) return
    resetSidecar(analysis.hash)
    const fresh = loadSidecar(analysis.hash, analysis.fileName)
    setSidecarState(fresh)
    for (const part of analysis.parts) viewerRef.current?.setPartVisible(part.name, true)
    publishSummary(analysis, fresh)
    onStatusRef.current('Sidecar reset for this model. The model file itself was never touched.')
  }, [analysis, publishSummary, viewerRef])

  const askPayload = useCallback(() => {
    if (!analysis) return ''
    return JSON.stringify({
      file: analysis.fileName,
      totals: analysis.totals,
      parts: analysis.parts.slice(0, 60).map((part) => ({
        path: part.nodePath,
        name: part.name,
        quality: part.nameQuality,
        suggestion: part.suggestion?.label ?? null,
        confidence: part.suggestion?.confidence ?? null,
        size: part.size.map((value) => Math.round(value * 100) / 100),
        triangles: part.triangles,
        mirror: part.mirrorPartner?.nodePath ?? null,
        nearIdentical: part.nearIdentical.count,
      })),
    })
  }, [analysis])

  const sendToAI = useCallback(async () => {
    const payloadText = askPayload()
    if (!payloadText) return
    setAiBusy(true)
    setAiAnswer(null)
    setAiConfirm(false)
    try {
      const reply = await requestChat(
        `Here is a compact summary of a local 3D model. It contains only parsed hierarchy and bounding-box data, no images. ` +
        `Suggest a short, useful label for parts with generic names. You may be wrong; say so when evidence is weak. ` +
        `Reply with plain lines "nodePath: label — reason".\n\n${payloadText}`,
        [],
      )
      setAiAnswer(reply)
    } catch (caught) {
      setAiAnswer(caught instanceof Error ? `AI request failed: ${caught.message}` : 'AI request failed.')
    } finally {
      setAiBusy(false)
    }
  }, [analysis, askPayload])

  const largeWarning = payload && payload.sizeBytes > loadAdaptiveSettings().models.largeFileBytes
  const triangleWarning = analysis && analysis.totals.triangles > loadAdaptiveSettings().models.maxTriangles

  if (!payload) {
    return (
      <section className="workflow-panel" aria-label="Model intelligence">
        <div className="workflow-panel-head"><h2><ScanSearch /> Model intelligence</h2></div>
        <p className="workflow-note">Load a model to read its real hierarchy, names, sizes and repeats. Nothing is uploaded.</p>
      </section>
    )
  }

  return (
    <section className="workflow-panel l3dme-intel" aria-label="Model intelligence">
      <div className="workflow-panel-head">
        <h2><ScanSearch /> Model intelligence</h2>
        <span className="workspace-chip">{payload.hash.slice(0, 10)}…</span>
      </div>

      {largeWarning && (
        <p className="l3dme-warning" role="status">
          <AlertTriangle />
          This file is above the {Math.round(loadAdaptiveSettings().models.largeFileBytes / (1024 * 1024))} MB threshold.
          Analysis still runs locally, but it may be slow on this computer.
        </p>
      )}

      {!analysis && !analyzing && (
        <button type="button" className="secondary-action" onClick={() => void startAnalysis(payload)}>
          <ScanSearch /> Analyse this model
        </button>
      )}
      {analyzing && (
        <p className="workflow-note" role="status">
          <Loader2 className="spin" /> {progress?.detail ?? 'Analysing…'} {progress ? `(${percent(progress.value)})` : ''}
        </p>
      )}
      {error && <p className="l3dme-error" role="alert">{error}</p>}
      {cached && <p className="workflow-note">This is the cached analysis for the same file hash. Analysis time below is the measured original.</p>}

      {analysis && (
        <>
          <dl className="l3dme-file-info">
            <div><dt>Parts analysed</dt><dd>{analysis.totals.parts}</dd></div>
            <div><dt>Vertices</dt><dd>{compactNumber(analysis.totals.vertices)}</dd></div>
            <div><dt>Triangles</dt><dd>{compactNumber(analysis.totals.triangles)}</dd></div>
            <div><dt>Analysis time</dt><dd>{analysis.analysisMs} ms</dd></div>
            <div><dt>Generic names</dt><dd>{analysis.genericParts}</dd></div>
            <div><dt>Confirmed labels</dt><dd>{sidecar ? Object.keys(sidecar.confirmedLabels).length : 0}</dd></div>
          </dl>

          {triangleWarning && (
            <p className="l3dme-warning" role="status">
              <AlertTriangle />
              This model has more than the {compactNumber(loadAdaptiveSettings().models.maxTriangles)} triangle budget.
              Orbit controls stay responsive, but analysis and display may be slow on an Intel i3 / 8 GB machine.
            </p>
          )}
          {analysis.warnings.map((warning) => (
            <p key={warning} className="l3dme-warning" role="status"><AlertTriangle /> {warning}</p>
          ))}

          <div className="l3dme-mode-row" role="group" aria-label="Label key">
            <span className="l3dme-chip is-active">Confirmed</span>
            <span className="l3dme-chip">Suggested</span>
            <span className="l3dme-chip">Unknown</span>
          </div>

          <ul className="l3dme-intel-parts">
            {(showAllParts ? analysis.parts : analysis.parts.slice(0, 60)).map((part) => {
              const state = labelStateFor(part, sidecar?.confirmedLabels[part.nodePath])
              const hidden = sidecar?.hidden.includes(part.nodePath) ?? false
              return (
                <li key={part.nodePath} className={`l3dme-intel-part is-${state.state}`}>
                  <button type="button" className={selectedName === part.name ? 'is-active' : ''} onClick={() => {
                    onSelect(part.name)
                    setLabelDraft('')
                    setNoteDraft(sidecar?.notes[part.nodePath] ?? '')
                  }}>
                    <span className="l3dme-intel-name">
                      {state.displayName}
                      {state.state === 'suggested' && <em>suggested · {percent(state.confidence ?? 0)}</em>}
                      {state.state === 'unknown' && <em>unconfirmed</em>}
                    </span>
                    <small>
                      file name: {part.name} · {QUALITY_LABEL[part.nameQuality]} · {compactNumber(part.triangles)} triangles
                      {state.state === 'confirmed' ? ' · confirmed by you' : ''}
                    </small>
                  </button>
                  <button type="button" className="icon-action" aria-label={`${hidden ? 'Show' : 'Hide'} ${part.name}`} onClick={() => toggleHidden(part)}>
                    <EyeOff />
                  </button>
                </li>
              )
            })}
          </ul>
          {analysis.parts.length > 60 && (
            <button type="button" className="ghost-action" onClick={() => setShowAllParts((value) => !value)}>
              {showAllParts ? 'Show first 60 parts' : `Show all ${analysis.parts.length} parts`}
            </button>
          )}

          {selectedPart ? (
            <div className="l3dme-intel-selected">
              <h3>{labelStateFor(selectedPart, selectedConfirmation).displayName}</h3>
              <p className="workflow-note">
                {selectedPart.suggestion
                  ? `${selectedPart.suggestion.label} · ${percent(selectedPart.suggestion.confidence)} confidence (${selectedPart.suggestion.source} hint)`
                  : 'No geometry rule matched this part.'} Suggestions are heuristics from this file’s hierarchy and bounding boxes. They are never treated as confirmed.
              </p>
              {selectedPart.suggestion && (
                <ul className="l3dme-intel-reasons">
                  {selectedPart.suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              <p className="workflow-note"><strong>Name check:</strong> {selectedPart.nameReason}</p>
              <dl className="l3dme-file-info">
                <div><dt>Node path</dt><dd>{selectedPart.nodePath}</dd></div>
                <div><dt>Parent</dt><dd>{selectedPart.parentPath ?? 'top level'}</dd></div>
                <div><dt>Children</dt><dd>{selectedPart.children.length}</dd></div>
                <div><dt>Bounds</dt><dd>{selectedPart.size.map((value) => value.toFixed(2)).join(' × ')} units</dd></div>
                <div><dt>Bounding-box volume</dt><dd>{selectedPart.bboxVolume.toFixed(3)} units³ (box estimate, not mesh volume)</dd></div>
                <div><dt>Centre</dt><dd>{selectedPart.center.map((value) => value.toFixed(2)).join(', ')}</dd></div>
                <div>
                  <dt>Nearest neighbours</dt>
                  <dd>{selectedPart.nearestNeighbours.length === 0 ? 'none' : selectedPart.nearestNeighbours.map((item) => `${item.nodePath} (${item.distance.toFixed(2)})`).join(' · ')}</dd>
                </div>
                <div>
                  <dt>Mirror partner</dt>
                  <dd>{selectedPart.mirrorPartner ? `${selectedPart.mirrorPartner.nodePath} across ${selectedPart.mirrorPartner.axis}` : 'none found within 8% tolerance'}</dd>
                </div>
                <div><dt>Near-identical parts</dt><dd>{selectedPart.nearIdentical.count}</dd></div>
              </dl>

              {selectedPart.extras && (
                <details>
                  <summary>extras / userData from the file</summary>
                  <pre>{JSON.stringify(selectedPart.extras, null, 2)}</pre>
                </details>
              )}

              <div className="l3dme-intel-label">
                <label>
                  <span>Confirm a label for this part</span>
                  <input
                    type="text"
                    value={labelDraft}
                    placeholder="e.g. front-left wheel"
                    onChange={(event) => setLabelDraft(event.target.value)}
                  />
                </label>
                <button type="button" className="secondary-action" onClick={confirmSelection} disabled={!labelDraft.trim()}>
                  <Check /> Confirm label
                </button>
                <button type="button" className="ghost-action" onClick={clearLabel} disabled={!selectedConfirmation}>
                  Remove my label
                </button>
              </div>
              <p className="workflow-note">
                You can also select this part and say or type “this is the front-left wheel”. Only you can confirm a label;
                nothing is applied automatically.
              </p>

              <label className="l3dme-intel-note">
                <span>Note for this part (saved in the sidecar)</span>
                <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={2} />
              </label>
              <button type="button" className="ghost-action" onClick={saveNoteForSelection}>Save note</button>
            </div>
          ) : (
            <p className="workflow-note">Select a part in the model or the list to see its hierarchy, neighbours and mirror partner.</p>
          )}

          <div className="inline-actions">
            <button type="button" className="ghost-action" onClick={revealAll}>Show all parts</button>
            <button type="button" className="ghost-action" onClick={doExport}>Export sidecar</button>
            <button type="button" className="ghost-action" onClick={() => importRef.current?.click()}>Import sidecar</button>
            <button type="button" className="ghost-action" onClick={doReset}><RotateCcw /> Reset sidecar</button>
            <button type="button" className="ghost-action" onClick={() => { clearAnalysisCache(); onStatusRef.current('Analysis cache cleared for this device.') }}>
              Clear analysis cache
            </button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void doImport(event)} />
          </div>
          <p className="workflow-note">
            Labels, hidden parts and notes are stored on this device in a sidecar keyed by the file hash plus node path.
            The model file is never modified.
          </p>

          <div className="l3dme-intel-ai">
            <h3><Sparkles /> Ask AI (optional)</h3>
            <p className="workflow-note">
              Sends only the compact JSON below through the configured local AI provider. No model, images or file bytes
              leave this device. AI answers are suggestions, never confirmations.
            </p>
            <details>
              <summary>Preview exactly what would be sent</summary>
              <pre>{askPayload()}</pre>
            </details>
            {!aiConfirm && !aiAnswer && (
              <button type="button" className="secondary-action" onClick={() => setAiConfirm(true)}>
                <Send /> Ask AI for label hints
              </button>
            )}
            {aiConfirm && (
              <div className="inline-actions">
                <button type="button" className="secondary-action" onClick={() => void sendToAI()} disabled={aiBusy}>
                  {aiBusy ? <Loader2 className="spin" /> : <Send />} Confirm and send compact JSON
                </button>
                <button type="button" className="ghost-action" onClick={() => setAiConfirm(false)}>Cancel</button>
              </div>
            )}
            {aiAnswer && (
              <div className="l3dme-intel-ai-answer">
                <span className="workspace-chip">AI suggestion, unverified</span>
                <pre>{aiAnswer}</pre>
              </div>
            )}
          </div>
        </>
      )}

      <p className="workflow-note">
        <Download /> Export and <Upload /> import are JSON sidecars only. Bounding boxes come from the loaded meshes;
        geometry rules are hints, not object recognition. The exploded view moves top-level nodes and restores their exact
        recorded transforms.
      </p>
    </section>
  )
}
