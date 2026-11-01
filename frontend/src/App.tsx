import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowRight, BrainCircuit, Camera, ChevronDown, Folder, Hand, HeartPulse, Home, Menu, Mic, Paperclip, Send, Settings, Smartphone, UserRound, X } from 'lucide-react'
import './App.css'

type OrbState = 'idle' | 'listening' | 'thinking'

const navItems = [
  { label: 'Home', icon: Home }, { label: 'Projects', icon: Folder }, { label: 'Health', icon: HeartPulse },
  { label: 'Devices', icon: Smartphone }, { label: 'Memory', icon: BrainCircuit }, { label: 'Settings', icon: Settings },
]
const cards = [
  { label: 'Projects', copy: 'Build. Innovate.', icon: Folder }, { label: 'Health', copy: 'Monitor. Care.', icon: HeartPulse }, { label: 'Devices', copy: 'Control. Connect.', icon: Smartphone },
]

function EagleMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 110 110" aria-hidden="true"><path d="M13 20 63 30 92 48 65 51 101 66 70 72 59 96 48 73 23 60 50 57 15 43 43 43Z" fill="currentColor" /><path d="m12 20 41 11-21 8 22 4-28 5 27 9-11 9L9 44l22-1L5 29Z" fill="#fff" /><path d="m64 31 29 17-28 3 34 15-31 6-10 24-7-24-28-12 27-3-15-14 28 6Z" fill="currentColor" opacity=".92" /><path d="m58 45 20 3-14 10 12 6-17 11-7-13-8-7Z" fill="#101010" /><path d="m82 55 18 11-24 6 4-13Z" fill="#f5a900" /></svg>
}

function HologramEagle() {
  return <svg viewBox="0 0 500 560" role="img" aria-label="Faceted BOZZ eagle hologram">
    <defs>
      <linearGradient id="goldFacet" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#fff6cf"/><stop offset=".24" stopColor="#ffc02b"/><stop offset=".61" stopColor="#b96600"/><stop offset="1" stopColor="#ffe59a"/></linearGradient>
      <linearGradient id="crystalFacet" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#fff"/><stop offset=".32" stopColor="#e9efff"/><stop offset=".67" stopColor="#71809b"/><stop offset="1" stopColor="#fff"/></linearGradient>
      <linearGradient id="darkFacet" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#181c24"/><stop offset=".45" stopColor="#9ba9c6"/><stop offset="1" stopColor="#3d424d"/></linearGradient>
      <filter id="holoGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g className="crystal-shadow" opacity=".42" filter="url(#softGlow)">
      <path d="M250 26 294 163 363 230 307 250 371 302 285 362 250 505 212 366 127 306 194 250 137 217 204 161Z" fill="#eaf1ff"/>
    </g>
    <g stroke="rgba(255,248,210,.78)" strokeWidth="1.5" strokeLinejoin="round" filter="url(#holoGlow)">
      <polygon points="250,22 292,154 250,206 212,145" fill="url(#crystalFacet)"/>
      <polygon points="250,22 250,206 280,114" fill="#fff" opacity=".72"/>
      <polygon points="212,145 250,206 185,220 144,179" fill="url(#crystalFacet)"/>
      <polygon points="292,154 355,220 313,236 250,206" fill="url(#crystalFacet)"/>
      <polygon points="144,179 185,220 67,267 191,286" fill="url(#goldFacet)"/>
      <polygon points="67,267 191,286 136,321" fill="#ffb10c"/>
      <polygon points="136,321 191,286 224,333 172,368" fill="url(#goldFacet)"/>
      <polygon points="191,286 250,206 265,306 224,333" fill="#ffdf78"/>
      <polygon points="355,220 432,292 320,313 300,264" fill="url(#crystalFacet)"/>
      <polygon points="432,292 374,346 320,313" fill="url(#darkFacet)"/>
      <polygon points="320,313 374,346 299,378 265,306" fill="url(#crystalFacet)"/>
      <polygon points="250,206 313,236 300,264 265,306" fill="url(#darkFacet)"/>
      <polygon points="191,286 224,333 250,418 172,368" fill="url(#crystalFacet)"/>
      <polygon points="224,333 265,306 250,418" fill="url(#goldFacet)"/>
      <polygon points="250,418 299,378 270,454 250,522" fill="url(#crystalFacet)"/>
      <polygon points="250,418 224,333 205,409 250,522" fill="url(#goldFacet)"/>
      <polygon points="205,409 250,522 182,436" fill="url(#crystalFacet)"/>
      <polygon points="250,206 265,306 225,286" fill="#17191f"/>
      <polygon points="225,286 265,306 250,330" fill="#fff4cf"/>
      <polygon points="225,286 250,330 207,313" fill="#cc7808"/>
      <polygon points="292,154 355,220 302,202" fill="#fff" opacity=".63"/>
      <polygon points="144,179 185,220 157,229" fill="#fff9d7" opacity=".83"/>
      <polygon points="320,313 299,378 273,343" fill="#fff" opacity=".58"/>
    </g>
    <g className="facet-lines" fill="none" stroke="#fff8d4" strokeOpacity=".7" strokeWidth="1">
      <path d="M250 22 185 220 250 206 355 220M67 267l157 66 41-27 55 7M172 368l52 41 26 113 49-144M212 145l-40 79 19 62M292 154l-42 52 63 30"/>
    </g>
    <g fill="#fff7c3" filter="url(#holoGlow)"><circle cx="67" cy="267" r="5"/><circle cx="144" cy="179" r="3"/><circle cx="355" cy="220" r="4"/><circle cx="250" cy="522" r="4"/></g>
  </svg>
}

function App() {
  const [active, setActive] = useState('Home')
  const [mobileNav, setMobileNav] = useState(false)
  const [message, setMessage] = useState('')
  const [caption, setCaption] = useState('Always here. Always with you.')
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [gestureOpen, setGestureOpen] = useState(false)
  const [cameraState, setCameraState] = useState<'off' | 'requesting' | 'active' | 'unavailable'>('off')
  const cameraStream = useRef<MediaStream | null>(null)
  const cameraPreview = useRef<HTMLVideoElement | null>(null)

  useEffect(() => () => cameraStream.current?.getTracks().forEach((track) => track.stop()), [])
  useEffect(() => { if (cameraPreview.current && cameraStream.current) cameraPreview.current.srcObject = cameraStream.current }, [cameraState])

  function submit() { const command = message.trim(); if (!command) return; setCaption(`Local command entered: ${command}`); setMessage(''); setOrbState('thinking'); window.setTimeout(() => setOrbState('idle'), 1300) }
  function listen() { const next = orbState === 'listening' ? 'idle' : 'listening'; setOrbState(next); setCaption(next === 'idle' ? 'Listening stopped.' : 'Voice recognition is not connected in this preview.') }
  async function toggleCamera() {
    if (cameraState === 'active') { cameraStream.current?.getTracks().forEach((track) => track.stop()); cameraStream.current = null; setCameraState('off'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setCameraState('unavailable'); return }
    setCameraState('requesting')
    try { cameraStream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); setCameraState('active') } catch { setCameraState('unavailable') }
  }
  function moveDeck(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const horizontal = (event.clientX - bounds.left) / bounds.width - .5
    const vertical = (event.clientY - bounds.top) / bounds.height - .5
    const deck = event.currentTarget.style
    deck.setProperty('--orb-pitch', `${(vertical * -5).toFixed(2)}deg`)
    deck.setProperty('--orb-yaw', `${(horizontal * 7).toFixed(2)}deg`)
    deck.setProperty('--panel-yaw', `${(horizontal * -1.8).toFixed(2)}deg`)
    deck.setProperty('--rail-yaw', `${(horizontal * .9).toFixed(2)}deg`)
    deck.setProperty('--card-pitch', `${(vertical * 1.6).toFixed(2)}deg`)
  }
  function settleDeck(event: PointerEvent<HTMLElement>) {
    const deck = event.currentTarget.style
    deck.setProperty('--orb-pitch', '0deg')
    deck.setProperty('--orb-yaw', '0deg')
    deck.setProperty('--panel-yaw', '0deg')
    deck.setProperty('--rail-yaw', '0deg')
    deck.setProperty('--card-pitch', '0deg')
  }

  return <main className="bozz-ui" onPointerMove={moveDeck} onPointerLeave={settleDeck}>
    <aside className={`left-rail ${mobileNav ? 'open' : ''}`}>
      <button className="rail-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X /></button>
      <div className="rail-brand"><EagleMark /><strong>BOZZ</strong><span>Your Personal AI Companion</span></div>
      <nav>{navItems.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'selected' : ''} onClick={() => { setActive(label); setMobileNav(false) }}><Icon /><span>{label}</span></button>)}</nav>
      <div className="rail-status"><i /> <div><strong>Local interface</strong><span>No service connection</span></div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <section className="command-world">
      <header><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu /></button><div className="demo-pill"><span>⚗</span> Demo Mode</div><div className="time-block"><strong>10:24 PM</strong><span>Visual preview</span></div><div className="profile"><UserRound /><ChevronDown /></div></header>
      <section className="hero-copy"><span>Good evening,</span><h1>I&apos;m <em>BOZZ.</em></h1><p>{caption}</p><i /></section>
      <section className={`hologram ${orbState}`} aria-label={`BOZZ is ${orbState}`}><div className="beacon-beam" /><div className="hologram-volume" aria-hidden="true"><i /><i /><i /><i /></div><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit orbit-c" /><div className="eagle-orb"><HologramEagle /></div><div className="energy-base"><span /><span /><span /></div><b className="spark one" /><b className="spark two" /><b className="spark three" /><b className="spark four" /></section>
      <section className="feature-cards">{cards.map(({ label, copy, icon: Icon }) => <button key={label} onClick={() => setActive(label)}><span className="card-icon"><Icon /></span><span><strong>{label}</strong><small>{copy}</small></span><ArrowRight /></button>)}</section>
      <form className="ask-bar" onSubmit={(event) => { event.preventDefault(); submit() }}><span className="ask-eagle"><EagleMark /></span><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask BOZZ anything..." aria-label="Ask BOZZ anything" /><button type="button" className="plain-button" aria-label="Attachment unavailable"><Paperclip /></button><button type="button" className={`plain-button ${orbState === 'listening' ? 'active-mic' : ''}`} onClick={listen} aria-label="Toggle listening"><Mic /></button><button className="send-orb" aria-label="Send command"><Send /></button></form>
    </section>
    <aside className="right-stack">
      <section className="edge-panel status-panel"><div className="panel-title"><span><i /> System Status</span><b>Demo preview</b></div><div className="gauges">{['CPU', 'RAM', 'Temp'].map((item, index) => <div key={item} className={`gauge gauge-${index}`}><div><strong>--</strong></div><span>{item}</span><small>Not connected</small></div>)}</div></section>
      <section className="edge-panel actions-panel"><div className="panel-title"><span><b className="bolt">ϟ</b> Quick Actions</span><ArrowRight /></div><div className="action-grid"><button onClick={() => setActive('Projects')}><Folder />Open Projects</button><button onClick={() => setCaption('Screenshot action needs a connected system.')}><Camera />Take Screenshot</button><button onClick={() => setActive('Devices')}><Home />Control Devices</button><button onClick={() => setActive('Memory')}><BrainCircuit />View Memory</button><button className={`gesture-action ${cameraState === 'active' ? 'camera-active' : ''}`} onClick={() => setGestureOpen((open) => !open)}><Hand />Gesture Control <small>{cameraState === 'active' ? 'CAMERA ACTIVE' : 'OPEN'}</small></button></div>{gestureOpen && <div className="gesture-control"><div><strong><Hand /> Gesture interface</strong><span className={cameraState === 'active' ? 'is-active' : ''}>{cameraState === 'active' ? 'CAMERA ACTIVE' : 'CAMERA OFF'}</span></div>{cameraState === 'active' && <video ref={cameraPreview} autoPlay muted playsInline />}{cameraState !== 'active' && <p>Enable a local camera preview to begin. Gesture tracking is not connected yet and no camera footage is recorded.</p>}<button onClick={toggleCamera} disabled={cameraState === 'requesting'}>{cameraState === 'active' ? 'Turn camera off' : cameraState === 'requesting' ? 'Requesting camera...' : 'Enable camera preview'}</button><small>Mouse/touch alternative: move over the scene, tap cards, or use the command bar.</small></div>}</section>
      <section className="edge-panel mission-panel"><div className="panel-title"><span><b className="star">★</b> Mission Panel</span><small>View All <ArrowRight /></small></div><div className="mission-content"><div className="mission-ring"><strong>--</strong><span>no data</span></div><div><strong>No active mission</strong><span>Connect a task source to see progress.</span><div className="mission-line"><i /></div><em>“Dream. Plan. Create.” — BOZZ</em></div></div></section>
    </aside>
  </main>
}

export default App
