// Neon Noir's backdrop: a megacity at night, drawn here from shapes with a fixed
// seed. Towers stacked in three layers, thousands of lit windows, neon signs and
// two wordless holographic billboards, slow flying traffic, searchlights, a neon
// grid floor drifting toward you, data streams falling down both sides, rain,
// scanlines and a rare screen tear. No text anywhere. CSS animation only: no script, nothing loaded.
//
// The tall towers, the billboards and the heaviest rain frame the window's sides;
// a darker pool in the middle keeps the conversation calm. The app frosts its
// panels over all of it. With reduced motion on, everything holds still.

const W = 1600
const H = 1000
/** Where the city meets the grid floor. */
const HORIZON = 640

function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const r1 = n => Math.round(n * 10) / 10
const pick = (random, list) => list[Math.floor(random() * list.length)]

/**
 * One layer of towers. `height(x)` shapes the skyline: tall at the sides,
 * lower in the middle, so the city frames the conversation.
 */
function towers(random, { minW, maxW, height, jitter }) {
  const out = []
  for (let x = -30; x < W + 30; ) {
    const w = minW + random() * (maxW - minW)
    const h = Math.max(30, height(x + w / 2) * (1 - jitter + random() * jitter * 2))
    out.push({ x, w, h, top: HORIZON - h })
    x += w + random() * 4
  }
  return out
}

function towerPath(t, random) {
  const { x, w, top } = t
  const r = random()
  if (r < 0.15) {
    // A spire with a beacon.
    const mid = x + w / 2
    t.beacon = { x: mid, y: top - t.h * 0.22 }
    return `M${r1(x)} ${HORIZON}V${r1(top)}H${r1(mid - 2)}V${r1(top - t.h * 0.22)}H${r1(mid + 2)}V${r1(top)}H${r1(x + w)}V${HORIZON}Z`
  }
  if (r < 0.4) {
    // A stepped crown.
    const s = w * 0.2
    return `M${r1(x)} ${HORIZON}V${r1(top + 18)}H${r1(x + s)}V${r1(top + 8)}H${r1(x + 2 * s)}V${r1(top)}H${r1(x + w - 2 * s)}V${r1(top + 8)}H${r1(x + w - s)}V${r1(top + 18)}H${r1(x + w)}V${HORIZON}Z`
  }
  if (r < 0.55) {
    // A slanted roof.
    return `M${r1(x)} ${HORIZON}V${r1(top + 22)}L${r1(x + w)} ${r1(top)}V${HORIZON}Z`
  }
  return `M${r1(x)} ${r1(top)}h${r1(w)}V${HORIZON}h${r1(-w)}Z`
}

function windowRows(random, list, density, groups) {
  const paths = groups.map(() => [])
  for (const { x, w, top } of list) {
    const step = 5 + Math.floor(random() * 2)
    for (let y = top + 12; y < HORIZON - 4; y += step) {
      for (let wx = x + 3; wx < x + w - 4; wx += 5) {
        if (random() < density) {
          paths[Math.floor(random() * groups.length)].push(`M${r1(wx)} ${r1(y)}h2v2h-2z`)
        }
      }
    }
  }
  return paths.map((p, i) => `<path class="${groups[i]}" d="${p.join('')}"/>`).join('')
}

/** Neon tubes hung on the near towers: wordless shapes, each with its own slow hum. */
function signs(random, near) {
  const hues = ['ny', 'nc', 'nm', 'ny', 'nc']
  const out = []
  const tall = near.filter(t => t.h > 220 && t.w > 40)
  for (let i = 0; i < tall.length && out.length < 7; i += 2 + Math.floor(random() * 2)) {
    const t = tall[i]
    const hue = hues[out.length % hues.length]
    const sx = r1(t.x + t.w * (0.2 + random() * 0.5))
    const sy = r1(t.top + 30 + random() * 50)
    const len = r1(40 + random() * 70)
    const shape =
      random() < 0.5
        ? `<rect x="${sx}" y="${sy}" width="3" height="${len}" rx="1.5"/>` // a vertical tube
        : `<rect x="${sx}" y="${sy}" width="${r1(len * 0.6)}" height="3" rx="1.5"/><rect x="${sx}" y="${r1(sy + 9)}" width="${r1(len * 0.35)}" height="3" rx="1.5"/>` // two bars
    const delay = r1(random() * 11)
    out.push(`<g class="sign ${hue} ${random() < 0.25 ? 'flick' : 'hum'}" style="animation-delay:-${delay}s">${shape}</g>`)
  }
  return out.join('')
}

/**
 * A holographic billboard with no words, in an angular HUD frame: two corners cut
 * away, a hazard-stripe strip along the foot, a framed emblem that drifts apart
 * into red and cyan, scrolling bars and a scan sweep.
 */
function billboard(id, { x, y, w, h, hue }) {
  const c = 16 // the cut corner
  const frame = `M${x + c} ${y}H${x + w}V${y + h - c}L${x + w - c} ${y + h}H${x}V${y + c}Z`
  const bar = (i, dy) =>
    `<rect x="${r1(x + 12)}" y="${r1(y + h - 40 + i * 8 + dy)}" width="${r1((w - 24) * (0.3 + ((i * 37) % 60) / 100))}" height="2" class="bar"/>`
  const bars = Array.from({ length: 6 }, (_, i) => bar(i, 0) + bar(i, 48)).join('')
  const cx = x + w / 2
  const cy = y + h * 0.4
  const rr = h * 0.19
  // An emblem: a hexagon around a rising chevron.
  const hex = Array.from({ length: 6 }, (_, i) => {
    const t = (Math.PI / 3) * i + Math.PI / 6
    return `${r1(cx + rr * Math.cos(t))} ${r1(cy + rr * Math.sin(t))}`
  }).join('L')
  const emblem = cls =>
    `<g class="${cls}"><path d="M${hex}Z" fill="none" stroke-width="3"/><path d="M${r1(cx - rr * 0.5)} ${r1(cy + rr * 0.3)}L${r1(cx)} ${r1(cy - rr * 0.3)}L${r1(cx + rr * 0.5)} ${r1(cy + rr * 0.3)}" fill="none" stroke-width="3"/></g>`
  return `<g class="bb ${hue}">
<clipPath id="${id}-clip"><path d="${frame}"/></clipPath>
<path d="${frame}" class="bb-back"/>
<g clip-path="url(#${id}-clip)">
<g class="bb-scroll">${bars}</g>
${emblem('bb-r')}${emblem('bb-b')}${emblem('bb-main')}
<rect x="${x}" y="${y + h - 9}" width="${w}" height="9" fill="url(#hazard)" class="bb-hazard"/>
<rect x="${x}" y="${y}" width="${w}" height="${r1(h * 0.18)}" class="bb-sweep"/>
</g>
<path d="${frame}" class="bb-frame"/>
</g>`
}

/** Data streams: thin falling lines of light down the sides, brightest at the head. */
function streams(random) {
  const out = []
  for (let x = 14; x < W; x += 26) {
    const edge = Math.min(x, W - x) / (W / 2) // 0 at the sides, 1 in the middle
    if (edge > 0.3 || random() < 0.35) {
      continue
    }
    const len = r1(60 + random() * 140)
    const dur = r1(6 + random() * 8)
    const delay = r1(random() * dur)
    const hue = random() < 0.65 ? 'sc' : 'sg'
    out.push(
      `<rect class="stream ${hue}" style="animation-duration:${dur}s;animation-delay:-${delay}s" x="${x}" y="${-len}" width="1.6" height="${len}" fill="url(#${hue})"/>`,
    )
  }
  return out.join('')
}

function traffic(random) {
  const out = []
  for (let i = 0; i < 8; i++) {
    const y = r1(140 + random() * 380)
    const rtl = random() < 0.5
    const dur = r1(18 + random() * 30)
    const delay = r1(random() * dur)
    const hue = pick(random, ['tc', 'tm', 'tw', 'ty'])
    const len = r1(10 + random() * 26)
    out.push(
      `<g class="car ${rtl ? 'rtl' : 'ltr'}" style="animation-duration:${dur}s;animation-delay:-${delay}s"><rect class="${hue}" x="0" y="${y}" width="${len}" height="2.4" rx="1.2"/><circle class="${hue}" cx="${rtl ? 0 : len}" cy="${r1(y + 1.2)}" r="2.2"/></g>`,
    )
  }
  return out.join('')
}

function rainStrokes(random, count, length) {
  const d = []
  for (let i = 0; i < count; i++) {
    d.push(`M${r1(random() * 400)} ${r1(random() * 400)}l-${r1(length * 0.16)} ${length}`)
  }
  return d.join('')
}

function gridFloor() {
  const vx = W / 2
  const rays = []
  for (let x = -2400; x <= W + 2400; x += 160) {
    rays.push(`M${vx} ${HORIZON}L${x} ${H + 40}`)
  }
  const lines = Array.from(
    { length: 9 },
    (_, i) => `<line class="gl" x1="-200" x2="${W + 200}" y1="${HORIZON}" y2="${HORIZON}" style="animation-delay:-${r1(i * 1)}s"/>`,
  ).join('')
  return `<path class="grid" d="${rays.join('')}"/>${lines}`
}

export function buildScene() {
  const random = seeded(0x5eed1e55)
  const sideHeavy = (base, peak) => x => {
    const edge = Math.min(Math.max(x, 0), W - Math.min(x, W)) / (W / 2) // 0 at the sides, 1 in the middle
    return base + peak * (1 - edge) ** 1.6
  }
  const far = towers(random, { minW: 16, maxW: 40, height: sideHeavy(90, 160), jitter: 0.45 })
  const mid = towers(random, { minW: 26, maxW: 60, height: sideHeavy(60, 300), jitter: 0.35 })
  const near = towers(random, { minW: 40, maxW: 96, height: sideHeavy(30, 470), jitter: 0.3 })
  const farD = far.map(t => towerPath(t, random)).join('')
  const midD = mid.map(t => towerPath(t, random)).join('')
  const nearD = near.map(t => towerPath(t, random)).join('')
  const beacons = [...mid, ...near]
    .filter(t => t.beacon)
    .map((t, i) => `<circle class="beacon" style="animation-delay:-${r1(i * 0.37)}s" cx="${r1(t.beacon.x)}" cy="${r1(t.beacon.y)}" r="2.6"/>`)
    .join('')

  const style = `
svg{background:#05070b}
.sky{fill:url(#sky)}
.far{fill:#121a24}
.mid{fill:#0c121b}
.near{fill:#070a10}
.edge{fill:none;stroke:#00f0ff;stroke-width:1;opacity:.14}
.w1{fill:#00f0ff;opacity:.5}
.w2{fill:#ff3b4a;opacity:.45}
.w3{fill:#f7e017;opacity:.5}
.w4{fill:#ffffff;opacity:.25}
.tw-a{animation:twinkle 9s steps(2) infinite}
.tw-b{animation:twinkle 13s steps(2) infinite reverse}
.beacon{fill:#ff2a55;filter:url(#glow);animation:blink 3.2s steps(1) infinite}
.sign{filter:url(#neon);opacity:.8}
.nm{fill:#ff3b4a}.nc{fill:#00f0ff}.ny{fill:#f7e017}
.hum{animation:hum 12s ease-in-out infinite}
.flick{animation:flick 14s steps(1) infinite}
.bb{filter:url(#neon);opacity:.8}
.bb-back{fill:#06080d;opacity:.88}
.bb-hazard{opacity:.55}
.bb-frame{fill:none;stroke-width:1.6}
.bb.m .bb-frame,.bb.m .bb-main{stroke:#f7e017}.bb.m .bar{fill:#f7e017}
.bb.c .bb-frame,.bb.c .bb-main{stroke:#00f0ff}.bb.c .bar{fill:#00f0ff}
.bb .bar{opacity:.35}
.bb-scroll{animation:scroll 6s linear infinite}
.bb-r{stroke:#ff3b4a;opacity:.6;animation:split-r 11s steps(1) infinite}
.bb-b{stroke:#00f0ff;opacity:.6;animation:split-b 11s steps(1) infinite}
.bb-sweep{fill:url(#sweep);animation:sweep 6s linear infinite}
.stream{opacity:.45;animation-name:fall;animation-timing-function:linear;animation-iteration-count:infinite}
.car{animation-timing-function:linear;animation-iteration-count:infinite;filter:url(#glow)}
.ltr{animation-name:ltr}.rtl{animation-name:rtl}
.tc{fill:#00f0ff}.tm{fill:#ff3b4a}.tw{fill:#ffffff}.ty{fill:#f7e017}
.beam{fill:url(#beam);transform-box:fill-box;transform-origin:50% 100%}
.beam-a{animation:sweep-a 26s ease-in-out infinite alternate}
.beam-b{animation:sweep-b 31s ease-in-out infinite alternate}
.grid{fill:none;stroke:#ff3b4a;stroke-width:1;opacity:.18}
.gl{stroke:#ff3b4a;stroke-width:1;animation:rush 9s cubic-bezier(.6,0,1,.6) infinite}
.rain{fill:none;stroke:#b7c6ff;stroke-linecap:round}
.rain-a{opacity:.1;animation:drop 1.4s linear infinite}
.rain-b{opacity:.06;animation:drop 2.2s linear infinite}
.scan{fill:url(#scanlines);opacity:.2}
.roll{fill:url(#roll);animation:roll 12s linear infinite}
.tear{opacity:0;animation:tear 23s steps(1) infinite}
@keyframes twinkle{0%{opacity:.55}50%{opacity:.15}}
@keyframes blink{0%{opacity:1}50%{opacity:.15}}
@keyframes hum{0%,100%{opacity:1}50%{opacity:.82}}
@keyframes flick{0%{opacity:1}61%{opacity:.2}62%{opacity:1}64%{opacity:.25}65%{opacity:1}88%{opacity:.4}89%{opacity:1}}
@keyframes scroll{to{transform:translateY(-54px)}}
@keyframes sweep{from{transform:translateY(-40px)}to{transform:translateY(240px)}}
@keyframes split-r{0%{transform:translate(-2px,0)}70%{transform:translate(-7px,1px)}72%{transform:translate(-2px,0)}86%{transform:translate(4px,-1px)}87%{transform:translate(-2px,0)}}
@keyframes split-b{0%{transform:translate(2px,0)}70%{transform:translate(7px,-1px)}72%{transform:translate(2px,0)}86%{transform:translate(-4px,1px)}87%{transform:translate(2px,0)}}
@keyframes fall{from{transform:translateY(0)}to{transform:translateY(${H + 700}px)}}
@keyframes ltr{from{transform:translateX(-120px)}to{transform:translateX(${W + 120}px)}}
@keyframes rtl{from{transform:translateX(${W + 120}px)}to{transform:translateX(-120px)}}
@keyframes sweep-a{from{transform:rotate(-28deg)}to{transform:rotate(18deg)}}
@keyframes sweep-b{from{transform:rotate(24deg)}to{transform:rotate(-20deg)}}
@keyframes rush{0%{transform:translateY(0);opacity:0}15%{opacity:.6}100%{transform:translateY(${H - HORIZON + 20}px);opacity:.9}}
@keyframes drop{from{transform:translate(0,0)}to{transform:translate(-64px,400px)}}
@keyframes roll{from{transform:translateY(-200px)}to{transform:translateY(${H + 200}px)}}
@keyframes tear{0%{opacity:0;transform:translateX(0)}93%{opacity:1;transform:translateX(18px)}94%{opacity:1;transform:translateX(-12px)}95%{opacity:0;transform:translateX(0)}}
@keyframes tear2{0%{opacity:0;transform:translateX(0)}71%{opacity:1;transform:translateX(-22px)}72%{opacity:0;transform:translateX(0)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<style>${style}</style>
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#030508"/>
<stop offset=".35" stop-color="#07101a"/>
<stop offset=".58" stop-color="#1c1018"/>
<stop offset=".64" stop-color="#3a1414"/>
<stop offset=".66" stop-color="#0b0b12"/>
<stop offset="1" stop-color="#05070b"/>
</linearGradient>
<radialGradient id="smog" cx=".5" cy=".64" r=".55">
<stop offset="0" stop-color="#ff3b4a" stop-opacity=".18"/>
<stop offset=".5" stop-color="#f7a017" stop-opacity=".06"/>
<stop offset="1" stop-color="#000" stop-opacity="0"/>
</radialGradient>
<radialGradient id="pool" cx=".5" cy=".46" r=".42">
<stop offset="0" stop-color="#05070b" stop-opacity=".8"/>
<stop offset="1" stop-color="#05070b" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vignette" cx=".5" cy=".5" r=".75">
<stop offset=".6" stop-color="#000" stop-opacity="0"/>
<stop offset="1" stop-color="#000" stop-opacity=".7"/>
</radialGradient>
<linearGradient id="beam" x1="0" y1="1" x2="0" y2="0">
<stop offset="0" stop-color="#bfe9ff" stop-opacity=".16"/>
<stop offset="1" stop-color="#bfe9ff" stop-opacity="0"/>
</linearGradient>
<linearGradient id="sweep" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fff" stop-opacity="0"/>
<stop offset=".5" stop-color="#fff" stop-opacity=".18"/>
<stop offset="1" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<linearGradient id="roll" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#9ff" stop-opacity="0"/>
<stop offset=".5" stop-color="#9ff" stop-opacity=".05"/>
<stop offset="1" stop-color="#9ff" stop-opacity="0"/>
</linearGradient>
<linearGradient id="floorfade" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fff" stop-opacity=".2"/>
<stop offset=".25" stop-color="#fff" stop-opacity="1"/>
</linearGradient>
<linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e017" stop-opacity="0"/><stop offset=".85" stop-color="#f7e017" stop-opacity=".6"/><stop offset="1" stop-color="#fff8c8"/></linearGradient>
<linearGradient id="sc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00f0ff" stop-opacity="0"/><stop offset=".85" stop-color="#00f0ff" stop-opacity=".7"/><stop offset="1" stop-color="#e0fbff"/></linearGradient>
<mask id="floormask"><rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#floorfade)"/></mask>
<pattern id="hazard" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="14" fill="#f7e017"/></pattern>
<pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.4" fill="#000"/></pattern>
<pattern id="rain-a" width="400" height="400" patternUnits="userSpaceOnUse"><path class="rain" d="${rainStrokes(random, 30, 26)}"/></pattern>
<pattern id="rain-b" width="400" height="400" patternUnits="userSpaceOnUse"><path class="rain" d="${rainStrokes(random, 40, 15)}"/></pattern>
<filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="neon" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<clipPath id="band1"><rect y="300" width="${W}" height="22"/></clipPath>
<clipPath id="band2"><rect y="470" width="${W}" height="9"/></clipPath>
</defs>
<rect class="sky" width="${W}" height="${H}"/>
<rect width="${W}" height="${H}" fill="url(#smog)"/>
<path class="beam beam-a" d="M250 ${HORIZON}l-90 -620h180z"/>
<path class="beam beam-b" d="M1360 ${HORIZON}l-80 -600h160z"/>
<g id="city">
<path class="far" d="${farD}"/>
${windowRows(random, far, 0.05, ['w4', 'w3'])}
<path class="mid" d="${midD}"/>
${windowRows(random, mid, 0.11, ['w1 tw-a', 'w3', 'w2 tw-b', 'w4'])}
${traffic(random)}
<path class="near" d="${nearD}"/>
<path class="edge" d="${nearD}"/>
${windowRows(random, near, 0.09, ['w1', 'w3 tw-b', 'w2', 'w4 tw-a'])}
${beacons}
${signs(random, near)}
${billboard('bb1', { x: 70, y: 230, w: 200, h: 120, hue: 'm' })}
${billboard('bb2', { x: 1340, y: 270, w: 180, h: 110, hue: 'c' })}
</g>
<g mask="url(#floormask)">${gridFloor()}</g>
<g>${streams(random)}</g>
<rect width="${W}" height="${H}" fill="url(#pool)"/>
<rect class="rain-a" x="-400" y="-400" width="${W + 800}" height="${H + 800}" fill="url(#rain-a)"/>
<rect class="rain-b" x="-400" y="-400" width="${W + 800}" height="${H + 800}" fill="url(#rain-b)"/>
<use href="#city" xlink:href="#city" clip-path="url(#band1)" class="tear"/>
<rect class="scan" width="${W}" height="${H}"/>
<rect class="roll" width="${W}" height="200"/>
<rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>`
}

export const SCENE = buildScene()
