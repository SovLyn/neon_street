import * as THREE from 'three';
import type { RenderContext } from '../ctx';
import type { AppState } from '../state';
import type { BuildingDef, Layout, PropDef, SignDef, ThemePalette } from '../types';
import { ENV } from '../wasm/sim';
import type { SimBridge } from '../wasm/sim';

export interface SceneHandle {
  root: THREE.Group;
  cameraHome: { position: THREE.Vector3; target: THREE.Vector3 };
  waterMesh: THREE.Mesh | null;
  pickables: { signs: THREE.Object3D[]; lamps: THREE.Object3D[]; water: THREE.Object3D[] };
  rebuild(layout: Layout): void;
  setTheme(theme: ThemePalette): void;
  update(dt: number, state: AppState, sim: SimBridge): void;
  /** Highlight the object under the cursor; null clears it. */
  setHover(kind: 'sign' | 'lamp' | null, id: number): void;
  /** Paint visitor-supplied copy onto the landmark sign ('' restores the generated text). */
  setHeroText(text: string): void;
  dispose(): void;
}

type Recolor = (theme: ThemePalette) => void;
type SignVisual = { group: THREE.Group; face: THREE.Mesh; glow: THREE.MeshBasicMaterial; base: THREE.Vector3; colorIndex: number };
type LampVisual = { group: THREE.Group; glow: THREE.MeshStandardMaterial; cone: THREE.ShaderMaterial; pool: THREE.MeshBasicMaterial; colorIndex: number };
type SignalVisual = { lenses: THREE.MeshStandardMaterial[]; glows: THREE.SpriteMaterial[] };

const UP = new THREE.Vector3(0, 1, 0);
const skyVertex = `varying vec3 vWorld; void main(){ vWorld=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const skyFragment = `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform float day; varying vec3 vWorld;
void main(){ float h=normalize(vWorld).y*.5+.5; vec3 night=mix(bottom,horizon,smoothstep(.12,.58,h)); night=mix(night,top,smoothstep(.52,1.,h)); vec3 noon=mix(vec3(.25,.45,.68),vec3(.035,.07,.14),pow(1.-h,1.5)); gl_FragColor=vec4(mix(night,noon,day),1.); }`;
const waterVertex = `varying vec2 vUv; varying vec4 vReflect; varying vec3 vWorld; uniform mat4 textureMatrix;
void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.); vWorld=wp.xyz; vReflect=textureMatrix*wp; gl_Position=projectionMatrix*viewMatrix*wp; }`;
const waterFragment = `uniform sampler2D reflectionMap; uniform sampler2D ripples; uniform vec3 deep; uniform vec3 tint; uniform float time; uniform float wet;
varying vec2 vUv; varying vec4 vReflect; varying vec3 vWorld;
void main(){
  vec2 texel=vec2(1./64.,1./64.);
  float hx=texture2D(ripples,vUv+vec2(texel.x,0.)).r-texture2D(ripples,vUv-vec2(texel.x,0.)).r;
  float hz=texture2D(ripples,vUv+vec2(0.,texel.y)).r-texture2D(ripples,vUv-vec2(0.,texel.y)).r;
  vec2 wave=vec2(sin(vUv.y*54.+time*1.8),cos(vUv.x*47.-time*1.45))*.0022;
  vec2 distort=vec2(hx,hz)*.16+wave;
  vec2 uvR=clamp(vReflect.xy/max(vReflect.w,.001)+distort,.002,.998);
  vec3 refl=texture2D(reflectionMap,uvR).rgb;
  vec3 V=normalize(cameraPosition-vWorld);
  float grazing=pow(1.-clamp(V.y,0.,1.),2.6);
  float fres=mix(.14,1.0,grazing);
  vec3 reflTinted=refl*(tint*2.0+1.05);
  vec3 c=mix(deep,reflTinted,fres);
  float sparkle=pow(max(0.,sin(vUv.x*220.+time*2.3)*cos(vUv.y*180.-time*1.7)),26.);
  c+=tint*sparkle*(.22+wet*.5);
  c+=tint*.055;
  gl_FragColor=vec4(c,.97);
}`;

const coneVertex = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
// A hard cone silhouette reads as a tent; fade it at the ground and at the rim.
const coneFragment = `uniform vec3 color; uniform float strength; varying vec2 vUv;
void main(){
  float vertical = pow(clamp(vUv.y, 0.0, 1.0), 1.4);
  float rim = smoothstep(0.0, 0.30, vUv.x) * smoothstep(1.0, 0.70, vUv.x);
  float a = strength * vertical * (0.25 + 0.75 * rim);
  if (a < 0.002) discard;
  gl_FragColor = vec4(color, a);
}`;
const smearVertex = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const smearFragment = `uniform sampler2D map; uniform float opacity; uniform float time; varying vec2 vUv;
void main(){
  // Stretch a thin band of the sign downwards so it reads as a neon bleed in the asphalt.
  float wobble = sin(vUv.y * 26.0 + time * 1.7) * 0.006 + sin(vUv.y * 9.0 - time * 0.9) * 0.010;
  vec2 uv = vec2(vUv.x + wobble, 0.52 + (0.5 - vUv.y) * 0.42);
  vec4 tex = texture2D(map, uv);
  float near = smoothstep(0.0, 0.10, vUv.y);
  float fade = pow(1.0 - vUv.y, 1.7) * near;
  float a = tex.a * fade * opacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(tex.rgb, a);
}`;
const wetVertex = `varying vec4 vReflect; varying vec3 vWorld; varying vec2 vUv; uniform mat4 textureMatrix;
void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.); vWorld=wp.xyz; vReflect=textureMatrix*wp; gl_Position=projectionMatrix*viewMatrix*wp; }`;
const wetFragment = `uniform sampler2D reflectionMap; uniform vec3 tint; uniform float wet; uniform float time;
varying vec4 vReflect; varying vec3 vWorld; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p,vec2(41.7,289.3)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y); }
void main(){
  float n=noise(vWorld.xz*.28)*.6+noise(vWorld.xz*.9)*.4;
  float puddle=smoothstep(.46,.72,n);
  vec3 V=normalize(cameraPosition-vWorld);
  float grazing=pow(1.-clamp(V.y,0.,1.),3.2);
  vec2 ripple=vec2(sin(vWorld.z*1.6+time*.8),cos(vWorld.x*1.5-time*.7))*.0016;
  vec2 uvR=clamp(vReflect.xy/max(vReflect.w,.001)+ripple,.002,.998);
  vec3 refl=texture2D(reflectionMap,uvR).rgb;
  vec3 c=refl*(tint*1.5+.75);
  float a=puddle*(.10+grazing*.62)*wet;
  gl_FragColor=vec4(c,a);
}`;

/** Static, low-poly city block. Dynamic simulation data only changes uniforms/materials. */
export function createScene(ctx: RenderContext): SceneHandle {
  const root = new THREE.Group();
  root.name = 'neon-street-world';
  const pickables = { signs: [] as THREE.Object3D[], lamps: [] as THREE.Object3D[], water: [] as THREE.Object3D[] };
  const recolors: Recolor[] = [];
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const signs: SignVisual[] = [];
  const tints: { mat: THREE.MeshStandardMaterial; night: THREE.Color; day: THREE.Color }[] = [];
  const WHITE = new THREE.Color('#ffffff');
  const addTint = (mat: THREE.MeshStandardMaterial, night: THREE.Color, day: THREE.Color): { mat: THREE.MeshStandardMaterial; night: THREE.Color; day: THREE.Color } => {
    const entry = { mat, night: night.clone(), day: day.clone() };
    tints.push(entry);
    return entry;
  };
  const lamps: LampVisual[] = [];
  const signals: SignalVisual[] = [];
  // Cheap neon "smears" on the wet road: one additive quad per facade sign,
  // reusing the sign texture instead of paying for a second reflection pass.
  const smears: { material: THREE.ShaderMaterial; base: number }[] = [];
  let hoverKind: 'sign' | 'lamp' | null = null;
  let hoverId = -1;
  let heroOverride = '';
  const heroVisuals: { def: SignDef; visual: SignVisual; neon: string; texture: THREE.Texture; score: number }[] = [];
  let theme = ctx.theme;
  let layout = ctx.layout;
  let waterMesh: THREE.Mesh | null = null;
  let waterTexture: THREE.DataTexture | null = null;
  let waterUniforms: { time: { value: number }; wet: { value: number }; deep: { value: THREE.Color }; tint: { value: THREE.Color } } | null = null;
  let wetUniformsRef: { wet: { value: number }; time: { value: number } } | null = null;
  let skyUniforms: { top: { value: THREE.Color }; horizon: { value: THREE.Color }; bottom: { value: THREE.Color }; day: { value: number } } | null = null;
  let skyStars: THREE.Points | null = null;
  let moonMaterial: THREE.SpriteMaterial | null = null;
  let key: THREE.DirectionalLight | null = null;
  let hemi: THREE.HemisphereLight | null = null;
  let ambient: THREE.AmbientLight | null = null;
  const tmpColor = new THREE.Color();
  // Street-level, a few metres off the east quay: the intersection fills the frame and the
  // canal stays a foreground edge instead of dominating the shot. Keep in sync with
  // HERO_CAMERA / HERO_TARGET in src/core/layout.rs.
  const cameraHome = { position: new THREE.Vector3(24, 7, 26), target: new THREE.Vector3(-6, 6, -10) };

  const ownMaterial = <T extends THREE.Material>(material: T): T => { materials.add(material); return material; };
  const ownTexture = <T extends THREE.Texture>(texture: T): T => { textures.add(texture); return texture; };
  const color = (hex: string): THREE.Color => new THREE.Color(hex);
  const standard = (hex: string, roughness = .78, metalness = .05): THREE.MeshStandardMaterial => ownMaterial(new THREE.MeshStandardMaterial({ color: hex, roughness, metalness }));
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); root.add(m); return m;
  };
  const addRecolor = (fn: Recolor): void => { recolors.push(fn); fn(theme); };

  function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D is unavailable');
    draw(g, width, height);
    const texture = ownTexture(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  function buildGround(): void {
    const asphalt = standard(theme.asphalt, .69, .18);
    const asphaltTint = addTint(asphalt, new THREE.Color(theme.asphalt), new THREE.Color(theme.asphalt).lerp(WHITE, .22));
    const sidewalk = standard(theme.sidewalk, .86, .04);
    const sidewalkTint = addTint(sidewalk, new THREE.Color(theme.sidewalk), new THREE.Color(theme.sidewalk).lerp(WHITE, .32));
    asphalt.emissive.set(theme.ground); asphalt.emissiveIntensity = .08;
    sidewalk.emissive.set(theme.ground); sidewalk.emissiveIntensity = .05;
    const curb = standard(theme.buildingTrim, .65, .08);
    const paint = ownMaterial(new THREE.MeshStandardMaterial({ color: '#d7d1c2', roughness: .55, metalness: .1, emissive: '#423e37', emissiveIntensity: .15 }));
    const wet = ownMaterial(new THREE.MeshBasicMaterial({ color: theme.accent2, transparent: true, opacity: .035, blending: THREE.AdditiveBlending, depthWrite: false }));
    addRecolor((p) => { asphaltTint.night.set(p.asphalt); asphaltTint.day.copy(asphaltTint.night).lerp(WHITE, .14); asphalt.color.copy(asphaltTint.night); asphalt.emissive.set(p.ground); sidewalkTint.night.set(p.sidewalk); sidewalkTint.day.copy(sidewalkTint.night).lerp(WHITE, .24); sidewalk.color.copy(sidewalkTint.night); sidewalk.emissive.set(p.ground); curb.color.set(p.buildingTrim); wet.color.set(p.accent2); });
    // Main road and crossing road, leaving their overlap intentionally shared for a broad intersection.
    box(20, .08, 144, asphalt, 0, -.04, 0);
    box(144, .081, 16, asphalt, 0, -.039, 0);
    for (const s of layout.sidewalks) {
      box(s.w, s.h, s.d, sidewalk, s.x, s.h / 2, s.z);
      const edgeX = Math.sign(s.x || 1) * (Math.abs(s.x) - s.w / 2 + .12);
      box(.23, .27, s.d, curb, edgeX, .135, s.z);
    }
    // Worn lane stripes; the centre is kept clear around the intersection.
    const dash = new THREE.BoxGeometry(.18, .018, 4.2);
    for (const x of [-5, 0, 5]) for (const z of [-62, -54, -46, -38, -30, 30, 38, 46, 54, 62]) {
      const m = new THREE.Mesh(dash, paint); m.position.set(x, .012, z); root.add(m);
    }
    const dashX = new THREE.BoxGeometry(4.2, .018, .18);
    for (const z of [-4, 0, 4]) for (const x of [-62, -54, -46, -38, -30, 30, 38, 46, 54, 62]) {
      const m = new THREE.Mesh(dashX, paint); m.position.set(x, .012, z); root.add(m);
    }
    for (const cross of layout.crosswalks) {
      const vertical = cross.axis === 'ns';
      const count = vertical ? Math.max(5, Math.floor(cross.w / 1.65)) : Math.max(5, Math.floor(cross.d / 1.35));
      for (let i = 0; i < count; i++) {
        const a = (i + .5) / count - .5;
        const m = new THREE.Mesh(new THREE.BoxGeometry(vertical ? .85 : cross.w, .025, vertical ? cross.d : .72), paint);
        m.position.set(cross.x + (vertical ? a * cross.w : 0), .016, cross.z + (vertical ? 0 : a * cross.d)); root.add(m);
      }
    }
    // stop bars and a few deliberately irregular glossy rain patches
    for (const [x, z, w, d] of [[0, -12, 18, .45], [0, 12, 18, .45], [-12, 0, .45, 14], [12, 0, .45, 14]]) box(w, .012, d, paint, x, .015, z);
    for (const [x, z, sx, sz] of [[-7, 31, 5, 13], [7, -37, 4, 10], [-33, 7, 12, 3], [33, -6, 15, 3]]) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 18), wet); puddle.rotation.x = -Math.PI / 2; puddle.scale.set(sx, sz, 1); puddle.position.set(x, .025, z); root.add(puddle);
    }
    const wetUniforms = { reflectionMap: { value: ctx.reflection.texture }, textureMatrix: { value: ctx.reflection.textureMatrix }, tint: { value: color(theme.water) }, wet: { value: .4 }, time: { value: 0 } };
    const wetMat = ownMaterial(new THREE.ShaderMaterial({ uniforms: wetUniforms, vertexShader: wetVertex, fragmentShader: wetFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    for (const [w, d, x, z] of [[20, 144, 0, 0], [144, 16, 0, 0]] as const) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, d), wetMat);
      sheet.rotation.x = -Math.PI / 2; sheet.position.set(x, .028, z); sheet.layers.set(1); sheet.renderOrder = 1;
      root.add(sheet);
    }
    wetUniformsRef = wetUniforms;
    addRecolor((p) => wetUniforms.tint.value.set(p.water));

    const iron = standard('#151820', .42, .82);
    for (const [x, z] of [[-9, 20], [9, -27], [-25, -9], [31, 9]]) {
      const manhole = new THREE.Mesh(new THREE.CylinderGeometry(.72, .72, .025, 16), iron); manhole.position.set(x, .025, z); root.add(manhole);
    }
  }

  function makeFacadeTextures(building: BuildingDef): { albedo: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
    const seed = building.windows.seed;
    const cols = Math.max(3, Math.min(14, Math.floor(building.w / 1.55)));
    const rows = Math.max(5, Math.min(26, Math.floor(building.h / 1.9)));
    const rand = (n: number): number => {
      const v = Math.sin((seed + n * 31.17) * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    const lit: boolean[] = [];
    const warm: boolean[] = [];
    const shade: number[] = [];
    for (let i = 0; i < cols * rows; i += 1) {
      lit.push(rand(i) < 0.5);
      warm.push(rand(1000 + i) > 0.36);
      shade.push(0.18 + rand(2000 + i) * 0.62);
    }
    const shops = 3 + Math.floor(building.id % 3);
    const shopWarm: boolean[] = [];
    const shopShade: number[] = [];
    for (let i = 0; i < shops; i += 1) {
      shopWarm.push((i + building.id) % 2 === 0);
      shopShade.push(0.5 + rand(4000 + i) * 0.5);
    }
    const padX = 0.26;
    const padY = 0.3;

    // Albedo: concrete façade, dark glass panes. No light is baked in.
    const albedo = canvasTexture(256, 512, (g, w, h) => {
      g.fillStyle = '#7c7a88'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,.18)';
      for (let i = 0; i < 26; i += 1) g.fillRect(0, (i / 26) * h, w, 1.5);
      const cw = w / cols; const ch = h / rows;
      for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
        g.fillStyle = '#101218';
        g.fillRect(x * cw + cw * padX, y * ch + ch * padY, cw * (1 - padX * 2), ch * (1 - padY * 2));
      }
      g.fillStyle = 'rgba(0,0,0,.30)';
      for (let x = 0; x <= cols; x += 1) g.fillRect(x * cw - 1, 0, 2, h);
      const baseY = h * 0.855;
      g.fillStyle = '#0e0e13'; g.fillRect(0, baseY, w, h - baseY);
      for (let i = 0; i < shops; i += 1) {
        const sx = (i + 0.06) * (w / shops); const sw = (w / shops) * 0.88;
        g.fillStyle = '#1a1a22';
        g.fillRect(sx, baseY + 5, sw, (h - baseY) * 0.52);
      }
    });

    // Emissive: only the lit panes, storefronts and window highlights.
    const emissive = canvasTexture(256, 512, (g, w, h) => {
      g.fillStyle = '#000000'; g.fillRect(0, 0, w, h);
      const cw = w / cols; const ch = h / rows;
      for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
        const i = x + y * cols;
        if (!lit[i]) continue;
        const b = shade[i];
        g.fillStyle = warm[i]
          ? `rgb(${Math.round(240 * b + 15)},${Math.round(198 * b + 20)},${Math.round(128 * b + 16)})`
          : `rgb(${Math.round(140 * b + 14)},${Math.round(206 * b + 24)},${Math.round(240 * b + 15)})`;
        g.fillRect(x * cw + cw * padX, y * ch + ch * padY, cw * (1 - padX * 2), ch * (1 - padY * 2));
        g.fillStyle = 'rgba(255,255,255,.16)';
        g.fillRect(x * cw + cw * padX, y * ch + ch * padY, cw * (1 - padX * 2), ch * 0.12);
      }
      const baseY = h * 0.855;
      for (let i = 0; i < shops; i += 1) {
        const sx = (i + 0.06) * (w / shops); const sw = (w / shops) * 0.88;
        const sh = shopShade[i];
        g.fillStyle = shopWarm[i]
          ? `rgb(${Math.round(255 * sh)},${Math.round(186 * sh)},${Math.round(96 * sh)})`
          : `rgb(${Math.round(120 * sh)},${Math.round(228 * sh)},${Math.round(255 * sh)})`;
        g.fillRect(sx, baseY + 5, sw, (h - baseY) * 0.52);
        g.fillStyle = '#000000';
        g.fillRect(sx + sw * 0.45, baseY + 5, sw * 0.1, (h - baseY) * 0.52);
      }
    });

    return { albedo, emissive };
  }

  function addFacadeWindows(b: BuildingDef, body: THREE.Group): void {
    const { albedo, emissive } = makeFacadeTextures(b);
    const mat = ownMaterial(new THREE.MeshStandardMaterial({
      map: albedo,
      emissiveMap: emissive,
      emissive: '#ffffff',
      emissiveIntensity: 0,
      roughness: .72,
      metalness: .06,
    }));
    const facadeTint = addTint(
      mat,
      new THREE.Color(theme.buildingBase).multiplyScalar(1.35),
      new THREE.Color(theme.buildingBase).lerp(WHITE, .46),
    );
    // Material's emissive intensity is updated per frame rather than allocating a closure.
    const make = (w: number, h: number, px: number, pz: number, yaw: number): void => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * .94, h * .94), mat);
      mesh.position.set(px, b.h * .5, pz);
      mesh.rotation.y = yaw;
      body.add(mesh);
      mesh.userData.windowMaterial = mat;
      mesh.userData.windowBias = b.windows.lit;
    };
    make(b.w, b.h, 0, b.d / 2 + .012, 0);
    make(b.w, b.h, 0, -b.d / 2 - .012, Math.PI);
    make(b.d, b.h, b.w / 2 + .012, 0, Math.PI / 2);
    make(b.d, b.h, -b.w / 2 - .012, 0, -Math.PI / 2);
    addRecolor((p) => {
      mat.emissive.set('#ffffff');
      facadeTint.night.copy(new THREE.Color(p.buildingBase)).multiplyScalar(1.35);
      facadeTint.day.copy(new THREE.Color(p.buildingBase)).lerp(WHITE, .46);
    });
  }

  function buildBuildings(): void {
    for (const b of layout.buildings) {
      const body = new THREE.Group(); body.position.set(b.x, .22, b.z); body.rotation.y = b.rotY; root.add(body);
      const shade = new THREE.Color(theme.buildingBase).offsetHSL((b.colorIndex % 3 - 1) * .018, 0, (b.colorIndex % 3 - 1) * .025);
      const shell = standard(shade.getStyle(), .75, .08);
      const shellTint = addTint(shell, shell.color.clone(), shell.color.clone().lerp(WHITE, .40));
      addRecolor((p) => {
        shellTint.night.copy(tmpColor.set(p.buildingBase).offsetHSL((b.colorIndex % 3 - 1) * .018, 0, (b.colorIndex % 3 - 1) * .025));
        shellTint.day.copy(shellTint.night).lerp(WHITE, .40);
        shell.color.copy(shellTint.night);
      });
      const building = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), shell); building.position.y = b.h / 2; body.add(building);
      addFacadeWindows(b, body);
      const trim = standard(theme.buildingTrim, .56, .24);
      addRecolor((p) => trim.color.set(p.buildingTrim));
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(b.w + .45, .72, b.d + .45), trim); parapet.position.y = b.h + .2; body.add(parapet);
      // Silhouette-breaking rooftop equipment.
      const ac = new THREE.Mesh(new THREE.BoxGeometry(Math.min(3.2, b.w * .3), .9, 1.25), trim); ac.position.set(-b.w * .18, b.h + .82, b.d * .1); body.add(ac);
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(.3, .38, 1.3, 8), trim); vent.position.set(b.w * .2, b.h + .9, -b.d * .2); body.add(vent);
      if (b.h > 22) {
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.035, .055, 3.5 + (b.id % 4), 6), trim); antenna.position.set(b.w * .22, b.h + 2.2, b.d * .17); body.add(antenna);
      }
      if (b.id % 3 === 0) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.65, 10), trim); tank.position.set(-b.w * .22, b.h + 1.35, -b.d * .15); body.add(tank);
      }
      if (b.id % 2) {
        const balcony = new THREE.Mesh(new THREE.BoxGeometry(b.w * .45, .18, .85), trim); balcony.position.set(0, b.h * .53, b.d / 2 + .36); body.add(balcony);
      }
    }
  }

  function signTexture(def: SignDef, neon: string, override = ''): THREE.CanvasTexture {
    const text = override || def.text;
    // Hero signs are several times wider on screen than the rest, so they pay for pixels.
    const hero = def.hero === true;
    return canvasTexture(hero ? 1024 : 512, hero ? 384 : 192, (g, w, h) => {
      const vertical = def.kind === 'vertical';
      g.fillStyle = '#05050a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = neon; g.lineWidth = hero ? 11 : 6; g.strokeRect(8, 8, w - 16, h - 16);
      const font = def.font === 'serif' ? 'serif' : def.font === 'mono' ? 'monospace' : def.font === 'display' ? 'Impact, sans-serif' : 'Arial, "Microsoft YaHei", sans-serif';
      const label = vertical ? Array.from(text).join('\n') : text;
      const size = vertical
        ? Math.min(hero ? 150 : 80, (h - 18) / Math.max(1, Array.from(text).length))
        : hero
          ? Math.min(h * .58, (w - 56) / Math.max(1, Array.from(text).length * 1.03))
          : Math.min(76, (w - 28) / Math.max(1, text.length * .67));
      g.font = `bold ${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = neon; g.shadowBlur = hero ? 44 : 28; g.fillStyle = neon;
      if (vertical) Array.from(text).forEach((ch, i, list) => g.fillText(ch, w / 2, (i + .5) * h / list.length)); else g.fillText(label, w / 2, h / 2 + 3);
      g.shadowBlur = 0; g.strokeStyle = '#fff7fc'; g.lineWidth = 1.1;
      if (vertical) Array.from(text).forEach((ch, i, list) => g.strokeText(ch, w / 2, (i + .5) * h / list.length)); else g.strokeText(label, w / 2, h / 2 + 3);
    });
  }

  function buildSigns(): void {
    for (const def of layout.signs) {
      const group = new THREE.Group(); group.position.set(def.x, def.y, def.z); group.rotation.y = def.rotY; group.userData.signId = def.id; root.add(group);
      const neon = theme.neon[def.colorIndex % 4]; const tex = signTexture(def, neon, def.hero ? heroOverride : '');
      const backing = new THREE.Mesh(new THREE.BoxGeometry(def.w + .2, def.h + .2, .14), standard('#090811', .4, .55)); backing.position.z = -.075; group.add(backing);
      const mat = ownMaterial(new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, color: '#ffffff' }));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.h), mat); face.position.z = .01; face.userData.signId = def.id; group.add(face);
      const glow = ownMaterial(new THREE.MeshBasicMaterial({ color: neon, transparent: true, opacity: .26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(def.w * (def.hero ? 1.06 : 1.3), def.h * (def.hero ? 1.26 : 1.3)), glow); halo.position.z = -.10; group.add(halo);
      // Two thin brackets make a facade sign feel physically attached.
      const bracket = standard(theme.buildingTrim, .45, .72);
      addRecolor((p) => bracket.color.set(p.buildingTrim));
      for (const sx of [-.34, .34]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(.09, .09, .75), bracket); arm.position.set(def.w * sx, 0, -.4); group.add(arm); }
      if (def.kind === 'rooftop') {
        for (const sx of [-.35, .35]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.11, 1.6, .11), bracket); leg.position.set(def.w * sx, -def.h / 2 - .75, -.12); group.add(leg); }
      }
      if (def.kind === 'blade') { const pole = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, 1.15), bracket); pole.position.set(-def.w / 2 - .1, 0, -.54); group.add(pole); }
      addRecolor((p) => { glow.color.set(p.neon[def.colorIndex % 4]); mat.color.set('#ffffff'); });
      signs[def.id] = { group, face, glow, base: group.position.clone(), colorIndex: def.colorIndex };
      pickables.signs.push(group);
      if (def.hero) {
        // Longest apparent width from the default camera: that is the sign a visitor reads first.
        const distance = Math.hypot(def.x - cameraHome.position.x, def.z - cameraHome.position.z);
        heroVisuals.push({ def, visual: signs[def.id], neon, texture: tex, score: def.w / Math.max(8, distance) });
      }
      if (def.kind !== 'rooftop' && def.y < 22) {
        // A rooftop sign's smear would land inside its own building, so only facade signs get one.
        const length = THREE.MathUtils.clamp(def.w * .85, 3.5, 11);
        const geometry = new THREE.PlaneGeometry(def.w * 1.06, length);
        geometry.translate(0, -length / 2, 0);
        geometry.rotateX(-Math.PI / 2);
        const material = ownMaterial(new THREE.ShaderMaterial({
          uniforms: { map: { value: tex }, opacity: { value: 0 }, time: { value: 0 } },
          vertexShader: smearVertex,
          fragmentShader: smearFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }));
        const smear = new THREE.Mesh(geometry, material);
        const normal = new THREE.Vector3(Math.sin(def.rotY), 0, Math.cos(def.rotY));
        smear.position.set(def.x + normal.x * 0.5, 0.30, def.z + normal.z * 0.5);
        smear.rotation.y = def.rotY;
        smear.renderOrder = 2;
        root.add(smear);
        smears.push({ material, base: .95 });
      }
    }
  }

  function buildLamps(): void {
    const poleMat = standard(theme.buildingTrim, .3, .82); addRecolor((p) => poleMat.color.set(p.buildingTrim));
    for (const l of layout.lamps) {
      const group = new THREE.Group(); group.position.set(l.x, .22, l.z); group.userData.lampId = l.id; root.add(group);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.075, .11, l.h, 8), poleMat); pole.position.y = l.h / 2; group.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .95), poleMat); arm.position.set(Math.sin(l.armYaw) * .42, l.h - .22, Math.cos(l.armYaw) * .42); arm.rotation.y = l.armYaw; group.add(arm);
      const glow = ownMaterial(new THREE.MeshStandardMaterial({ color: '#22202b', emissive: theme.neon[l.id % 4], emissiveIntensity: 2.5, roughness: .25 }));
      const head = new THREE.Mesh(new THREE.SphereGeometry(.24, 10, 8), glow); head.position.set(Math.sin(l.armYaw) * .86, l.h - .27, Math.cos(l.armYaw) * .86); group.add(head);
      const cone = ownMaterial(new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(theme.neon[l.id % 4]) }, strength: { value: 0 } },
        vertexShader: coneVertex,
        fragmentShader: coneFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }));
      const coneMesh = new THREE.Mesh(new THREE.ConeGeometry(0.95, l.h * .5, 16, 1, true), cone); coneMesh.position.set(Math.sin(l.armYaw) * .86, l.h * .47, Math.cos(l.armYaw) * .86); group.add(coneMesh);
      const pool = ownMaterial(new THREE.MeshBasicMaterial({ color: theme.neon[l.id % 4], transparent: true, opacity: .12, blending: THREE.AdditiveBlending, depthWrite: false }));
      const poolMesh = new THREE.Mesh(new THREE.CircleGeometry(1.55, 20), pool); poolMesh.rotation.x = -Math.PI / 2; poolMesh.position.set(Math.sin(l.armYaw) * .86, .035, Math.cos(l.armYaw) * .86); poolMesh.scale.set(1, .65, 1); group.add(poolMesh);
      addRecolor((p) => { const c = p.neon[l.id % 4]; glow.emissive.set(c); cone.uniforms.color.value.set(c); pool.color.set(c); });
      lamps[l.id] = { group, glow, cone, pool, colorIndex: l.id % 4 }; pickables.lamps.push(group);
    }
  }

  function buildSignals(): void {
    const black = standard('#111218', .35, .7);
    for (const def of layout.signals) {
      const group = new THREE.Group(); group.position.set(def.x, .22, def.z); group.rotation.y = def.rotY; root.add(group);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, def.forPedestrian ? 3 : 4.6, 8), black); pole.position.y = (def.forPedestrian ? 3 : 4.6) / 2; group.add(pole);
      const body = new THREE.Mesh(new THREE.BoxGeometry(def.forPedestrian ? .48 : .62, def.forPedestrian ? .78 : 1.45, .38), black); body.position.set(0, def.forPedestrian ? 2.75 : 4.1, .1); group.add(body);
      const lensMats: THREE.MeshStandardMaterial[] = []; const glowMats: THREE.SpriteMaterial[] = [];
      const colors = ['#ff304f', '#ffb52e', '#42ff88'];
      for (let i = 0; i < 3; i++) {
        const lm = ownMaterial(new THREE.MeshStandardMaterial({ color: '#1d2025', emissive: colors[i], emissiveIntensity: 0, roughness: .2 })); lensMats.push(lm);
        const lens = new THREE.Mesh(new THREE.SphereGeometry(def.forPedestrian ? .1 : .13, 10, 8), lm); lens.position.set(0, (def.forPedestrian ? 2.98 : 4.55) - i * (def.forPedestrian ? .22 : .38), .32); group.add(lens);
        const sm = ownMaterial(new THREE.SpriteMaterial({ color: colors[i], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); glowMats.push(sm);
        const sprite = new THREE.Sprite(sm); sprite.scale.set(.75, .75, 1); sprite.position.copy(lens.position); sprite.position.z += .025; group.add(sprite);
      }
      signals[def.id] = { lenses: lensMats, glows: glowMats };
    }
  }

  function buildWater(): void {
    const w = layout.water; const width = w.x1 - w.x0; const depth = w.z1 - w.z0;
    waterTexture = ownTexture(new THREE.DataTexture(new Uint8Array(w.cols * w.rows), w.cols, w.rows, THREE.RedFormat));
    waterTexture.needsUpdate = true; waterTexture.minFilter = THREE.LinearFilter; waterTexture.magFilter = THREE.LinearFilter;
    waterUniforms = { time: { value: 0 }, wet: { value: 0 }, deep: { value: color(theme.waterDeep) }, tint: { value: color(theme.water) } };
    const mat = ownMaterial(new THREE.ShaderMaterial({ uniforms: { reflectionMap: { value: ctx.reflection.texture }, textureMatrix: { value: ctx.reflection.textureMatrix }, ripples: { value: waterTexture }, deep: waterUniforms.deep, tint: waterUniforms.tint, time: waterUniforms.time, wet: waterUniforms.wet }, vertexShader: waterVertex, fragmentShader: waterFragment, transparent: true, depthWrite: false }));
    waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 1, 1), mat); waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.set((w.x0 + w.x1) / 2, w.level, (w.z0 + w.z1) / 2); waterMesh.layers.set(1); root.add(waterMesh); pickables.water.push(waterMesh);
    const quay = standard(theme.buildingTrim, .6, .25); addRecolor((p) => quay.color.set(p.buildingTrim));
    for (const q of layout.quays) box(q.w, q.h, q.d, quay, q.x, w.level + q.h / 2, q.z);
    const foam = ownMaterial(new THREE.MeshBasicMaterial({ color: theme.neon[1], transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false })); addRecolor((p) => foam.color.set(p.neon[1]));
    for (const [x, z, sx, sz] of [[w.x0 + .22, (w.z0 + w.z1) / 2, .16, depth], [w.x1 - .22, (w.z0 + w.z1) / 2, .16, depth], [(w.x0 + w.x1) / 2, w.z0 + .22, width, .16], [(w.x0 + w.x1) / 2, w.z1 - .22, width, .16]]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), foam); line.rotation.x = -Math.PI / 2; line.position.set(x, w.level + .025, z); root.add(line);
    }
    const bollardMat = standard('#1d232d', .35, .85);
    for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(.18, .23, .65, 10), bollardMat); b.position.set(w.x0 - .65, w.level + .33, w.z0 + 4 + i * 5.5); root.add(b); }
  }

  function buildProps(): void {
    const propMat = standard(theme.buildingTrim, .55, .38); addRecolor((p) => propMat.color.set(p.buildingTrim));
    for (const p of layout.props) addProp(p, propMat);
  }
  function addProp(p: PropDef, mat: THREE.MeshStandardMaterial): void {
    const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); g.rotation.y = p.rotY; g.scale.setScalar(p.s); root.add(g);
    const neonMat = ownMaterial(new THREE.MeshStandardMaterial({ color: '#17151f', emissive: theme.neon[p.colorIndex % 4], emissiveIntensity: p.kind === 'neonStrip' ? 3 : .3, roughness: .45 })); addRecolor((t) => neonMat.emissive.set(t.neon[p.colorIndex % 4]));
    if (p.kind === 'boat') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3.8, .55, 1.35), mat); hull.position.y = .08; g.add(hull);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, .68, 1.05), propMatFor(g, mat)); cabin.position.set(-.25, .55, 0); g.add(cabin);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), neonMat); lantern.position.set(.95, .82, 0); g.add(lantern);
    } else if (p.kind === 'vending') { const m = new THREE.Mesh(new THREE.BoxGeometry(.85, 1.65, .48), neonMat); m.position.y = .82; g.add(m); }
    else if (p.kind === 'bench') { const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, .12, .42), mat); seat.position.y = .52; g.add(seat); for (const x of [-.6, .6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.1, .5, .1), mat); leg.position.set(x, .25, 0); g.add(leg); } }
    else if (p.kind === 'hydrant') { const m = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, .65, 8), neonMat); m.position.y = .32; g.add(m); }
    else if (p.kind === 'antenna') { const m = new THREE.Mesh(new THREE.CylinderGeometry(.025, .04, 2.4, 6), mat); m.position.y = 1.2; g.add(m); }
    else if (p.kind === 'planter') { const pot = new THREE.Mesh(new THREE.BoxGeometry(1.1, .5, .62), mat); pot.position.y = .25; g.add(pot); const plant = new THREE.Mesh(new THREE.ConeGeometry(.45, .9, 5), neonMat); plant.position.y = .9; g.add(plant); }
    else { const m = new THREE.Mesh(new THREE.BoxGeometry(p.kind === 'pipe' ? 1.5 : .85, p.kind === 'neonStrip' ? .08 : .65, .45), p.kind === 'neonStrip' ? neonMat : mat); m.position.y = .35; g.add(m); }
  }
  function propMatFor(_group: THREE.Group, mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial { return mat; }

  function buildSky(): void {
    skyUniforms = { top: { value: color(theme.skyTop) }, horizon: { value: color(theme.skyHorizon) }, bottom: { value: color(theme.skyBottom) }, day: { value: 0 } };
    const mat = ownMaterial(new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(360, 28, 18), mat); root.add(dome);
    const starPositions = new Float32Array(420 * 3); for (let i = 0; i < 420; i++) { const a = i * 2.399 + .4; const y = 28 + (i % 17) * 4.2; const r = 190; starPositions[i * 3] = Math.cos(a) * r; starPositions[i * 3 + 1] = y; starPositions[i * 3 + 2] = Math.sin(a) * r; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.PointsMaterial({ color: '#d8e9ff', size: .75, transparent: true, opacity: .8, depthWrite: false }); ownMaterial(stars); skyStars = new THREE.Points(geo, stars); root.add(skyStars);
    const discTexture = canvasTexture(128, 128, (g, w, h) => { const gradient = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2); gradient.addColorStop(0, '#fff7cf'); gradient.addColorStop(.42, '#d8c7ff'); gradient.addColorStop(1, 'rgba(175,120,255,0)'); g.fillStyle = gradient; g.fillRect(0, 0, w, h); });
    const moon = new THREE.Sprite(ownMaterial(new THREE.SpriteMaterial({ map: discTexture, transparent: true, depthWrite: false, color: '#d7c7ff' }))); moon.position.set(-72, 57, -110); moon.scale.set(12, 12, 1); moonMaterial = moon.material as THREE.SpriteMaterial; root.add(moon);
  }

  function buildSkyline(): void {
    const mat = standard('#111424', .85, .05); addRecolor((p) => mat.color.copy(tmpColor.set(p.buildingBase).multiplyScalar(.55)));
    const dotTexture = canvasTexture(64, 256, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 64; y += 1) for (let x = 0; x < 8; x += 1) {
        if (((x * 7 + y * 13) % 5) < 2) continue;
        g.fillStyle = (x + y) % 3 === 0 ? '#9fd0ff' : '#ffcf9a';
        g.fillRect(x * 8 + 2, y * 4 + 1, 4, 2);
      }
    });
    const dot = ownMaterial(new THREE.MeshBasicMaterial({ color: '#ffffff', map: dotTexture, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    addRecolor((p) => dot.color.set(p.windowCool));
    for (const s of layout.skyline) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mat); tower.position.set(s.x, s.h / 2 - 5, s.z); root.add(tower);
      const windows = new THREE.Mesh(new THREE.PlaneGeometry(s.w * .72, s.h * .62), dot);
      windows.position.set(s.x, s.h * .55 - 5, s.z + s.d / 2 + .06);
      root.add(windows);
    }
  }

  function buildLights(): void {
    ambient = new THREE.AmbientLight(theme.ambient, .62); root.add(ambient);
    hemi = new THREE.HemisphereLight(theme.fillLight, theme.ground, .9); root.add(hemi);
    key = new THREE.DirectionalLight(theme.keyLight, 1.4); key.position.set(-35, 58, 24); root.add(key);
    for (const [x, z, i] of [[-16, -22, 0], [17, -14, 1], [-23, 18, 2], [19, 19, 3]] as const) { const fill = new THREE.PointLight(theme.neon[i], 9, 34, 2); fill.position.set(x, 7, z); root.add(fill); addRecolor((p) => fill.color.set(p.neon[i])); }
  }

  function build(next: Layout): void {
    layout = next; buildGround(); buildBuildings(); buildSigns(); buildLamps(); buildSignals(); buildWater(); buildProps(); buildSkyline(); buildSky(); buildLights();
    ctx.scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity * .7);
  }
  function clear(): void {
    // Dispose geometries too: "换一条街" can be pressed repeatedly.
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    root.clear(); pickables.signs.length = 0; pickables.lamps.length = 0; pickables.water.length = 0; signs.length = 0; lamps.length = 0; signals.length = 0; waterMesh = null; waterTexture = null; waterUniforms = null; skyUniforms = null; skyStars = null; moonMaterial = null; wetUniformsRef = null; smears.length = 0; hoverKind = null; hoverId = -1; heroVisuals.length = 0; key = null; hemi = null; ambient = null;
    for (const material of materials) material.dispose(); for (const texture of textures) texture.dispose(); materials.clear(); textures.clear(); recolors.length = 0;
  }
  function setTheme(next: ThemePalette): void {
    theme = next; for (const recolor of recolors) recolor(next);
    if (waterUniforms) { waterUniforms.deep.value.set(next.waterDeep); waterUniforms.tint.value.set(next.water); }
    if (skyUniforms) { skyUniforms.top.value.set(next.skyTop); skyUniforms.horizon.value.set(next.skyHorizon); skyUniforms.bottom.value.set(next.skyBottom); }
    if (ambient) ambient.color.set(next.ambient); if (hemi) { hemi.color.set(next.fillLight); hemi.groundColor.set(next.ground); } if (key) key.color.set(next.keyLight);
    if (ctx.scene.fog instanceof THREE.FogExp2) ctx.scene.fog.color.set(next.fogColor);
  }
  function update(dt: number, state: AppState, sim: SimBridge): void {
    const env = sim.env; const day = env[ENV.dayFactor] ?? 0; const night = env[ENV.nightFactor] ?? 1; const neon = env[ENV.neonBoost] ?? 1;
    for (const entry of tints) entry.mat.color.copy(entry.night).lerp(entry.day, day); const windowLit = env[ENV.windowLit] ?? night; const wetness = env[ENV.wetness] ?? 0; const precipFog = env[ENV.precipFog] ?? 0;
    // Below ~0.22 the windows are effectively dark; without this daylight keeps every window lit.
    const windowGlow = Math.max(0, (windowLit - 0.22) / 0.78);
    root.traverse((object) => { const material = object.userData.windowMaterial as THREE.MeshStandardMaterial | undefined; if (material) material.emissiveIntensity = windowGlow * (object.userData.windowBias as number) * 0.95; });
    const signData = sim.signs;
    for (let i = 0; i < signs.length; i++) { const visual = signs[i]; if (!visual) continue; const flash = signData[i * 2] ?? 0; const glitch = signData[i * 2 + 1] ?? 0; const jitter = glitch > .06 ? Math.sin((sim.elapsed * 83 + i * 17)) * glitch * .13 : 0; visual.group.position.set(visual.base.x + jitter, visual.base.y + (glitch > .35 ? Math.cos(sim.elapsed * 51 + i) * .035 : 0), visual.base.z); const highlight = hoverKind === 'sign' && hoverId === i ? 2.1 : 1;
      // Daylight already lights the boards; keep the neon from blowing out at noon.
      const signDay = 1 - day * .55;
      visual.glow.opacity = (.12 + (flash + glitch * .4) * .55) * (.30 + neon * .70) * highlight * signDay; visual.face.scale.x = glitch > .18 ? 1 + Math.sin(sim.elapsed * 69 + i) * glitch * .08 : 1; (visual.face.material as THREE.MeshBasicMaterial).color.setScalar((.34 + neon * .66) * (1 - day * .45)); }
    const lampData = sim.lamps;
    for (let i = 0; i < lamps.length; i++) { const visual = lamps[i]; if (!visual) continue; const on = lampData[i * 2] ?? 0; const flicker = lampData[i * 2 + 1] ?? 1; const strength = on * (.48 + flicker * .52) * night * (hoverKind === 'lamp' && hoverId === i ? 1.35 : 1); visual.glow.emissiveIntensity = strength * 5; visual.cone.uniforms.strength.value = strength * .036; visual.pool.opacity = strength * .12; }
    const signalData = sim.signals;
    for (let i = 0; i < signals.length; i++) { const visual = signals[i]; if (!visual) continue; for (let j = 0; j < 3; j++) { const v = signalData[i * 3 + j] ?? 0; visual.lenses[j].emissiveIntensity = v * 4; visual.glows[j].opacity = v * .7; } }
    if (waterTexture) { const values = sim.water; const pixels = waterTexture.image.data as Uint8Array; const n = Math.min(values.length, pixels.length); for (let i = 0; i < n; i++) pixels[i] = Math.max(0, Math.min(255, Math.round((values[i] * .5 + .5) * 255))); waterTexture.needsUpdate = true; }
    if (waterUniforms) { waterUniforms.time.value += dt; waterUniforms.wet.value = wetness; }
    // Neon bleed only exists when the asphalt is wet, it is dark, and reflections are enabled.
    const smearStrength = state.reflections ? Math.max(wetness, state.rain * .75) * night : 0;
    for (const smear of smears) { smear.material.uniforms.time.value = sim.elapsed; smear.material.uniforms.opacity.value = smearStrength * smear.base; }
    if (wetUniformsRef) { wetUniformsRef.time.value += dt; wetUniformsRef.wet.value = Math.max(wetness, state.rain * .8) * (.10 + night * .90); }
    if (skyUniforms) skyUniforms.day.value = day;
    if (skyStars && skyStars.material instanceof THREE.PointsMaterial) skyStars.material.opacity = Math.max(0, night * .92 - day * .35);
    // The moon has no business glowing at noon.
    if (moonMaterial) moonMaterial.opacity = Math.max(0, 1 - day * 1.9);
    if (key) {
      key.intensity = .25 + day * 1.6;
      key.color.copy(new THREE.Color(theme.keyLight)).lerp(new THREE.Color('#ffe9d0'), day * .85);
      key.position.set(Math.cos((env[ENV.hour] ?? 21) / 24 * Math.PI * 2) * 45, 20 + day * 48, 24);
    }
    if (hemi) { hemi.intensity = .62 + day * .30; hemi.color.copy(new THREE.Color(theme.fillLight)).lerp(new THREE.Color('#cfe0ff'), day * .8); }
    if (ambient) { ambient.intensity = .55 - day * .25; ambient.color.copy(new THREE.Color(theme.ambient)).lerp(new THREE.Color('#6a6a86'), day * .75); }
    if (ctx.scene.fog instanceof THREE.FogExp2) ctx.scene.fog.density = theme.fogDensity * (.28 + state.fog * .72 + precipFog * .7);
  }

  build(layout);
  return { root, cameraHome, get waterMesh() { return waterMesh; }, pickables, rebuild(next) { clear(); build(next); }, setTheme, update,
    setHover(kind, id) { if (kind === hoverKind && id === hoverId) return; hoverKind = kind; hoverId = id; },
    setHeroText(text) {
      const next = text.trim();
      if (next === heroOverride) return;
      heroOverride = next;
      let hero = heroVisuals[0];
      for (const candidate of heroVisuals) if (candidate.score > (hero?.score ?? 0)) hero = candidate;
      if (!hero) return;
      const previous = hero.texture;
      const texture = signTexture(hero.def, hero.neon, heroOverride);
      hero.texture = texture;
      const material = hero.visual.face.material as THREE.MeshBasicMaterial;
      material.map = texture;
      material.needsUpdate = true;
      for (const smear of smears) if (smear.material.uniforms.map.value === previous) smear.material.uniforms.map.value = texture;
      textures.delete(previous);
      previous.dispose();
    }, dispose() { clear(); if (ctx.scene.fog) ctx.scene.fog = null; } };
}
