// Neon Noir's backdrop: a distant skyline along the top edge, a few signs
// humming in the haze, and fine rain that fades out before the middle of the
// screen. Everything sits in the top third, away from the words in the middle
// and the message box at the foot, and moves slowly. Drawn from shapes made
// here, with a fixed seed so every session gets the same street.

const W = 1600
const H = 1000
/** The skyline's base: everything above it is the city, below it only rain. */
const HORIZON = 250

/** A small seeded random source, so the skyline is the same every time. */
function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const round = n => Math.round(n * 10) / 10

function skyline(random, { minH, maxH, minW, maxW, className }) {
  const towers = []
  for (let x = -20; x < W + 20; ) {
    const w = minW + random() * (maxW - minW)
    const h = minH + random() * (maxH - minH)
    towers.push({ x, w, h })
    x += w + random() * 6
  }
  const shapes = towers.map(({ x, w, h }) => {
    const top = HORIZON - h
    // A few towers get a spire or a stepped crown.
    const r = random()
    if (r < 0.12) {
      const mid = x + w / 2
      return `<path class="${className}" d="M${round(x)} ${HORIZON}V${round(top)}H${round(mid - 2)}V${round(top - h * 0.25)}H${round(mid + 2)}V${round(top)}H${round(x + w)}V${HORIZON}Z"/>`
    }
    if (r < 0.3) {
      const step = w * 0.22
      return `<path class="${className}" d="M${round(x)} ${HORIZON}V${round(top + 14)}H${round(x + step)}V${round(top)}H${round(x + w - step)}V${round(top + 14)}H${round(x + w)}V${HORIZON}Z"/>`
    }
    return `<rect class="${className}" x="${round(x)}" y="${round(top)}" width="${round(w)}" height="${round(h)}"/>`
  })
  return { towers, markup: shapes.join('') }
}

function windows(random, towers) {
  const lit = []
  for (const { x, w, h } of towers) {
    const top = HORIZON - h + 10
    for (let y = top; y < HORIZON - 6; y += 7) {
      for (let wx = x + 3; wx < x + w - 4; wx += 6) {
        if (random() < 0.11) {
          lit.push(`M${round(wx)} ${round(y)}h2v2h-2z`)
        }
      }
    }
  }
  return `<path class="win" d="${lit.join('')}"/>`
}

/** Signs: thin glowing bars on the near towers, each with its own slow hum. */
function signs(random, towers) {
  const picks = towers.filter(t => t.h > 120 && t.w > 30)
  const out = []
  const hues = ['sign-m', 'sign-c', 'sign-y', 'sign-m', 'sign-c']
  for (let i = 0; i < picks.length && out.length < 9; i += 1 + Math.floor(random() * 3)) {
    const { x, w, h } = picks[i]
    const vertical = random() < 0.5
    const cls = hues[out.length % hues.length]
    const delay = round(random() * 9)
    if (vertical) {
      const sx = x + w * (0.2 + random() * 0.6)
      const sy = HORIZON - h + 18
      out.push(`<rect class="sign ${cls}" style="animation-delay:-${delay}s" x="${round(sx)}" y="${round(sy)}" width="3" height="${round(Math.min(70, h * 0.45))}" rx="1.5"/>`)
    } else {
      const sy = HORIZON - h * (0.45 + random() * 0.3)
      out.push(`<rect class="sign ${cls}" style="animation-delay:-${delay}s" x="${round(x + 5)}" y="${round(sy)}" width="${round(w - 10)}" height="3" rx="1.5"/>`)
    }
  }
  return out.join('')
}

/** Rain: two layers of short slanted strokes, tiled and falling. */
function rain(random, count, length) {
  const d = []
  for (let i = 0; i < count; i++) {
    const x = round(random() * 400)
    const y = round(random() * 400)
    d.push(`M${x} ${y}l-${round(length * 0.18)} ${length}`)
  }
  return d.join('')
}

export function buildScene() {
  const random = seeded(0x5eed1e55)
  const far = skyline(random, { minH: 40, maxH: 110, minW: 18, maxW: 46, className: 'far' })
  const near = skyline(random, { minH: 70, maxH: 190, minW: 28, maxW: 74, className: 'near' })

  const style = `
.sky{fill:url(#sky)}
.far{fill:#1a1630}
.near{fill:#110f20}
.win{fill:#f6d58a;opacity:.32}
.sign{opacity:.85;animation:hum 7s ease-in-out infinite}
.sign-m{fill:#ff3fbf;filter:url(#glow)}
.sign-c{fill:#2fe0ff;filter:url(#glow)}
.sign-y{fill:#ffc34d;filter:url(#glow)}
.haze-m{stop-color:#ff2bb4}
.haze-c{stop-color:#14d4f4}
.rain{fill:none;stroke:#9fb4ff;stroke-linecap:round}
.rain-a{stroke-width:1;opacity:.16;animation:fall-a 1.6s linear infinite}
.rain-b{stroke-width:.7;opacity:.1;animation:fall-b 2.4s linear infinite}
@keyframes hum{0%,100%{opacity:.85}46%{opacity:.85}48%{opacity:.35}50%{opacity:.8}52%{opacity:.45}54%{opacity:.85}}
@keyframes fall-a{from{transform:translate(0,0)}to{transform:translate(-72px,400px)}}
@keyframes fall-b{from{transform:translate(0,0)}to{transform:translate(-72px,400px)}}
@media (prefers-color-scheme:light){
.far{fill:#d9d5ea}
.near{fill:#cbc6e0}
.win{fill:#fff6dc;opacity:.7}
.sign{opacity:.55}
.rain{stroke:#7a72a8}
.rain-a{opacity:.12}
.rain-b{opacity:.08}
.core{stop-opacity:.1}
.night{stop-color:#eeecf5}
}
@media (prefers-reduced-motion:reduce){.sign,.rain-a,.rain-b{animation:none}}
`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin slice">
<style>${style}</style>
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" class="night" stop-color="#0d0b1a"/>
<stop offset="1" class="night" stop-color="#0a0913"/>
</linearGradient>
<radialGradient id="glow-m" cx=".22" cy=".24" r=".32">
<stop offset="0" class="haze-m core" stop-opacity=".22"/>
<stop offset="1" class="haze-m" stop-opacity="0"/>
</radialGradient>
<radialGradient id="glow-c" cx=".8" cy=".2" r=".3">
<stop offset="0" class="haze-c core" stop-opacity=".16"/>
<stop offset="1" class="haze-c" stop-opacity="0"/>
</radialGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fff"/>
<stop offset=".22" stop-color="#fff"/>
<stop offset=".45" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<mask id="upper"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
<feGaussianBlur stdDeviation="3" result="b"/>
<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<pattern id="rain-a" width="400" height="400" patternUnits="userSpaceOnUse">
<path class="rain" d="${rain(random, 26, 22)}"/>
</pattern>
<pattern id="rain-b" width="400" height="400" patternUnits="userSpaceOnUse">
<path class="rain" d="${rain(random, 34, 14)}"/>
</pattern>
</defs>
<rect class="sky" width="${W}" height="${H}"/>
<rect width="${W}" height="${H}" fill="url(#glow-m)"/>
<rect width="${W}" height="${H}" fill="url(#glow-c)"/>
<g>${far.markup}</g>
<g>${near.markup}</g>
${windows(random, near.towers)}
${signs(random, near.towers)}
<g mask="url(#upper)">
<rect class="rain-a" x="-400" y="-400" width="${W + 800}" height="${H + 400}" fill="url(#rain-a)"/>
<rect class="rain-b" x="-400" y="-400" width="${W + 800}" height="${H + 400}" fill="url(#rain-b)"/>
</g>
</svg>`
}

export const SCENE = buildScene()
