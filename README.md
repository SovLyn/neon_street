# 霓虹街区 / NEON STREET

一个由 Rust 驱动模拟、WebAssembly 传递状态、three.js 负责渲染的单页霓虹街景。街区布局由种子确定，时间、天气、灯光、招牌、水面和车辆会在浏览器中实时更新。

## 在线体验

[打开 GitHub Pages](https://sovlyn.github.io/neon_street/)

![霓虹街区夜景](docs/screenshot-night.jpg)

<sub>雨夜 · 合成波主题：路口信号灯、霓虹招牌、湿路面与运河倒影。</sub>

![霓虹街区白天](docs/screenshot-day.jpg)

<sub>正午 · 雨后：同一街区的昼夜联动效果。</sub>

## 能玩什么

- **点击场景**：招牌短路闪烁并抖一下、路灯开关、水面激起涟漪；鼠标移到可交互物上会变手型并显示标签。
- **时间与天气**：拖动时间轴看昼夜过渡（窗户亮灯率、霓虹强度、车流密度、路灯光锥一起变），雨、雪、雾独立调节。
- **换一条街**：种子决定建筑、招牌词、字体、配色和街具；地标大招牌固定 4 块，其余全部由种子生长。
- **自定义招牌**：在“街区”里输入最多 8 个字，写到地标招牌上并随分享链接一起带走（`sign=` 参数）。
- **彩蛋**：约半分钟一次，猫横穿路口、UFO 掠过天际、流星划过、全街招牌闪一下；发生时会写进左上的事件日志。
- **摄影模式**：隐藏 HUD、暂停模拟、Esc 退出；右下角按钮导出 PNG（含当前种子与时间）。
- **分享状态**：种子、时间、天气、主题、画质开关、自定义招牌都编码在 URL 里。

## 技术栈

- **Rust / WebAssembly**：确定性街区布局、时间与天气模拟、动态缓冲和交互状态。
- **three.js**：场景几何、车辆与行人、灯光、招牌、运河和后处理渲染。
- **Vite + TypeScript**：开发服务器、类型检查、生产构建和 GitHub Pages 静态部署。
- **Playwright**：覆盖 WASM 初始化、UI 状态、交互、URL 恢复和画布输出的端到端测试。

## 目录结构

```text
src/                 Rust 核心模拟与 wasm-bindgen 导出
web/src/              Vite 前端、three.js 场景、UI 和调试 API
web/pkg/              wasm-pack 生成物（构建时生成，不提交）
tests/               Playwright 端到端测试
docs/CONTRACT.md     模块与 DOM 调试接口契约
.github/workflows/    CI 与 GitHub Pages 部署
```

## 本地开发

环境要求：Rust、`wasm-pack`、Node.js 22+。

```bash
npm ci
npm run build:wasm
npm run dev
```

然后打开 Vite 输出的本地地址。开发页面默认使用 `http://localhost:5173/`。

## 构建与测试

```bash
# Rust 单元测试
cargo test --all

# 生成 release WebAssembly
npm run build:wasm

# TypeScript 类型检查
npm run typecheck

# 生产构建
npm run build

# 预览生产构建
npm run preview

# Playwright 端到端测试（CI 会自动安装 Chromium）
npx playwright install --with-deps chromium
npx playwright test
```

Playwright 本地配置优先使用已安装的 Chrome；CI 使用 Playwright Chromium。测试通过 `window.__neon` 和契约规定的 DOM hooks 验证真实页面行为。

## CI 与 Pages 部署

每次 push 和 pull request 会运行 `.github/workflows/ci.yml`：安装 Rust/WASM 工具链和 Node 依赖，执行 Rust 测试、WASM 构建、类型检查、Vite 构建及 Playwright 测试。失败时会尝试上传 `dist` 和 Playwright 报告。

push 到 `master` 或手动触发 `.github/workflows/deploy.yml` 会构建站点并发布到 GitHub Pages。Vite 使用相对 base，因此同一构建也可在本地预览；预期线上地址为 <https://sovlyn.github.io/neon_street/>。

## 资产与许可清单

所有建筑、道路、招牌、粒子和纹理均在运行时程序化生成；项目不使用第三方图片、模型、音频、远程 CDN 或远程字体，仅使用系统字体栈。

- three.js：MIT
- wasm-bindgen：MIT / Apache-2.0
- serde：MIT / Apache-2.0
- Vite：MIT
- TypeScript：Apache-2.0

## 已知限制

- 当前定位为桌面端体验，未针对移动端触控和小屏布局优化。
- 没有音频或音效系统。
- 种子布局目前只生成一个街区，不提供连续的多街区世界；换街改变建筑与招牌，但运河/天桥等城市结构是固定的。
- 集成显卡运行高质量后处理（尤其 bloom）时可能有明显性能成本；页面会在连续低帧率时自动关闭反射、再关闭泛光，并提示一次。手动改过画质后不再自动降级。
- 地面霓虹倒影是廉价的 additive 拖影，不是真实反射；真正的水面/湿地面反射仍是单平面 512²。
