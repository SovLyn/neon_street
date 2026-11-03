# NEON STREET — 接口契约（唯一事实来源）

本文件是主模型与各 subagent 之间的**强约束接口契约**。任何实现都必须与之精确一致；
发现契约不可能实现或存在冲突时，**停止并报告**，不要自行改契约。

- 代码根：仓库根目录
  - Rust/WASM：`Cargo.toml` + `src/lib.rs` + `src/core/*.rs`（纯 Rust 可 `cargo test`）
  - TypeScript：`web/src/**`（Vite root = `web`），wasm 产物在 `web/pkg/`
- 类型定义唯一事实来源：`web/src/types.ts`（布局与主题）与 `web/src/state.ts`（AppState/store）
- 允许的依赖：`three`、`three/addons/*`、`typescript`、`vite`、`playwright`、`wasm-bindgen`、`serde`、`serde_json`、`console_error_panic_hook`。
  **不得新增其他 npm / crate 依赖**；不得使用外部 CDN 或远程字体；所有资产程序化生成。

---

## 0. 全局约定

- 右手系，Y 轴向上，单位 = 米。主街沿 **Z 轴**（南北向），横街沿 **X 轴**（东西向），交点在原点。
- 车道右侧通行：`axis=ns` 且 `dir=+1` 表示向 +Z 行驶，车辆位于 x>0 一侧。
- 一切“每帧数据”用 `f32` 打包缓冲（见 §3），**不要**每帧 JSON 序列化大数组。
- 颜色用 `#rrggbb` 字符串（three 侧 `new THREE.Color(hex)`）。
- 时间 `timeOfDay` ∈ [0,24)，小时为浮点。
- 所有强度/进度归一化到 `0..1`，除特别说明。
- TS 严格模式（`strict: true`）。禁止 `any` 滥用（允许 `unknown` + 收窄）；禁止 `as unknown as T` 绕过类型。
- 禁止 `eval`/`Function`。禁止网络请求（除加载本地 wasm/JS 资源）。
- 所有面向用户的文案使用中文；代码注释英文或中文均可，保持简洁。

---

## 1. 世界布局规则（Rust 生成器必须满足）

世界包围盒：`bounds = { minX: -72, maxX: 72, minZ: -72, maxZ: 72 }`。

- `roads`: 两条
  - `axis: "ns"`，`width: 20`，`length: 144`，车道 `offset = ±2.5, ±7.5`（4 条，2 进 2 出）
  - `axis: "ew"`，`width: 16`，`length: 144`，车道 `offset = ±2.0, ±6.0`（4 条）
- `sidewalks`: 沿道路两侧的抬高盒（`h: 0.22`），宽 4，不得与车道重叠。
- 路面 y=0；人行道 y=0..0.22；水面 `level` 在 `[-0.55,-0.30]`。
- `water`（运河，固定）：`x0: 18, z0: 22, x1: 68, z1: 68`，`level: -0.4`，`cols: 64, rows: 64`。
  - **水域内不得有 building/skyline/lamps/signals/props**（boat/mooring 除外）。
- `buildings`: 三个象限（NW、NE、SW）内成排布置；建筑边界必须避开：车身道（含人行道）、水面。
  每象限 3–6 栋，`h ∈ [10, 46]`，`w ∈ [8, 20]`，`d ∈ [8, 18]`，彼此不重叠，`rotY` 仅取 0/90/180/270 度（弧度）。
  招牌（signs）必须贴在对应楼体立面上，不得悬空。
- `skyline`: 世界外围（|x| 或 |z| > 74）远景剪影，可不受水面限制，用于天际线。
- `lamps`: 沿人行道内侧每 14m 一盏，`h ∈ [5.5, 7]`，`armYaw` 指向道路。
- `signals`: 8 个（4 个车行 + 4 个行人），位于路口四角。车行信号 `axis` 指明其控制的车道轴。
- `signs`: 每个街区 14–24 块，`kind` 覆盖 `horizontal|vertical|rooftop|blade`，`text` 为 2–8 个字符（中英混排允许）。
- `crosswalks`: 路口四条斑马线（4 个）。
- `props`: 20–40 个装饰（空调机、通风口、花坛、贩卖机、长椅、消防栓、管道、天线、霓虹条），另加 2–3 艘 `boat` + 系泊。

**确定性**：同一 `seed` 必须生成完全相同的布局与初始状态（字节级一致）。

---

## 2. Rust/WASM 导出（`src/lib.rs`，全部 `#[wasm_bindgen]`）

```rust
#[wasm_bindgen]
pub struct Sim { /* ... */ }

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Sim;

    pub fn reseed(&mut self, seed: u32);
    pub fn seed(&self) -> u32;

    pub fn layout_json(&self) -> String;          // §4，静态，reseed 后需重新取

    // 时间 / 天气（TS 每帧写入，幂等、便宜）
    pub fn set_time_of_day(&mut self, hours: f32);
    pub fn time_of_day(&self) -> f32;
    pub fn set_auto_cycle(&mut self, enabled: bool);
    pub fn set_auto_cycle_speed(&mut self, hours_per_second: f32);
    pub fn set_rain(&mut self, v: f32);           // 目标强度，内部平滑趋近
    pub fn set_snow(&mut self, v: f32);
    pub fn set_fog(&mut self, v: f32);
    pub fn rain(&self) -> f32;                    // 平滑后的当前值
    pub fn snow(&self) -> f32;
    pub fn fog(&self) -> f32;

    pub fn advance(&mut self, dt_sec: f32);       // 推进模拟（内部 clamp dt<=0.1）
    pub fn elapsed(&self) -> f32;

    // 交互
    pub fn flash_sign(&mut self, index: u32);
    pub fn toggle_lamp(&mut self, index: u32);
    pub fn add_ripple(&mut self, x: f32, z: f32, strength: f32);
    pub fn trigger_event(&mut self);              // 调试：立刻触发一个彩蛋

    // 动态缓冲（返回 wasm 线性内存中的 f32 指针与长度）
    pub fn env_ptr(&self) -> u32;        pub fn env_len(&self) -> usize;
    pub fn cars_ptr(&self) -> u32;       pub fn cars_len(&self) -> usize;
    pub fn peds_ptr(&self) -> u32;       pub fn peds_len(&self) -> usize;
    pub fn signals_ptr(&self) -> u32;    pub fn signals_len(&self) -> usize;
    pub fn signs_ptr(&self) -> u32;      pub fn signs_len(&self) -> usize;
    pub fn lamps_ptr(&self) -> u32;      pub fn lamps_len(&self) -> usize;
    pub fn water_ptr(&self) -> u32;      pub fn water_len(&self) -> usize;
    pub fn rain_ptr(&self) -> u32;       pub fn rain_len(&self) -> usize;
    pub fn snow_ptr(&self) -> u32;       pub fn snow_len(&self) -> usize;
    pub fn events_json(&self) -> String; // §5，通常为空数组
}
```

- 指针必须指向**未释放、稳定**的内部 `Vec<f32>`（reseed 后可变化，TS 每帧重新取指针）。
- 原生 `cargo test` 覆盖纯 Rust 核心；`lib.rs` 的 wasm 绑定层必须保持极薄。
- 目标 wasm 体积：release < 400KB（gzip 前）。

---

## 3. 动态缓冲格式（f32，stride 固定）

| 缓冲 | stride | 字段 |
|---|---|---|
| `env` | 8 | `hour, sunElev(-1..1), dayFactor, nightFactor, windowLit, neonBoost, wetness, precipFog` |
| `cars` | 8 | `x, y, z, rotY, speedNorm, brake, laneId, kind` |
| `peds` | 7 | `x, y, z, rotY, walkPhase, umbrella(0/1), kind` |
| `signals` | 3 | 每个信号灯 `red, amber, green`（0..1 亮度） |
| `signs` | 2 | 每个招牌 `flash, glitch`（0..1） |
| `lamps` | 2 | 每个路灯 `on(0/1), flicker(0..1 亮度系数)` |
| `water` | 1 | `cols*rows` 高度场，`-1..1`，行主序 `z` 外层、`x` 内层 |
| `rain` | 6 | 每段雨丝端点 `x1,y1,z1,x2,y2,z2`（线段，向下） |
| `snow` | 4 | 每片雪花 `x,y,z,size` |

- 数组长度必须与 `layout` 中对应元素数量一致（`signs.len == layout.signs.length*2` 等）。
- `cars` 的 `rotY`：绕 Y 轴朝向（弧度），`+Z` 方向为 0。
- `peds` 的 `kind`：0 普通、1 提包、2 遛狗（无宠物则同 0）。
- `signals` 顺序与 `layout.signals` 一致；行人的绿灯在黄闪时短暂闪烁（可选）。
- 雨/雪粒子数量固定（雨 2200 段，雪 1200 片），超出屏幕范围时循环。

---

## 4. 布局 JSON（`layout_json` 的精确结构）

以 `web/src/types.ts` 中的 `Layout` 类型为规范，字段一一对应，**不得增删必填字段**。
`serde` 序列化时使用 `#[serde(rename_all = "camelCase")]`。

示例骨架：

```json
{
  "seed": 12345,
  "bounds": { "minX": -72, "maxX": 72, "minZ": -72, "maxZ": 72 },
  "roads": [
    { "axis": "ns", "width": 20, "length": 144,
      "lanes": [ { "id": 0, "axis": "ns", "dir": 1, "offset": 2.5, "speed": 8.5 } ] }
  ],
  "sidewalks": [ { "x": 12, "z": 0, "w": 4, "d": 144, "h": 0.22 } ],
  "crosswalks": [ { "x": 0, "z": 12, "w": 20, "d": 4, "axis": "ns" } ],
  "quays": [ { "x": 18, "z": 45, "w": 1.2, "d": 46, "h": 1.1 } ],
  "buildings": [
    { "id": 0, "x": -24, "z": -30, "w": 14, "d": 12, "h": 28, "rotY": 0,
      "colorIndex": 2, "windows": { "lit": 0.72, "seed": 991 } }
  ],
  "skyline": [ { "id": 0, "x": -90, "z": -40, "w": 16, "d": 16, "h": 60, "colorIndex": 1 } ],
  "signs": [
    { "id": 0, "kind": "horizontal", "text": "霓虹 HOTEL", "x": -17, "y": 12, "z": -23.9,
      "w": 8, "h": 1.6, "rotY": 0, "colorIndex": 0, "font": "sans", "buildingId": 0 }
  ],
  "lamps": [ { "id": 0, "x": 12.4, "z": -40, "h": 6.4, "armYaw": 3.14159 } ],
  "signals": [ { "id": 0, "x": 12, "z": 12, "rotY": 2.356, "axis": "ns", "forPedestrian": false } ],
  "props": [ { "id": 0, "kind": "ac", "x": -20, "y": 14, "z": -24, "rotY": 0, "s": 1, "colorIndex": 3 } ],
  "water": { "x0": 18, "z0": 22, "x1": 68, "z1": 68, "level": -0.4, "cols": 64, "rows": 64 }
}
```

约束：`buildings[i].id == i`，`signs[i].id == i`，`lamps[i].id == i`，`signals[i].id == i`（TS 直接用下标做拾取与缓冲索引）。

---

## 5. 彩蛋事件（`events_json`）

```json
{ "events": [ { "kind": "ufo", "p": 0.42, "x": 10, "y": 40, "z": -30, "dx": 1, "dz": 0, "seed": 7 } ] }
```
- `kind` ∈ `"ufo" | "cat" | "flash" | "shootingStar"`。
- 同时最多 2 个事件；平均每 45–120 秒触发一次（由 Rust 调度，`trigger_event()` 可强制触发）。
- `p` 为进度 0..1；`x,y,z` 为当前位置；`dx,dz` 为归一化方向。
- `flash`：全场霓虹同步闪一下，**不产生** TS 网格，`p` 驱动招牌亮度。
- UFO 必须在世界包围盒之上 (y>32) 掠过，不得遮挡街区主体；猫在路面上跑过街。

---

## 6. TypeScript 模块契约

所有模块从 `web/src/types.ts` / `web/src/state.ts` 取类型，不得复制定义。

```ts
// web/src/ctx.ts
export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sim: SimBridge;
  store: Store;
  layout: Layout;
  theme: ThemePalette;
  reflection: ReflectionController; // 由 fx 创建后注入；单面 y=0 反射
}
```

### 6.1 SCENE（`web/src/scene/index.ts`）

```ts
export interface SceneHandle {
  root: THREE.Group;
  cameraTarget: THREE.Vector3;      // 建议相机注视点（按种子布局给定）
  cameraHome: { position: THREE.Vector3; target: THREE.Vector3 };
  waterMesh: THREE.Mesh | null;
  pickables: {
    signs: THREE.Object3D[];        // userData.signId: number
    lamps: THREE.Object3D[];        // userData.lampId: number
    water: THREE.Object3D[];        // 水面（raycast 用）
  };
  rebuild(layout: Layout): void;
  setTheme(theme: ThemePalette): void;
  update(dt: number, state: AppState, sim: SimBridge): void;
  dispose(): void;
}
export function createScene(ctx: RenderContext): SceneHandle;
```

**所有权**：`SceneHandle.root` 由主模型在 `createScene` 之后加入 `ctx.scene`（模块内部不要 `scene.add(root)`）；
模块可以自行把额外对象挂到 `ctx.scene`。`pickables` 只暴露对象列表，拾取时使用 `intersectObjects(list, true)`，
并把 `userData.signId` / `userData.lampId` 放在命中对象或其祖先上。

职责：静态几何（楼、窗、招牌 canvas 贴图、路面、人行道、斑马线、路缘、码头、水岸、路灯、信号灯外壳、装饰、天际线、天空/雾、环境光）；
每帧根据 `sim` 缓冲更新招牌闪烁/glitch、路灯开关与闪烁、信号灯发光、窗户亮灯、水面波动（用 `ctx.reflection.texture`）。

### 6.2 ACTORS（`web/src/actors/index.ts`）

```ts
export interface ActorsHandle {
  root: THREE.Group;
  rebuild(layout: Layout): void;
  setTheme(theme: ThemePalette): void;
  update(dt: number, state: AppState, sim: SimBridge): void;
  dispose(): void;
}
export function createActors(ctx: RenderContext): ActorsHandle;
```

**所有权**：`root` 由主模型添加到 `ctx.scene`。
职责：车（InstancedMesh，多车型，车灯/尾灯、尾灯拖尾 = Line 或 additive 面片）、行人剪影 + 伞、彩蛋实体（UFO / 猫），全部由 `sim` 缓冲驱动，不自行推进物理。

### 6.3 FX（`web/src/fx/index.ts`）

```ts
export interface ReflectionController {
  texture: THREE.Texture;
  textureMatrix: THREE.Matrix4;
  render(): void;                 // 渲染镜像场景到 RT
  resize(width: number, height: number): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

export interface FxHandle {
  reflection: ReflectionController;
  rebuild(layout: Layout): void;
  setTheme(theme: ThemePalette): void;
  update(dt: number, state: AppState, sim: SimBridge): void;
  render(dt: number): void;       // reflection.render() + composer.render()
  resize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}
export function createFx(ctx: RenderContext): FxHandle;
```

- `createFx(ctx: BaseContext)` 必须在返回前创建 `reflection`；主模型随后构造 `RenderContext = { ...base, reflection: fx.reflection }` 并传给 scene/actors。`ReflectionController` 类型定义在 `web/src/ctx.ts`。
- FX 可以自行往 `ctx.scene` 添加降水/粒子对象。
- 必备：`UnrealBloomPass`，chromatic aberration / 噪点开关（`state.chromatic` / `state.grain` / `state.bloom`）。
- 降水：雨用 `LineSegments`（顶点来自 `sim.rain`），雪用 `Points`（`sim.snow`），数量随强度调节可见性。
- 反射 RT 尺寸 ≤ 512×512，`render()` 只在 `state.reflections` 为真且相机有变化时执行；不可每帧重复渲染两次以上。

### 6.4 UI（`web/src/ui/index.ts`）

```ts
export interface UiDeps {
  store: Store;
  sim: SimBridge;
  onReseed(seed: number): void;
  onShare(): string;               // 生成并写入 URL，返回完整 URL
  onCapture(): Promise<void>;      // 摄影模式导出 PNG
  onCameraReset(): void;
  onEvent(): void;
}
export interface UiHandle {
  refresh(): void;                 // 状态变化后同步控件显示（不要与用户输入抢焦点）
  toast(message: string): void;
  dispose(): void;
}
export function mountUI(deps: UiDeps): UiHandle;
```

**必须提供的 DOM 钩子（Playwright 依赖，不得改名）**：

| 选择器 | 元素 |
|---|---|
| `#neon-time` | 时间滑块 `input[type=range]`，0..24 step 0.1 |
| `#neon-rain` / `#neon-snow` / `#neon-fog` | 强度滑块 0..1 step 0.01 |
| `[data-theme-id="<id>"]` | 主题切换按钮（5 个） |
| `[data-preset-id="<id>"]` | 预设按钮（4 个） |
| `[data-testid="seed-input"]` | 种子输入框 |
| `[data-testid="btn-reseed"]` | 换一条街 |
| `[data-testid="btn-share"]` | 分享链接 |
| `[data-testid="btn-photo"]` | 进入摄影模式 |
| `[data-testid="btn-capture"]` | 摄影模式导出 PNG |
| `[data-testid="btn-reset-camera"]` | 重置机位 |
| `[data-testid="btn-event"]` | 触发彩蛋 |
| `[data-testid="toggle-bloom"]` / `toggle-chroma` / `toggle-grain` / `toggle-refl` | 开关 |
| `[data-testid="toast"]` | toast 容器（文本为最近一条消息） |

DOM 结构全部由该模块创建（`#hud` 容器由 index.html 提供），样式写在 `web/src/ui/ui.css`，用 CSS 变量接收主题色（由主模型每帧/主题变更时写入 `--accent`）。

---

## 7. 主循环顺序（`web/src/main.ts`，主模型维护）

```
requestAnimationFrame:
  1. dt = clamp(now-last, 0, 0.05)
  2. sim.setTimeOfDay / setRain / setSnow / setFog / setAutoCycle（状态 → sim）
  3. if (!state.paused) sim.advance(dt)
  4. if (state.autoCycle) store.patch({ timeOfDay: sim.timeOfDay })
  5. scene.update(dt, state, sim)
  6. actors.update(dt, state, sim)
  7. fx.update(dt, state, sim)
  8. fx.render(dt)            // reflection + composer
  9. ui.refresh()（仅主题/状态变化时）
```

点击拾取：`pointerdown` 记录位置，`pointerup` 位移 < 6px 视为点击，`Raycaster` 对 `scene.pickables` 检测；
命中招牌 → `sim.flashSign(id)` + toast；命中路灯 → `sim.toggleLamp(id)`；命中水面 → `sim.addRipple(x,z,strength)`。

调试 API（Playwright 依赖）见 `web/src/main.ts` 中的 `window.__neon`，契约：

```ts
interface NeonDebug {
  ready: boolean;
  frame: number;
  wasmBytes: number;
  layoutSeed: number;
  state(): AppState;
  set(patch: Partial<AppState>): void;
  sim(): { timeOfDay: number; cars: number; peds: number; signFlashSum: number; lampOn: number; waterSum: number; env: number[] };
  setSeed(seed: number): void;
  clickSign(i: number): void; clickLamp(i: number): void; clickWater(x: number, z: number): void;
  sample(): { calls: number; triangles: number; meanLuma: number; uniqueColors: number };
  shot(): string;   // dataURL
  pickAt(x: number, y: number): string | null;
}
```

---

## 8. 门禁命令（每个 subagent 交付前自检）

```bash
# Rust
cargo test
cargo build --target wasm32-unknown-unknown --release
wasm-pack build . --target web --out-dir web/pkg --out-name neon_street --release

# TS
npm install
npm run typecheck        # tsc --noEmit
npm run build            # tsc --noEmit && vite build
```

`wasm-pack` 与 `PATH` 由主模型提供：`/c/Users/SovLy/.local/bin/wasm-pack`（Git Bash）。
