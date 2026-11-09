export function CrystalStar() {
  return <svg viewBox="0 0 520 560" role="img" aria-label="Faceted BOZZ white-gold crystalline core">
    <defs>
      <linearGradient id="ivoryFacet" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#ffffff"/><stop offset=".3" stopColor="#fff6dc"/><stop offset=".62" stopColor="#d9c89c"/><stop offset="1" stopColor="#fffdf6"/></linearGradient>
      <linearGradient id="ivoryFacet2" x1="1" x2="0" y1="0" y2="1"><stop stopColor="#fffdf4" stopOpacity=".95"/><stop offset=".45" stopColor="#e8d7ab"/><stop offset="1" stopColor="#8c7340"/></linearGradient>
      <linearGradient id="goldFacet" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#fff3c4"/><stop offset=".28" stopColor="#ffd34d"/><stop offset=".66" stopColor="#c98a00"/><stop offset="1" stopColor="#ffe59a"/></linearGradient>
      <linearGradient id="goldFacet2" x1="1" x2="0" y1="1" y2="0"><stop stopColor="#8a5c00"/><stop offset=".5" stopColor="#f5b800"/><stop offset="1" stopColor="#ffe9ad"/></linearGradient>
      <linearGradient id="shadeFacet" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#191307"/><stop offset=".5" stopColor="#a08a58"/><stop offset="1" stopColor="#3a2f18"/></linearGradient>
      <filter id="starGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="coreBloom" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="15"/></filter>
    </defs>

    <ellipse cx="246" cy="292" rx="128" ry="158" fill="#ffc23a" opacity=".36" filter="url(#coreBloom)"/>

    <g className="star-wire" fill="none" stroke="#ffe9a8" strokeOpacity=".5" strokeWidth="1">
      <path d="M64 208 152 92 272 22 366 122 462 206 384 328 276 452 156 368Z"/>
      <path d="M152 92 272 268 64 208M366 122 272 268 462 206M272 268 276 452M156 368 272 268 384 328"/>
    </g>

    <g stroke="rgba(255,252,236,.9)" strokeWidth="1.6" strokeLinejoin="round" filter="url(#starGlow)">
      <polygon points="272,22 300,178 246,192" fill="url(#ivoryFacet)"/>
      <polygon points="272,22 246,192 196,146 152,92" fill="url(#ivoryFacet2)"/>
      <polygon points="152,92 196,146 128,232 64,208" fill="url(#ivoryFacet)"/>
      <polygon points="64,208 128,232 112,298 40,316" fill="url(#goldFacet)"/>
      <polygon points="128,232 196,146 246,192 208,286" fill="url(#goldFacet2)"/>
      <polygon points="112,298 208,286 182,352 96,340" fill="url(#goldFacet)"/>
      <polygon points="300,178 366,122 462,206 336,240" fill="url(#ivoryFacet2)"/>
      <polygon points="300,178 336,240 272,268 246,192" fill="url(#shadeFacet)"/>
      <polygon points="246,192 272,268 208,286" fill="#fff4cf" opacity=".92"/>
      <polygon points="336,240 462,206 396,300" fill="url(#ivoryFacet)"/>
      <polygon points="336,240 396,300 302,326 272,268" fill="url(#ivoryFacet2)"/>
      <polygon points="208,286 272,268 302,326 254,388 182,352" fill="url(#goldFacet)"/>
      <polygon points="182,352 254,388 228,462 96,340 156,368" fill="url(#shadeFacet)"/>
      <polygon points="254,388 302,326 344,384 276,452" fill="url(#ivoryFacet)"/>
      <polygon points="254,388 276,452 228,462" fill="url(#goldFacet2)"/>
      <polygon points="276,452 302,326 344,384 336,430 292,472" fill="url(#ivoryFacet2)"/>
      <polygon points="276,452 292,472 258,528 238,486 228,462" fill="url(#ivoryFacet)"/>
      <polygon points="396,300 448,332 408,382 344,384" fill="url(#shadeFacet)"/>
      <polygon points="408,382 448,332 470,368 420,412" fill="url(#ivoryFacet)"/>
    </g>

    <g className="facet-lines" fill="none" stroke="#fff8d4" strokeOpacity=".72" strokeWidth="1">
      <path d="M272 22 246 192 128 232 64 208M196 146 300 178 336 240 272 268 208 286 112 298M272 268 302 326 254 388 276 452M336 240 396 300 344 384 292 472M396 300 448 332 408 382"/>
    </g>

    <g fill="#fff8d8" filter="url(#starGlow)">
      <circle cx="272" cy="22" r="5"/><circle cx="152" cy="92" r="3"/><circle cx="64" cy="208" r="4.2"/>
      <circle cx="40" cy="316" r="3.4"/><circle cx="462" cy="206" r="4.4"/><circle cx="276" cy="452" r="3.6"/>
      <circle cx="258" cy="528" r="3"/><circle cx="272" cy="268" r="2.6"/><circle cx="336" cy="240" r="2.6"/>
      <circle cx="448" cy="332" r="2.8"/>
    </g>
  </svg>
}
