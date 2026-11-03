# 分工与模型使用记录

本项目由一个主模型（总负责人）调度多个 subagent 完成。所有 subagent 均使用 **OpenAI 提供商**模型。

| 任务 | 负责范围 | 模型（OpenAI） | 选择理由 | 结果 |
|---|---|---|---|---|
| 总负责人 | 契约、脚手架、集成、验收、部署 | 会话默认模型 | 架构与集成责任 | 全程 |
| `rust-core` → `rust-layout` / `rust-dyn` | Rust 模拟核心：布局生成、车流、行人、时间/天气、水波、粒子、彩蛋 | `gpt-6.1-terra` + `gpt-5.6-terra` | 关键算法与几何生成，需要较强推理 | 拆成三轮：初版提前收尾 → 拆分为「布局生成」与「动力学模块」并行，最终 27 个单元测试通过 |
| `scene-city` | three.js 静态场景（楼体、招牌、路面、运河、路灯、信号灯、天空） | `gpt-5.6-terra` | 视觉工作量最大的模块 | 产出后被主模型接管做昼夜/材质/水面重写 |
| `actors-dyn` | 车流、行人、彩蛋实体（InstancedMesh） | `gpt-5.6-terra` | 中等复杂度渲染 | 完成，主模型修复实例颜色空指针 |
| `fx-post` | Bloom/色差/噪点、平面反射、雨雪粒子 | `gpt-5.6-terra` | 着色器与后处理链路 | 完成；主模型修复反射层与色调映射 |
| `ui-hud` | HUD、滑块、主题/预设、URL、摄影模式 | `gpt-5.6-luna` | DOM/交互为主，成本优先 | 完成 |
| `ui-css` | HUD 样式表 | `gpt-5.6-luna` | 纯样式，机械度高 | 完成，主模型压缩尺寸 |
| `devops-ci` | CI、Pages 部署、Playwright、README、TODO | `gpt-5.6-luna` | 模板化配置与文档 | 完成 |
| `layout-hero` | 布局生成：地标大招牌 + 按 seed 抽样招牌词/字体/配色（第二轮趣味性改进） | `gpt-6.1-terra` | 几何推理与确定性约束 | 完成 |
| `hud-actions` | HUD 重排：底部常驻操作条 + 事件日志（第二轮趣味性改进） | `gpt-5.6-terra` | 结构化布局，需要设计判断 | 完成 |

## 额度与中断

- 无额度耗尽。
- 期间发生过一次会话中断，导致后台 subagent 被回收；已完成文件保留。主模型随后重发被中断的 Rust 任务并自行完成剩余集成（`src/lib.rs`、昼夜材质、湿地面反射、拾取层、摄影模式修复）。

## 主模型承担的代码（集成与胶水）

`src/lib.rs`（WASM 边界）、`web/src/{main,state,url,ctx,types,wasm/sim}.ts`、`web/src/theme/palettes.ts`、`web/index.html`、`web/src/styles.css`、`scripts/*`、`docs/CONTRACT.md`，以及场景/特效/UI 的集成修复与视觉调校。
