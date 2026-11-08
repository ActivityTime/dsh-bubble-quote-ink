# dsh-bubble-quote-ink

DSH-Tavern 对话气泡「台词着色」插件。

## 它做什么

对话气泡里经常出现两种内容混排：

- **台词**：角色真正说的话，通常包在「」（直角引号）里；
- **动作 / 旁白**：括号里的 `(动作)`、叙述性文字。

本插件只把「」内的**台词**染成该角色的专属色（即气泡行上由 DSH 内联写入的
`--bubble-color`），并加一点字重；括号动作与旁白保持酒馆原本的字色。
效果上就是「谁在说话一目了然」，而动作描述不被染色干扰。

## 为什么需要它

DSH 的气泡行 `.fork-bubble-line` 是直接渲染成纯文本节点的
（`h("span", {className:"fork-bubble-line"}, segment.text)`），CSS 选不中括号内的台词；
而 `registerTextMarker` 的标记是在 `BubblePublication` 解析 `@bubble` 行**之前**切段的，
气泡正文根本不走那条管线。所以这里改用**渲染后 DOM 后处理**：把「…」包进一个
`<span class="dsh-bq-quote">`，并注入一段 CSS 让该 span 取 `--bubble-color`。

- 纯客户端 CSS 变量覆盖 + DOM 后处理，**不改 DSH 运行时 / 任何内部代码**；
- 幂等是结构性的（已替换的文本节点不再含完整 `「…」`，已包好的 span 会被跳过），
  React 重渲染由 `MutationObserver` 接管，流式输出未写完的一行（`…「…`）不会误匹配；
- 不注册任何宿主服务、路由或 patch，`inject` 为空，安装即返回，不会拖慢渲染启动。

## 安装

这是 **folder-drop** 插件（客户端插件，无需打包 / 无需改 `cordis.patch.yml`）。

1. 把本仓库整体放进 DSH 的插件目录：

   ```
   <你的数据目录>/plugins/dsh-bubble-quote-ink/
   ```

   目录里至少需要 `package.json`、`lib/index.js`、`lib/client.js` 三个文件。

2. 重启 DSH。DSH 会自动在 `profiles/tavern/cordis.patch.yml` 里维护
   `tavern-user-plugin-` 条目，**不要手动改这个文件**。

3. 在插件列表里确认 `dsh-bubble-quote-ink` 已启用。

## 兼容性

- 平台：`web`（浏览器侧渲染）。
- 需要 DSH 支持 `--bubble-color` 内联变量（新版 3.2.0 舞台气泡默认提供）。
- 颜色优先取 `--bubble-color` → `--row-color` → `--fork-accent` 回退；
  支持 `color-mix` 的浏览器下会按 82% 角色色 + 18% 原字色混合，避免浅色角色看不清。

## 卸载

插件列表里关闭 / 删除插件目录，重启 DSH 即可。卸载会移除注入的 `<style>` 与已包裹的 span，
气泡恢复酒馆原始样式。

## 文件结构

```
dsh-bubble-quote-ink/
├── package.json        # 插件元信息（name / dsh.client 声明）
├── lib/
│   ├── index.js        # 宿主端：folder-drop 要求导出的空 apply（no-op）
│   └── client.js       # 浏览器端：CSS 注入 + DOM 后处理主体
├── README.md
└── LICENSE
```

## License

MIT © ACTIM
