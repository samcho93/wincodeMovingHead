// beam.js — light: ① projected spot (SpotLight + beam-section texture, shadows) ② beam in the air (ray-marched cone, haze) ③ lens glow and flare
import * as THREE from 'three';

const VERT = /* glsl */`
uniform float uR0, uTan, uLen;
varying vec3 vLocal; varying vec3 vView;
void main() {
  float r = (uR0 + position.y * uLen * uTan) * 1.08;
  vec3 p = vec3(position.x * r, position.y * uLen, position.z * r);
  vLocal = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
#include <packing>
uniform sampler2D uMap, tDepth;
uniform vec3 uCamLocal, uGain;
uniform vec2 uRes;
uniform mat4 uBeamWorld;
uniform float uR0, uTan, uLen, uHaze, uTime, uNear, uFar;
varying vec3 vLocal; varying vec3 vView;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 ro = uCamLocal, rd = normalize(vLocal - ro);
  float t0 = 0.0, t1 = length(vLocal - ro);
  // only up to whatever the scene occludes (fixture body, walls, floor)
  float d = texture2D(tDepth, gl_FragCoord.xy / uRes).x;
  float vz = perspectiveDepthToViewZ(d, uNear, uFar);
  t1 = min(t1, vz / normalize(vView).z);
  // interval where the ray crosses the cone (apex behind the lens at y = -R0/tan)
  float k2 = uTan * uTan;
  vec3 o = ro; o.y += uR0 / uTan;
  float a = rd.x * rd.x + rd.z * rd.z - k2 * rd.y * rd.y;
  float b = o.x * rd.x + o.z * rd.z - k2 * o.y * rd.y;
  float c = o.x * o.x + o.z * o.z - k2 * o.y * o.y;
  float disc = b * b - a * c;
  if (disc <= 0.0) { if (a > 0.0) discard; }
  else if (abs(a) > 1e-7) {
    float sq = sqrt(disc), ta = (-b - sq) / a, tb = (-b + sq) / a;
    if (ta > tb) { float s = ta; ta = tb; tb = s; }
    if (a > 0.0) { t0 = max(t0, ta); t1 = min(t1, tb); }
    else if (rd.y > 0.0) t0 = max(t0, tb); else t1 = min(t1, ta);
  }
  if (abs(rd.y) > 1e-5) {
    float ya = -ro.y / rd.y, yb = (uLen - ro.y) / rd.y;
    t0 = max(t0, min(ya, yb)); t1 = min(t1, max(ya, yb));
  } else if (ro.y < 0.0 || ro.y > uLen) discard;
  if (t1 <= t0) discard;

  const int N = 40;
  float dt = (t1 - t0) / float(N);
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));   // fixed dither: a per-frame offset made the beam shimmer
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
    float r = uR0 + p.y * uTan;
    vec2 uv = p.xz / r;
    if (dot(uv, uv) > 1.0) continue;
    vec3 tex = texture2D(uMap, uv * 0.5 + 0.5).rgb;
    vec3 pw = (uBeamWorld * vec4(p, 1.0)).xyz;
    float n = noise(pw * 1.6 + vec3(uTime * 0.11, -uTime * 0.05, uTime * 0.07)) * 0.65 + noise(pw * 5.0 - vec3(uTime * 0.2)) * 0.35;
    float fade = smoothstep(uLen, uLen * 0.8, p.y);
    float prof = 1.0 - 0.55 * dot(uv, uv);                       // the beam is brighter at its centre
    acc += tex * (uR0 * uR0) / (r * r) * (0.3 + 1.2 * n) * fade * prof;
  }
  // brighter when looking into the light (forward scattering)
  float phase = 0.55 + 1.6 * pow(max(0.0, -rd.y), 3.0) + 0.25 * pow(max(0.0, rd.y), 2.0);
  gl_FragColor = vec4(acc * dt * uHaze * phase * uGain, 1.0);
}`;

export class Beam {
  /** tilt: head group, canvas: BeamImage.out, DIM: { lensY, lensR } of the model body */
  // opts: { steps, shadow, project } — lighter settings for multi-head fixtures and crowded stages.
  //   shadow: shadow-map size (0 = this light casts no shadows) · project: false = no projected spot at all, only the
  //   beam in the air (every projected light costs texture units in every lit material, so their number is limited)
  constructor(tilt, canvas, DIM, opts = {}) {
    this.tilt = tilt;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.R0 = DIM.lensR * 0.92; this.len = 30;
    const y = DIM.lensY + 0.002;

    // ① projected light
    const L = this.light = new THREE.SpotLight(0xffffff, 0, 60, 0.1, 0, 2);
    L.position.set(0, y, 0); L.map = this.tex; L.castShadow = opts.shadow !== 0; this.project = opts.project !== false;
    L.shadow.mapSize.set(opts.shadow || 1024, opts.shadow || 1024); L.shadow.camera.near = 0.08; L.shadow.camera.far = 40; L.shadow.bias = -0.0004;
    L.target.position.set(0, y + 1, 0);
    if (this.project) tilt.add(L, L.target);
    // make the projected image turn with the head: shadow camera up = head local +Z
    const up = this.up = new THREE.Vector3(), q = new THREE.Quaternion();
    const orig = L.shadow.updateMatrices.bind(L.shadow);
    L.shadow.updateMatrices = function (light) { tilt.getWorldQuaternion(q); this.camera.up.copy(up.set(0, 0, 1).applyQuaternion(q)); orig(light); };

    // ② volumetric
    const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, false); geo.translate(0, 0.5, 0);
    this.uni = {
      uMap: { value: this.tex }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uCamLocal: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3() }, uBeamWorld: { value: new THREE.Matrix4() },
      uR0: { value: this.R0 }, uTan: { value: 0.05 }, uLen: { value: this.len }, uHaze: { value: 1 }, uTime: { value: 0 }, uNear: { value: 0.05 }, uFar: { value: 100 },
    };
    this.vol = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uni, vertexShader: VERT, fragmentShader: FRAG.replace('const int N = 40;', `const int N = ${opts.steps || 40};`), side: THREE.BackSide,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    this.vol.position.y = y; this.vol.frustumCulled = false; this.vol.renderOrder = 10; this.vol.userData.beam = true;
    tilt.add(this.vol);

    // ③ flare
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.flare.position.y = y + 0.012; this.flare.userData.beam = true; tilt.add(this.flare);
    this._v = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._w = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  setDepth(tex, w, h, cam) { this.uni.tDepth.value = tex; this.uni.uRes.value.set(w, h); this.uni.uNear.value = cam.near; this.uni.uFar.value = cam.far; }

  update(fx, camera, haze, time, lensMat) {
    const I = fx.intensity, tint = fx.tint, p = fx.o.prism, SPEC = fx.model.spec;
    const full = fx.beamAngleDeg, spread = 1 + p;                       // with the prism in, the three images spread and the overall angle widens
    const half = THREE.MathUtils.degToRad(full / 2) * spread + fx.o.frost * 0.035;
    const tan = Math.tan(half / 0.92);                                   // compensate for the texture margin (R = 0.92)
    // luminous intensity: power law following the manual's illuminance ratio (6° 22140 lx · 26° 1715 lx @ 5 m)
    //  (the real exponent is 1.744 — relaxed to 1.25 so wide zoom is not lost in the screen's narrow dynamic range)
    const cd = SPEC.cd * Math.pow(SPEC.zoomMin / full, 1.25) / (spread * spread) * (1 + 1.6 * p);
    const L = this.light;
    L.intensity = cd * I; L.angle = Math.min(1.2, Math.atan(tan)); L.visible = this.project && I > 0.0005;
    this.uni.uTan.value = tan; this.uni.uHaze.value = haze; this.uni.uTime.value = time;
    const k = 13 * (SPEC.cd / 1100) * (0.054 / this.R0 * 0.92) * I * Math.pow(SPEC.zoomMin / full, 0.2) * (1 + 0.8 * p);
    this.uni.uGain.value.set(k, k, k);
    this.vol.visible = I > 0.0005 && haze > 0.001;
    this.vol.updateWorldMatrix(true, false);
    this.uni.uBeamWorld.value.copy(this.vol.matrixWorld);
    this.uni.uCamLocal.value.copy(camera.position).applyMatrix4(this._m.copy(this.vol.matrixWorld).invert());
    // lens and flare
    if (lensMat) { lensMat.map = this.tex; lensMat.color.setScalar(I > 0 ? 0.6 + 7 * I : 0.02); }
    this.flare.getWorldPosition(this._w);
    this._d.set(0, 1, 0).transformDirection(this.vol.matrixWorld);
    const facing = Math.max(0, this._d.dot(this._v.copy(camera.position).sub(this._w).normalize()));
    const s = (0.1 + 1.5 * Math.pow(facing, 6)) * (this.R0 / 0.05) * Math.sqrt(I) * (0.6 + 0.4 * Math.sqrt(SPEC.zoomMin / full));
    this.flare.scale.setScalar(Math.max(0.0001, s)); this.flare.visible = I > 0.002;
    this.flare.material.color.setRGB(tint[0], tint[1], tint[2]).multiplyScalar(0.5 + 2.5 * I);
  }
}
