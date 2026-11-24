/**
 * Nimbus UI · Waterline. Original GLSL and spring/wave model by Guglielmo Giannattasio.
 * https://21st.dev/@gughigug/components/liquid-glass-navbar (MIT)
 *
 * Copyright (c) Guglielmo Giannattasio
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const PAD = 14

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`
const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uDpr;uniform float uTime;uniform vec4 uPill;
uniform vec4 uBlob[6];uniform float uSy[6];uniform vec4 uRip[6];uniform vec3 uMouse;uniform float uDark;uniform float uAmb;
float sdRB(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float sdCap(vec2 p,vec4 B,float sy){p-=B.xy;p.y/=sy;p.x=max(abs(p.x)-B.z,0.);return(length(p)-B.w)*min(1.,sy);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float dropD(vec2 p){float d=1e4;for(int i=0;i<6;i++){if(uBlob[i].w>.5){d=smin(d,sdCap(p,uBlob[i],uSy[i]),13.);}}return d;}
float pillD(vec2 p){vec2 h=uPill.zw*.5;return sdRB(p-uPill.xy-h,h,h.y);}
float lens(float d,float w){float t=clamp(-d/w,0.,1.);return sqrt(1.-(1.-t)*(1.-t));}
float waves(vec2 p){float w=0.;
 for(int i=0;i<6;i++){vec4 R=uRip[i];if(R.w>0.){float x=length(p-R.xy)-R.z*240.;w+=R.w*exp(-R.z*1.7)*sin(x*.3)*exp(-x*x/700.);}}
 vec2 m=p-uMouse.xy;w+=uMouse.z*3.6*exp(-dot(m,m)/1000.);
 w+=uAmb*(sin(p.x*.05+uTime*1.2)*.45+sin(p.x*.13-uTime*.85+p.y*.2)*.25);return w;}
float H(vec2 p){float dp=pillD(p);return lens(dp,uPill.w*.36)*2.4+lens(dropD(p),11.)*7.5+waves(p)*smoothstep(0.,7.,-dp);}
float caus(vec2 p,float t){vec2 q=p;float c=0.;for(int i=0;i<3;i++){q+=vec2(sin(q.y*1.1+t),cos(q.x*1.3-t*.7))*.6;c+=1./(1.+16.*abs(sin(q.x)*sin(q.y)));}return c/3.;}
void main(){
 vec2 p=vec2(gl_FragCoord.x,uRes.y*uDpr-gl_FragCoord.y)/uDpr;
 float dp=pillD(p);float dd=dropD(p);
 float h0=H(p);vec3 n=normalize(vec3(h0-H(p+vec2(1.,0.)),h0-H(p+vec2(0.,1.)),1.));
 vec3 V=vec3(0.,0.,1.);
 float spec=pow(max(dot(reflect(-normalize(vec3(-.45,-.8,.85)),n),V),0.),70.);
 float spec2=pow(max(dot(reflect(-normalize(vec3(.6,.75,.7)),n),V),0.),22.)*.3;
 float fres=clamp((1.-n.z)*4.,0.,1.);
 vec3 irid=.5+.5*cos(6.2831*(vec3(0.,.33,.67)+fres*.85+p.x*.0028+uTime*.035));
 float pm=smoothstep(1.,-1.,dp);float dm=smoothstep(1.,-1.,dd)*smoothstep(1.,-2.,dp);
 float sh=smoothstep(9.,-9.,dropD(p-vec2(0.,5.)))*(1.-dm)*pm*(.11+.07*uDark);
 vec3 c=vec3(0.,.14,.36)*sh;float a=sh;
 float pa=clamp(pm*(fres*.5+spec*.9+spec2),0.,1.);
 c=mix(vec3(1.),irid,.5*fres)*pa+c*(1.-pa);a=pa+a*(1.-pa);
 float th=lens(dd,11.);
 float cs=caus((p+n.xy*th*18.)*.085,uTime*.9);
 vec3 tint=mix(vec3(.80,.95,1.),vec3(.55,.82,1.),uDark);
 float rim=dm*(1.-smoothstep(0.,8.,-dd));
 float cres=dm*smoothstep(.12,.55,dot(n.xy,normalize(vec2(.55,.85))))*smoothstep(0.,3.,-dd);
 float body=.5+.5*clamp(-n.y*3.,-1.,1.);
 float da=dm*(.26+.14*body)*(1.-.35*uDark);vec3 dc=mix(tint,vec3(1.),body*.6);
 float la=rim*.22;vec3 lc=mix(vec3(0.,.42,.78),vec3(.1,.55,.95),uDark);dc=lc*la+dc*da*(1.-la);da=la+da*(1.-la);
 la=clamp(cres*.7+smoothstep(.6,1.,cs)*.28*th*dm,0.,1.);dc=vec3(1.)*la+dc*(1.-la);da=la+da*(1.-la);
 la=clamp(dm*(spec*1.2+spec2*.5),0.,1.);dc=vec3(1.)*la+dc*(1.-la);da=la+da*(1.-la);
 la=dm*smoothstep(-2.,0.,dd)*.4;dc=mix(vec3(1.),irid,.35)*la+dc*(1.-la);da=la+da*(1.-la);
 c=dc+c*(1.-da);a=da+a*(1.-da);
 gl_FragColor=vec4(c,a);
}`

const uniforms = ['uRes', 'uDpr', 'uTime', 'uPill', 'uBlob', 'uSy', 'uRip', 'uMouse', 'uDark', 'uAmb'] as const

function initGL(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
  if (!gl) return null

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
    gl.deleteShader(shader)
    return null
  }

  const vertex = compile(gl.VERTEX_SHADER, VERT)
  const fragment = compile(gl.FRAGMENT_SHADER, FRAG)
  const program = gl.createProgram()
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
  }
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  gl.useProgram(program)
  const buffer = gl.createBuffer()
  if (!buffer) {
    gl.deleteProgram(program)
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const u = Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(program, name)])) as Record<(typeof uniforms)[number], WebGLUniformLocation | null>
  return { gl, u, dispose: () => { gl.deleteBuffer(buffer); gl.deleteProgram(program) } }
}

type Satellite = { x: number; y: number; vx: number; vy: number; r: number; k: number }
type Ripple = { x: number; y: number; age: number; amp: number }

export function createLiquidWater(nav: HTMLElement, canvas: HTMLCanvasElement, drop: HTMLSpanElement, onSettled: () => void) {
  const bodies = [{ x: 0, v: 0 }, { x: 0, v: 0 }]
  const target = { x: 0, cy: 0, q: 0, r: 21 }
  const mouse = { x: 0, y: 0, s: 0, on: false }
  const blobs = new Float32Array(24)
  const scales = new Float32Array(6).fill(1)
  const ripples = new Float32Array(24)
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let satellites: Satellite[] = []
  let waves: Ripple[] = []
  let gl: ReturnType<typeof initGL> = null
  let initialized = false
  let visible = true
  let ready = false
  let moving = false
  let split = false
  let active = 0
  let fromIndex: number | undefined
  let dark = 0
  let width = 0
  let height = 0
  let dpr = 1
  let q = 0
  let scale = 1
  let scaleVelocity = 0
  let lead = 0
  let lagFrom = 0
  let time = 0
  let last = 0
  let raf = 0

  function draw() {
    const head = bodies[lead]
    const tail = bodies[1 - lead]
    const separation = Math.abs(head.x - tail.x)
    const thin = Math.min(separation / (2 * (q + target.r)), 1)
    if (!gl) {
      const r = target.r * (1 - 0.3 * thin)
      drop.style.width = `${separation + 2 * (q + r)}px`
      drop.style.transform = `translateX(${Math.min(head.x, tail.x) - q - r - PAD}px) scaleY(${scale})`
      return
    }

    const { gl: g, u } = gl
    g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight)
    g.uniform2f(u.uRes, width + PAD * 2, height + PAD * 2)
    g.uniform1f(u.uDpr, dpr)
    g.uniform1f(u.uTime, time)
    g.uniform4f(u.uPill, PAD, PAD, width, height)
    blobs.fill(0)
    blobs.set([head.x, target.cy, q * (1 - 0.25 * thin), target.r * (1 - 0.12 * thin), tail.x, target.cy, q * (1 - 0.8 * thin), target.r * (1 - 0.5 * thin)])
    satellites.slice(0, 4).forEach((satellite, index) => blobs.set([satellite.x, satellite.y, 0, satellite.r], 8 + index * 4))
    scales[0] = scales[1] = scale
    g.uniform4fv(u.uBlob, blobs)
    g.uniform1fv(u.uSy, scales)
    ripples.fill(0)
    waves.slice(-6).forEach((wave, index) => ripples.set([wave.x, wave.y, wave.age, wave.amp], index * 4))
    g.uniform4fv(u.uRip, ripples)
    g.uniform3f(u.uMouse, mouse.x, mouse.y, mouse.s)
    g.uniform1f(u.uDark, dark)
    g.uniform1f(u.uAmb, motion.matches ? 0 : 1)
    g.clearColor(0, 0, 0, 0)
    g.clear(g.COLOR_BUFFER_BIT)
    g.drawArrays(g.TRIANGLES, 0, 3)
  }

  function reset(x: number) {
    for (const body of bodies) { body.x = x; body.v = 0 }
    scale = 1
    scaleVelocity = 0
    satellites = []
  }

  function step(dt: number, now: number) {
    time += dt
    q += (target.q - q) * Math.min(1, dt * 12)
    let still = true
    if (motion.matches) {
      reset(target.x)
    } else {
      bodies.forEach((body, index) => {
        const leading = index === lead
        const spring = leading ? 210 : 72
        const drag = leading ? 25 : 13
        const lag = !leading && now < lagFrom ? 0.08 : 1
        body.v += (spring * (target.x - body.x) - drag * body.v) * dt * lag
        body.x += body.v * dt
        const min = PAD + 6 + q + target.r - 3
        const max = PAD + width - 6 - q - target.r + 3
        if (body.x < min || body.x > max) {
          scaleVelocity -= Math.min(Math.abs(body.v), 900) * 0.0016
          body.x = Math.max(min, Math.min(max, body.x))
          body.v *= -0.25
        }
        if (Math.abs(target.x - body.x) > 0.3 || Math.abs(body.v) > 3) still = false
      })
      const head = bodies[lead]
      const tail = bodies[1 - lead]
      const nextScale = 1 - 0.2 * Math.min(Math.abs(head.v) / 1500, 1)
      scaleVelocity += (280 * (nextScale - scale) - 9 * scaleVelocity) * dt
      scale += scaleVelocity * dt
      if (Math.abs(scale - 1) > 0.002 || Math.abs(scaleVelocity) > 0.02) still = false

      const sep = Math.abs(head.x - tail.x)
      const r = target.r * (1 - 0.3 * Math.min(sep / (2 * (target.q + target.r)), 1))
      if (gl && !split && moving && sep - 2 * target.q - 2 * r > -6) {
        split = true
        satellites.push(...[0.3, 0.5, 0.72].map((fraction, index) => ({
          x: tail.x + (head.x - tail.x) * fraction + (Math.random() - 0.5) * 6,
          y: target.cy + (Math.random() - 0.5) * 10,
          vx: (tail.v + head.v) * 0.45,
          vy: (Math.random() - 0.5) * 60,
          r: 5 + Math.random() * 3 - index * 0.5,
          k: 70 + Math.random() * 90,
        })))
      }
      satellites = satellites.filter(satellite => {
        satellite.vx += (satellite.k * (target.x - satellite.x) - 9 * satellite.vx) * dt
        satellite.vy += (90 * (target.cy - satellite.y) - 7 * satellite.vy) * dt
        satellite.x += satellite.vx * dt
        satellite.y += satellite.vy * dt
        satellite.x = Math.max(PAD + 8 + satellite.r, Math.min(PAD + width - 8 - satellite.r, satellite.x))
        satellite.y = Math.max(target.cy - target.r + satellite.r, Math.min(target.cy + target.r - satellite.r, satellite.y))
        if (Math.abs(target.x - satellite.x) < target.q + target.r * 0.5) satellite.r -= dt * 26
        return satellite.r > 0.6
      })
      if (satellites.length) still = false
    }

    if (moving && still) {
      moving = false
      if (gl && !motion.matches) waves.push({ x: target.x, y: target.cy, age: 0, amp: split ? 1.2 : 0.7 })
      onSettled()
    }
    waves.forEach(wave => { wave.age += dt })
    waves = waves.filter(wave => wave.age < 2.4)
    mouse.s += ((mouse.on ? 1 : 0) - mouse.s) * Math.min(1, dt * 7)
  }

  function requestFrame() {
    if (raf || !ready || !visible || document.hidden) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now
    step(dt, now)
    draw()
    const animated = !motion.matches && Boolean(gl)
    raf = visible && !document.hidden && (animated || moving) ? requestAnimationFrame(tick) : 0
  }

  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
  }

  function initializeGraphics() {
    initialized = true
    try { gl = initGL(canvas) } catch { gl = null }
    nav.dataset.gl = gl ? 'on' : 'off'
  }

  function measure() {
    const items = nav.querySelectorAll<HTMLElement>(':scope > [data-liquid-nav-item]')
    const item = items[active]
    const nextWidth = nav.offsetWidth
    const nextHeight = nav.offsetHeight
    if (!item?.offsetHeight || !nextWidth || !nextHeight) {
      ready = false
      stop()
      return
    }
    if (!initialized) initializeGraphics()
    width = nextWidth
    height = nextHeight
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    const canvasWidth = Math.round((width + PAD * 2) * dpr)
    const canvasHeight = Math.round((height + PAD * 2) * dpr)
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth
      canvas.height = canvasHeight
    }

    const origin = items[fromIndex ?? -1]
    const nx = PAD + item.offsetLeft + item.offsetWidth / 2
    target.r = item.offsetHeight / 2
    target.q = Math.max(0, item.offsetWidth / 2 - target.r)
    target.cy = PAD + item.offsetTop + item.offsetHeight / 2
    if (!ready) {
      target.x = origin && !motion.matches ? PAD + origin.offsetLeft + origin.offsetWidth / 2 : nx
      q = Math.max(0, (origin && !motion.matches ? origin.offsetWidth : item.offsetWidth) / 2 - target.r)
      reset(target.x)
      moving = false
      ready = true
    }
    if (motion.matches) {
      reset(nx)
      q = target.q
      if (moving || fromIndex !== undefined) onSettled()
      moving = false
    } else if (Math.abs(nx - target.x) > 0.5) {
      lead = Math.abs(nx - bodies[0].x) <= Math.abs(nx - bodies[1].x) ? 0 : 1
      lagFrom = performance.now() + 70
      moving = true
      split = false
    }
    target.x = nx
    draw()
    requestFrame()
  }

  function ripple(clientX: number, clientY: number, amp: number) {
    if (!gl || motion.matches) return
    const box = nav.getBoundingClientRect()
    waves.push({ x: clientX - box.left + PAD, y: clientY - box.top + PAD, age: 0, amp })
    requestFrame()
  }

  const pointerDown = (event: PointerEvent) => ripple(event.clientX, event.clientY, 0.8)
  function pointerMove(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || motion.matches || !gl) return
    const box = nav.getBoundingClientRect()
    mouse.x = event.clientX - box.left + PAD
    mouse.y = event.clientY - box.top + PAD
    mouse.on = true
    requestFrame()
  }
  const pointerLeave = () => { mouse.on = false }
  function contextLost(event: Event) {
    event.preventDefault()
    gl = null
    nav.dataset.gl = 'off'
    draw()
  }
  function contextRestored() {
    initializeGraphics()
    draw()
    requestFrame()
  }
  function motionChanged() {
    waves = []
    mouse.on = false
    mouse.s = 0
    measure()
  }
  function visibilityChanged() {
    if (document.hidden) stop()
    else requestFrame()
  }

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) requestFrame()
    else stop()
  })
  const resize = new ResizeObserver(measure)
  intersection.observe(nav)
  resize.observe(nav)
  nav.addEventListener('pointerdown', pointerDown)
  nav.addEventListener('pointermove', pointerMove)
  nav.addEventListener('pointerleave', pointerLeave)
  canvas.addEventListener('webglcontextlost', contextLost)
  canvas.addEventListener('webglcontextrestored', contextRestored)
  motion.addEventListener('change', motionChanged)
  document.addEventListener('visibilitychange', visibilityChanged)

  return {
    select(next: number, previous: number | undefined, tone: 'light' | 'dark') {
      if (previous !== undefined && previous !== fromIndex) {
        ready = false
        waves = []
      }
      active = next
      fromIndex = previous
      dark = tone === 'dark' ? 1 : 0
      measure()
    },
    ripple,
    dispose() {
      stop()
      resize.disconnect()
      intersection.disconnect()
      nav.removeEventListener('pointerdown', pointerDown)
      nav.removeEventListener('pointermove', pointerMove)
      nav.removeEventListener('pointerleave', pointerLeave)
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      motion.removeEventListener('change', motionChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
      gl?.dispose()
      delete nav.dataset.gl
    },
  }
}
