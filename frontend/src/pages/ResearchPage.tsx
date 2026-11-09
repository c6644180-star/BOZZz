import { Search } from 'lucide-react'
import { ModulePage } from '../components/layout/ModulePage'

export default function ResearchPage() {
  return (
    <ModulePage title="Research" subtitle="Planned module: source gathering, summarisation and citations via a connected research service." tone="preview">
      <div className="preview-block">
        <Search />
        <h2>No research service connected</h2>
        <p>This screen is a visual preview of the module. Searches typed here would run against a backend research endpoint that does not exist yet, so nothing is wired up — and no results are faked.</p>
        <p className="preview-when">It will go live when the backend exposes a research API.</p>
      </div>
    </ModulePage>
  )
}
