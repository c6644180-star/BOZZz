import type { ReactNode } from 'react'

export function ModulePage({ title, subtitle, tone, children }: {
  title: string
  subtitle: string
  tone: 'live' | 'local' | 'preview'
  children: ReactNode
}) {
  const toneCopy = {
    live: 'Working module',
    local: 'Saved on this device',
    preview: 'Visual preview — not connected',
  } as const
  return (
    <section className="module-page">
      <div className="module-head">
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <span className={`tone-chip tone-${tone}`}>{toneCopy[tone]}</span>
      </div>
      {children}
    </section>
  )
}
