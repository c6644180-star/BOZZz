import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** When this value changes (for example the route), the boundary clears its error. */
  resetKey?: string
  /** 'page' keeps the app shell alive; 'app' is the last-resort screen. */
  scope?: 'page' | 'app'
}

interface State {
  error: Error | null
}

/**
 * A crash in one screen must never blank the whole app. The fallback is plain
 * (no dependencies on providers) so it still renders if a provider is what failed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local console only. Nothing is uploaded anywhere.
    console.error('BOZZ screen crashed:', error, info.componentStack)
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const isApp = this.props.scope === 'app'
    return (
      <div className="error-boundary" role="alert">
        <h2>Something went wrong on this screen</h2>
        <p>
          BOZZ is still running. {isApp ? 'Reload the app to continue.' : 'You can go back to the orb or try again.'}
        </p>
        <pre className="error-boundary__detail">{error.message || String(error)}</pre>
        <div className="error-boundary__actions">
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <button
            type="button"
            onClick={() => {
              window.location.assign('/')
            }}
          >
            Back to the orb
          </button>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
