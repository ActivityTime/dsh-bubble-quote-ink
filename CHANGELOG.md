# Changelog

## 2026-11-08 — v0.1.0（首发）

- **新增** 对话气泡「台词着色」插件 `dsh-bubble-quote-ink`。
  - 仅把「」内的台词染成角色色 `--bubble-color` 并加字重；括号动作 / 旁白保持原色。
  - 纯客户端 CSS 变量覆盖 + 渲染后 DOM 后处理，不改 DSH 运行时。
  - 结构性幂等 + `MutationObserver` 接管 React 重渲染，流式未完行不误匹配。
- **发布** 首版仓库与 Release v0.1.0，附带示例素材包 `dafeiyu-full-pack-set.zip`
  （「大肥鱼」人物 + 中国通用背景 + 通用 BGM + 通用音效，四包合集，已规范化可经【获取素材包】导入）。
