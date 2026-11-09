import { useEffect, useState } from 'react'

const DUST = [
  { left: 6, top: 22, size: 2, delay: 0, duration: 24 },
  { left: 14, top: 64, size: 1.5, delay: 3, duration: 20 },
  { left: 22, top: 38, size: 2.5, delay: 6, duration: 28 },
  { left: 31, top: 76, size: 1.5, delay: 1.5, duration: 22 },
  { left: 38, top: 18, size: 2, delay: 8, duration: 26 },
  { left: 44, top: 56, size: 1.5, delay: 4, duration: 19 },
  { left: 52, top: 30, size: 2.5, delay: 10, duration: 30 },
  { left: 58, top: 70, size: 2, delay: 2, duration: 23 },
  { left: 64, top: 12, size: 1.5, delay: 7, duration: 27 },
  { left: 71, top: 48, size: 2, delay: 5, duration: 21 },
  { left: 78, top: 82, size: 2.5, delay: 9, duration: 29 },
  { left: 84, top: 34, size: 1.5, delay: 3.5, duration: 25 },
  { left: 90, top: 60, size: 2, delay: 11, duration: 22 },
  { left: 12, top: 86, size: 2, delay: 6.5, duration: 26 },
  { left: 68, top: 88, size: 1.5, delay: 1, duration: 20 },
  { left: 36, top: 92, size: 2, delay: 8.5, duration: 28 },
]

export function HudFrame() {
  const [paused, setPaused] = useState(() => document.hidden)

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return (
    <div className="hud" data-paused={paused ? 'true' : 'false'} aria-hidden="true">
      <div className="hud__honeycomb">
        <svg width="100%" height="100%" focusable="false">
          <defs>
            <pattern id="hud-hex" width="48" height="42" patternUnits="userSpaceOnUse">
              <path
                d="M24 1 L43 11.5 L43 30.5 L24 41 L5 30.5 L5 11.5 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.7"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hud-hex)" />
        </svg>
      </div>
      <div className="hud__sunburst" />
      <div className="hud__rings">
        <svg viewBox="0 0 600 600" focusable="false" fill="none" stroke="currentColor">
          <g className="hud__rings-a">
            <circle cx="300" cy="300" r="282" strokeOpacity="0.2" strokeDasharray="1 14" />
            <circle cx="300" cy="300" r="246" strokeOpacity="0.13" strokeDasharray="18 12" />
          </g>
          <g className="hud__rings-b">
            <circle cx="300" cy="300" r="210" strokeOpacity="0.18" strokeDasharray="2 9" />
            <circle cx="300" cy="300" r="168" strokeOpacity="0.1" strokeDasharray="26 18" />
          </g>
        </svg>
      </div>
      <div className="hud__floor" />
      <div className="hud__dust">
        {DUST.map((particle, index) => (
          <span
            key={index}
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              width: particle.size,
              height: particle.size,
              animationDelay: `${particle.delay}s`,
              animationDuration: `${particle.duration}s`,
            }}
          />
        ))}
      </div>
      <div className="hud__vignette" />

      <div className="hud__frame">
        <span className="hud__corner hud__corner--tl" />
        <span className="hud__corner hud__corner--tr" />
        <span className="hud__corner hud__corner--bl" />
        <span className="hud__corner hud__corner--br" />
      </div>
    </div>
  )
}
