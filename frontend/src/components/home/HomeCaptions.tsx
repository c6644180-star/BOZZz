import type { OrbState } from '../../types/bozz'

const MAX_CAPTION = 280

/**
 * Floating captions under the wave bars. The reply is only shown while BOZZ is
 * really speaking; the user's own line appears while the request is processed.
 * Long replies are clipped so they never cover the orb.
 */
export function HomeCaptions({
  state,
  caption,
  lastUser,
  enabled,
  onOpenChat,
}: {
  state: OrbState
  caption: string
  lastUser: string | null
  enabled: boolean
  onOpenChat: () => void
}) {
  const userLine = state === 'thinking' ? lastUser : null
  const reply = state === 'speaking' ? caption.trim() : ''
  const long = reply.length > MAX_CAPTION
  const shown = long ? `${reply.slice(0, MAX_CAPTION).replace(/\s+\S*$/, '')}…` : reply

  return (
    <div className="home-caption-slot" aria-live="polite" aria-atomic="false">
      {enabled && (userLine || shown) && (
        <div className="home-captions">
          {userLine && <p className="home-captions__user">You: {userLine}</p>}
          {shown && <p className="home-captions__reply">{shown}</p>}
          {long && (
            <button type="button" className="home-captions__more" onClick={onOpenChat}>
              Open chat
            </button>
          )}
        </div>
      )}
    </div>
  )
}
