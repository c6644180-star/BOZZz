import { ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function ModuleCard({ label, copy, icon: Icon, path }: { label: string; copy: string; icon: LucideIcon; path: string }) {
  const navigate = useNavigate()
  return (
    <button onClick={() => navigate(path)}>
      <span className="card-icon"><Icon /></span>
      <span><strong>{label}</strong><small>{copy}</small></span>
      <ArrowRight />
    </button>
  )
}
