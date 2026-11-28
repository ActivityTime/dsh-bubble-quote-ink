# dsh-bubble-quote-ink

DSH-Tavern 对话气泡「台词着色」插件。

v0.9.x 起多了一个**开始页「气泡编辑」卡片**（外观参数 / 角色表 / 气泡提示词三页），见第 5 节；渲染着色部分与 v0.1–v0.8 一致。

## 它做什么

### 1. 台词着色

对话气泡里经常出现两种内容混排：

- **台词**：角色真正说的话，通常包在「」（直角引号）里；
- **动作 / 旁白**：括号里的 `(动作)`、叙述性文字。

本插件只把「」内的**台词**染成该角色的专属色（即气泡行上由 DSH 内联写入的
`--bubble-color`），并加一点字重；括号动作与旁白保持酒馆原本的字色。
效果上就是「谁在说话一目了然」，而动作描述不被染色干扰。

### 2. 没有配置颜色的角色 → 按名字生成稳定随机色

DSH 给没配形象色 / 素材色的角色统一用固定的灰绿 `--fork-figure-fallback`，
一屏下来全是同一个色。本插件识别这些气泡行，用**说话人名字**做 FNV-1a 哈希
得到种子，映射成一个稳定的伪随机色（同一个人永远是同一个颜色，跨会话、跨重启不变）：

- 色相铺满整个色轮，饱和度 52–67%、亮度 40–49%，明暗两套主题都清晰可读；
- 该行的台词、名字墨色、头像底色统一跟着变；
- 已配置形象色 / 素材色的角色**完全不受影响**。

### 3. 没有素材的头像框 → 名字首字艺术字

气泡头像位有两种「空」法，本插件统一处理成印章风格的渐变艺术字：

- **有角色条目但没有头像素材**：DSH 原本会显示名字首字，但只是素白小字；
- **连角色条目都没有**（说话人未在角色配置里登记）：DSH 渲染的是一个完全空的头像框。

这两种情况都会得到同一个艺术字：字面用渐变裁切（从「角色色混文字色」过渡到纯角色色），
外加一圈角色色描边与高光底；字色同样跟随 `--bubble-color`，所以随机色角色也是同一套配色。

### 4. 关于「气泡提示词编辑」（v0.8.0 已撤销）

v0.5–v0.7 曾在「舞台装置」组里提供过一块「气泡提示词」配置页，先后试过三种方案
（追加注入 → 标记补丁 → 直改 `dialogue-bubbles.js` 本体）。**v0.8.0 全部撤销**：
这三种方案的本质都是把插件写入的字节放进 DSH 自己的程序文件里 —— 官方更新会覆盖或
修复它们、改写要重启才生效、还会在包目录里留下未声明的文件。主人的验收标准是
**「不能影响任何功能」**，插件因此不再读写任何宿主文件。

修改对白提示词请走官方通道（DSH 3.5.0 实证）：

- **内置「对白提示词」编辑器**（气泡设置页）：分块模式可查看【格式规则】【配音规则】
  【角色表】的实际注入文本；「补充要求」原样追加；「完全自定义模板（高级）」可重排
  全部内容（须保留 `{{bubble_format}}`、`{{bubble_emotions}}`、`{{bubble_characters}}`
  三个占位符），保存热生效，零文件改动。
- **绑定世界书的常量条目**：格式规则与角色表会同步成绑定世界书里一条常量条目
  （`forkDialogueBubbles` 注记），设计上就是给用户看和改的；可用「世界书编辑器」编辑。
  ⚠️ 气泡设置页再次保存时，该条目会按设置重新生成覆盖手改内容。
- 注意：3.5.0 编辑器里的「格式规则 · 编辑」按钮目前是半成品（后端不返回
  `defaultFormat`、域层不认 `injection.format`），按钮恒为禁用，等官方后续版本。

> v0.9.0 起插件自带「气泡编辑台」卡片，提示词那一页走的是**同一条官方 HTTP RPC**
> （`getAssetEngineSettings` / `saveAssetEngineSettings`），只读写模板与补充要求这两层，
> 不改任何程序文件；详见第 5 节。

## 5. 气泡编辑台（v0.9.0，开始页卡片）

`tavernUi.registerPanel({ id: 'studio' })` + `registerStartGroup({ title: '气泡编辑', tabs: ['studio'] })`，
在开始页自成一个「气泡编辑」分组，点卡片进入三页编辑台。

### A. 外观

台词字重、台词取色比例（`color-mix` 里角色色所占百分比，100 = 纯角色色）、头像色环、
头像渐变艺术字、随机色开关与基准色相/饱和度/亮度/抖动幅度。改动即时重写注入的 `<style>`
文本，不进宿主文件，**即时可见**，点「保存全部设置」落到插件 pluginData。

### B. 角色表

- 显示名 + 称呼/触发词（逗号、顿号、`/`、`|` 分隔）+ 颜色 + 启停。
- **只作用于宿主用默认灰绿（`var(--fork-figure-fallback)`）渲染的行**，也就是没有舞台配置形象色 /
  素材色的角色。已经配过色的角色保持原色，一个属性都不覆盖（若之前挂过 `dsh-bq-cast-*` 类，会被清掉）。
- 命中后以 `--bubble-color: <色> !important` 覆盖（独立 `dsh-bq-cast-<i>` 类，避开 React inline style），
  名字墨色同色。
- **完全由本插件维护，不读取舞台人物 / 素材包 / 会话数据。**

### C. 气泡提示词

- 读：`POST /api/dsh-tavern/getAssetEngineSettings`（同源、与内置编辑器同一条载体），
  取 `dialogue.injection.template` / `.extra`；`getDialogueBubbles` 如返回分块则只读展示。
- 写：`saveAssetEngineSettings`，带 `expectedRevision` 与原 `dialogue` 全量字段，只替换
  `injection.template` / `.extra`。服务端 `normalizeBubbleInjection` 照旧校验三个占位符，
  **保存后下一轮生效，无需重启，不落任何程序文件**。
- 失败降级：拿不到 RPC（版本漂移 / 未授权）时页面提示错误，可回到
  「舞台设置 › 提示词」内置编辑器；两个输入框仍可作为本地草稿复制过去。
- **格式规则 / 配音规则全文编辑（v0.9.3，v0.9.6 起改为原样提交）**：点「读取当前注入」会把宿主实际注入的
  `格式规则`与`配音规则`整段填进两个编辑框。点「原样保存」，提交值就是：

  ```
  你的格式规则

  你的配音规则
  ```

  **一个字都不追加**——没有占位符、没有作废声明、没有尾随提示。
  ⚠️ 但官方校验（`normalizeBubbleInjection`）要求模板必须含 `{{bubble_format}}`、`{{bubble_emotions}}`、
  `{{bubble_characters}}`，缺一个保存直接报「模板必须保留 … 占位符」。此时界面会原样显示宿主报错，并多出
  「补占位符后保存」按钮——**只有你点它，才会在你文本末尾追加那三行**，且按钮文案写明了会追加什么。
  不想动输入就永远别点；想保存就得接受那三行，二选一，插件不替你决定。

- **面板可滚动（v0.9.4）**：宿主把插件面板直接塞进 `betterSidebar` 的 pane 内容槽，
  那个槽是 `flex: 1; min-height: 0; overflow: hidden`。本插件根节点 `.dsh-bq-studio` 原先没有
  声明高度，被裁剪后整页滚不动；现在它自己 `flex: 1 1 auto; min-height: 0; height: 100%; overflow-y: auto`，
  长表单（格式规则全文 + 配音规则全文）可以正常上下滚，页签条固定不压缩，长文本框上限 48vh。

### D. 合成气泡（v0.9.7）

给一套**属于本插件自己**的台词格式，用与官方气泡一致的样式渲染，不碰官方的 `@bubble` 通道：

```
$bubble[handle|名字|表情|动作|台词|语音台词]
$bubble[alya|爱莉|性欲|揉乳皱眉|讨厌~|キライ~]
```

- 6 段 `|` 分隔；**六段全部必填，任何一段都不准留空**——缺段或空段这行就退回普通正文。
- 台词用 `*…*` 包裹按内心独白渲染；台词/动作已自带 `「」`、`（）` 时不再重复包。
- DOM 照抄宿主 `BubbleRow`（`fork-bubble` 全套类名 + `data-alias` + `--bubble-color`），
  所以外观页的字重、取色、头像色环艺术字自动套用到合成气泡。
- 素材包：头像/颜色/voice 读卡片自己的 `对话气泡` 角色素材（`getDialogueBubbles` 的
  `config.characters`）。颜色优先级 **素材包 `color` > 角色表 > 名字随机色**；头像按 handle/名字匹配，
  再按「表情」取该情绪差分（`emotions[id].label` ↔ `moods[id]`），依次退 `moods.default` → `avatar` → 首字占位。
  素材的 `voice`/`voiceLang` 挂在 `data-dsh-bq-figure-voice`/`-lang` 上（尚未接语音播放）。
- **识别与渲染始终开启**，开关只决定是否注册提示词段落：
  - 默认开关 `synthetic.defaultOn`（默认关），新会话没有单独设置时跟随它；
  - 本会话开关 `synthetic.sessions[会话id]`，覆盖默认值；
  - 「注册本会话段落 / 撤销本会话段落」走标准 API：host 侧用该会话的 `agent.ctx` 调
    `ctx.systemPrompt.section({ name: 'dsh-bubble-quote-ink:synthetic', order: 190, text })`，
    只在这一局的 system 里多一段。**不写 `dialogue.injection`（气泡格式/配音规则）、不写
    system-append、不写任何设置文档或宿主文件**；disposer 随 agent 卸载自动执行。
  - 客户端与 host 侧只通过插件自己的路由 `POST /api/dsh-bubble-quote-ink/synthetic`（`webServer.register`）同步开关。
- 真话：开关不持久化在宿主，DSH 重启后默认关，面板打开时按保存的开关重新推送；没有活 agent 的会话记为 pending，下一轮自动注册。
- 「重新读取角色素材」可手动刷新素材缓存。

## 数据落点

```json
pluginData.bubbleStudio = {
  "appearance": { "quoteWeight": 500, "quoteMix": 82, "avatarGlyph": true, "avatarRing": true,
                  "randomOn": true, "randomHue": 0, "randomSat": 58, "randomLight": 45, "randomSpread": 9 },
  "cast": [ { "name": "露娜", "aliases": "Luna,露娜", "color": "#7c9cf5", "enabled": true } ],
  "draft": { "format": "", "voice": "", "template": "", "baseTemplate": "", "extra": "" },
  "synthetic": { "defaultOn": false, "sessions": { "会话id": true } },
  "updatedAt": "2026-11-28T…"
}
```

## 为什么需要它

DSH 的气泡行 `.fork-bubble-line` 是直接渲染成纯文本节点的
（`h("span", {className:"fork-bubble-line"}, segment.text)`），CSS 选不中括号内的台词；
而 `registerTextMarker` 的标记是在 `BubblePublication` 解析 `@bubble` 行**之前**切段的，
气泡正文根本不走那条管线。所以这里改用**渲染后 DOM 后处理**：把「…」包进一个
`<span class="dsh-bq-quote">`，并注入一段 CSS 让该 span 取 `--bubble-color`。

- 气泡着色/随机色/艺术字：纯客户端 CSS 变量覆盖 + DOM 后处理，**不改 DSH 运行时**；
- v0.8.0 起**宿主端零接触**：插件不读写任何 DSH 程序文件、不注册宿主服务
  （v0.5–v0.7 的提示词面板三种方案已全部撤销，见上文第 4 节）；
- 幂等是结构性的（已替换的文本节点不再含完整 `「…」`，已包好的 span 会被跳过），
  React 重渲染由 `MutationObserver` 接管，流式输出未写完的一行（`…「…`）不会误匹配；
- 随机色与艺术字同样靠 DOM/CSS 后处理实现：颜色通过按 `data-alias` 注入的 CSS 规则
  重定义 `--fork-figure-fallback`（React 只在属性变化时写样式，不会误删），
  艺术字则把占位文字包进一个 span 以便做渐变裁切；
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
- 随机色与艺术字的渐变效果依赖 `color-mix` / `background-clip: text`；
  不支持时自动回落到 DSH 原始样式（不会出现看不见的字）。

## 卸载

插件列表里关闭 / 删除插件目录，重启 DSH 即可。卸载会移除注入的 `<style>` 与已包裹的 span，
气泡恢复酒馆原始样式。

## 文件结构

```
dsh-bubble-quote-ink/
├── package.json        # 插件元信息（name / dsh.client 声明）
├── lib/
│   ├── index.js        # 宿主端：v0.8.0 起刻意无操作（零接触，不 import fs）
│   └── client.js       # 浏览器端：CSS 注入 + DOM 后处理 + 气泡编辑台面板（v0.9.0）
├── scripts/
│   ├── selftest.mjs    # 零副作用自测（135 项断言：着色逻辑 + 编辑台数据/RPC + 面板滚动 + 模板拼装 + 合成气泡/素材读取 + 宿主标准扩展点 + 宿主端零接触）
│   └── sync.mjs        # 同步到 folder-drop 插件目录
├── .retired-v070/      # v0.7.0 时代的遗留备份（dialogue-bubbles.js 3.3.0 原始字节），
│                       #   已从 DSH 程序目录移出，仅作留档
├── .retired-v080/      # v0.8.0 的 client.js / package.json（改编辑台前的最后一版）
├── README.md
└── LICENSE
```

## License

MIT © ACTIM
