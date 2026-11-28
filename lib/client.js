/**
 * dsh-bubble-quote-ink — browser half (v0.9.0 气泡编辑台)
 *
 * Rendering effects (unchanged since v0.1–v0.4):
 *   1. Only the spoken line inside 「」 takes the speaker's colour.
 *   2. （action） and narration keep Tavern's original ink.
 *   3. Bubbles whose speaker has no configured colour fall back to a name-seeded
 *      stable colour (overriding --fork-figure-fallback per alias).
 *   4. The faceless-avatar placeholder gets a seal-like artistic glyph + colour ring.
 *   5. Speakers with no character entry at all get the same treatment.
 *
 * NEW v0.9.0 — 「气泡编辑台」 start-page card (tavernUi.registerPanel + registerStartGroup):
 *   A. 外观: quote weight / colour mix ratio / avatar glyph / colour ring / random-colour
 *      parameters. All of them regenerate the injected <style> text, so they take effect
 *      immediately and never touch a host file.
 *   B. 角色表: a plugin-owned cast table (display name + aliases + bubble colour).
 *      Cast colours are forced onto matching bubble rows
 *      through a per-index class + CSS rule (--bubble-color !important), which beats React's
 *      inline value without fighting its diff. It does not read or write any stage/figure data.
 *   C. 气泡提示词: reads and writes the official engine setting through Tavern's own HTTP
 *      RPC carrier (POST /api/dsh-tavern/getAssetEngineSettings / saveAssetEngineSettings),
 *      i.e. the exact path the built-in editor uses. Nothing is written into程序文件;
 *      the host's normalizeBubbleInjection still validates template placeholders.
 *      If the RPC is unavailable (version drift), the panel degrades to a local draft
 *      you can copy into the built-in editor.
 *
 * Why DOM work for rendering: .fork-bubble-line is a plain text child, CSS cannot select
 * the quoted part, and registerTextMarker runs before @bubble parsing.
 *
 * No host services are patched: inject is ['tavernUi']; the renderer work is deferred into
 * ctx.effect, and the panel is registered through public plugin APIs only.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bubble-quote-ink',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = null
    try { React = require('react') } catch (error) { React = null }
    var h = React ? React.createElement : null

    var STYLE_ID = 'dsh-bubble-quote-ink-style'
    var ALIAS_STYLE_ID = 'dsh-bubble-alias-ink-style'
    var CAST_STYLE_ID = 'dsh-bubble-cast-ink-style'
    var SPAN_CLASS = 'dsh-bq-quote'
    var GLYPH_CLASS = 'dsh-bq-avatar-glyph'
    var CAST_PREFIX = 'dsh-bq-cast-'
    var LINE_SELECTOR = '.fork-bubble-line'
    var ROW_SELECTOR = '.fork-bubble'
    var AVATAR_SELECTOR = '.fork-bubble-avatar'
    // Fixed-prefix format the owner asked for (independent of the host's @bubble format):
    //   $bubble[handle|name|variant|action|display text|voice text]
    // No /m on purpose: a node must hold nothing but this one line, otherwise a paragraph
    // that merely mentions the syntax somewhere inside would be swallowed whole.
    var SYNTHETIC_LINE = /^\s*\$bubble\[(.+)\]\s*$/
    var SYNTHETIC_ATTR = 'data-dsh-bq-synthetic'
    var SYN_PROMPT_START = '[固定气泡格式]'
    var SYN_PROMPT_END = '[/固定气泡格式]'
    var SYN_PROMPT = [
      SYN_PROMPT_START,
      '每一句台词单独一行，写成 $bubble[handle|名字|表情|动作|台词|语音台词]。',
      '- 六个字段全部必填，任何一段都不准留空；缺一段这行就不会被当成台词。',
      '- handle：说话人标识，小写；名字：显示名；表情：这一行舞台上的情绪或姿态。',
      '- 动作：说话人这一行的动作/神态，中文短语，不带括号。',
      '- 台词：实际说的话，中文，不带「」或任何括号。',
      '- 语音台词：同一句在该角色语音语言里的说法；该角色没有语音语言时，也必须填，就写同一句台词原文。',
      '- 每个字段里都不要出现竖线 |；一行一句；叙述与动作描写仍用普通散文。',
      '示例：$bubble[alya|爱莉|性欲|揉乳皱眉|讨厌~|キライ~]',
      SYN_PROMPT_END
    ].join('\n')
    var PH_CLASS = 'fork-bubble-avatar-ph'
    var QUOTE_RE = /「([^」]+)」/g
    // The literal inline value bubbles.js writes when a figure has no configured colour.
    var FALLBACK_COLOR = 'var(--fork-figure-fallback)'
    var RPC_BASE = '/api/dsh-tavern/'
    // The host half registers the instruction through ctx.systemPrompt.section();
    // this route is only the switch, nothing is written to any settings document.
    var SYN_ROUTE = '/api/dsh-bubble-quote-ink/synthetic'
    var DATA_KEY = 'bubbleStudio'

    var DEFAULT_APPEARANCE = {
      quoteWeight: 500,
      quoteMix: 82,
      avatarGlyph: true,
      avatarRing: true,
      randomOn: true,
      randomHue: 0,
      randomSat: 58,
      randomLight: 45,
      randomSpread: 9
    }

    // --- small helpers ---------------------------------------------------------

    function clampNumber(value, fallback, min, max) {
      var n = Number(value)
      if (!isFinite(n)) n = fallback
      if (n < min) n = min
      if (n > max) n = max
      return n
    }

    function cloneDefaults() {
      var out = {}
      for (var key in DEFAULT_APPEARANCE) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_APPEARANCE, key)) out[key] = DEFAULT_APPEARANCE[key]
      }
      return out
    }

    function normalizeAppearance(input) {
      var src = input || {}
      return {
        quoteWeight: clampNumber(src.quoteWeight, DEFAULT_APPEARANCE.quoteWeight, 300, 900),
        quoteMix: clampNumber(src.quoteMix, DEFAULT_APPEARANCE.quoteMix, 30, 100),
        avatarGlyph: src.avatarGlyph !== false,
        avatarRing: src.avatarRing !== false,
        randomOn: src.randomOn !== false,
        randomHue: clampNumber(src.randomHue, DEFAULT_APPEARANCE.randomHue, 0, 359),
        randomSat: clampNumber(src.randomSat, DEFAULT_APPEARANCE.randomSat, 20, 90),
        randomLight: clampNumber(src.randomLight, DEFAULT_APPEARANCE.randomLight, 25, 65),
        randomSpread: clampNumber(src.randomSpread, DEFAULT_APPEARANCE.randomSpread, 0, 20)
      }
    }

    // Cast rows: display name, comma-separated aliases/handles, hex colour, enabled.
    function normalizeCast(list) {
      var out = []
      var src = Array.isArray(list) ? list : []
      for (var i = 0; i < src.length; i++) {
        var item = src[i]
        if (!item || typeof item !== 'object') continue
        var name = String(item.name == null ? '' : item.name).trim()
        if (!name) continue
        var color = String(item.color == null ? '' : item.color).trim()
        out.push({
          name: name,
          aliases: String(item.aliases == null ? '' : item.aliases).trim(),
          color: color || '#7c9cf5',
          enabled: item.enabled !== false,
          note: String(item.note == null ? '' : item.note).trim()
        })
      }
      return out
    }

    function normalizeKey(value) {
      return String(value == null ? '' : value).toLowerCase().replace(/[\s\u3000]+/g, '')
    }

    // Returns the cast row index for a speaker label, or -1.
    function castMatch(label, cast) {
      var key = normalizeKey(label)
      if (!key || !Array.isArray(cast)) return -1
      for (var i = 0; i < cast.length; i++) {
        var item = cast[i]
        if (!item || item.enabled === false) continue
        if (normalizeKey(item.name) === key) return i
        var aliases = String(item.aliases || '').split(/[,，、/|]/)
        for (var j = 0; j < aliases.length; j++) {
          if (normalizeKey(aliases[j]) === key) return i
        }
      }
      return -1
    }

    // --- CSS generation --------------------------------------------------------

    function quoteCss(appearance) {
      var weight = appearance.quoteWeight
      var mix = appearance.quoteMix
      var base = '.' + SPAN_CLASS + ' { color: var(--bubble-color, var(--row-color, var(--fork-accent, inherit))); font-weight: ' + weight + '; }'
      if (mix >= 100) return base
      return [
        '@supports (color: color-mix(in srgb, red, blue)) {',
        '  .' + SPAN_CLASS + ' { color: color-mix(in srgb, var(--bubble-color, var(--row-color, var(--fork-accent, CanvasText))) ' + mix + '%, var(--fork-ink, CanvasText)); font-weight: ' + weight + '; }',
        '}',
        base
      ].join('\n')
    }

    function avatarCss(appearance) {
      var parts = []
      if (appearance.avatarRing) {
        parts.push(
          '.fork-bubble .' + PH_CLASS + ' {',
          '  box-shadow:',
          '    inset 0 0 0 1.5px color-mix(in srgb, var(--bubble-color) 62%, transparent),',
          '    inset 0 -8px 16px -10px color-mix(in srgb, var(--bubble-color) 55%, transparent),',
          '    0 1px 3px rgb(0 0 0 / .15);',
          '}'
        )
        parts.push(
          '@supports (color: color-mix(in srgb, red, blue)) {',
          '  .fork-bubble .' + PH_CLASS + ' {',
          '    background: radial-gradient(135% 125% at 30% 18%,',
          '      color-mix(in srgb, var(--bubble-color) 34%, var(--fk-current-bgSolid, Canvas)) 0%,',
          '      color-mix(in srgb, var(--bubble-color) 10%, var(--fk-current-bgSolid, Canvas)) 72%);',
          '  }',
          '}'
        )
      }
      if (appearance.avatarGlyph) {
        parts.push(
          '@supports (color: color-mix(in srgb, red, blue)) {',
          '  .fork-bubble .' + PH_CLASS + ' .' + GLYPH_CLASS + ' {',
          '    font: 700 1.5em/1 var(--fork-font-reading, serif);',
          '    background: linear-gradient(170deg,',
          '      color-mix(in srgb, var(--bubble-color) 40%, CanvasText) 0%,',
          '        var(--bubble-color) 100%);',
          '    -webkit-background-clip: text;',
          '    background-clip: text;',
          '    color: transparent;',
          '    text-shadow: 0 1px 0 color-mix(in srgb, var(--bubble-color) 28%, Canvas);',
          '  }',
          '}'
        )
      }
      return parts.join('\n')
    }

    function castRules(cast) {
      var out = []
      for (var i = 0; i < cast.length; i++) {
        var item = cast[i]
        if (!item || item.enabled === false || !item.color) continue
        out.push('.fork-bubble.' + CAST_PREFIX + i + ' { --bubble-color: ' + item.color + ' !important; --bubble-name-ink: ' + item.color + ' !important; }')
      }
      return out.join('\n')
    }

    var STUDIO_CSS = [
      // The host mounts this panel straight into betterSidebar's pane content,
      // which is `flex:1; min-height:0; overflow:hidden`. Without claiming the
      // remaining height ourselves the panel is clipped and cannot be scrolled.
      '.dsh-bq-studio { display: flex; flex-direction: column; gap: 12px; padding: 14px 12px 22px; font-size: 13px; line-height: 1.55; flex: 1 1 auto; min-height: 0; height: 100%; max-height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; box-sizing: border-box; color: var(--dsh-tavern-accent-ink, var(--fork-ink, CanvasText)); }',
      '.dsh-bq-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: none; }',
      '.dsh-bq-tab { padding: 4px 11px; border-radius: 8px; border: 1px solid var(--dsh-tavern-accent-border, rgba(0,0,0,.18)); background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }',
      '.dsh-bq-tab.on { background: var(--dsh-tavern-accent-soft, rgba(0,0,0,.07)); border-color: var(--dsh-tavern-accent-active, currentColor); }',
      '.dsh-bq-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }',
      '.dsh-bq-field-label { font-size: 12px; opacity: .78; }',
      '.dsh-bq-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }',
      '.dsh-bq-row > input { flex: 1 1 auto; min-width: 0; }',
      '.dsh-bq-input { padding: 5px 8px; border-radius: 7px; border: 1px solid var(--dsh-tavern-accent-border, rgba(0,0,0,.18)); background: transparent; color: inherit; font: inherit; font-size: 12px; }',
      '.dsh-bq-btn { padding: 5px 12px; border-radius: 8px; border: 1px solid var(--dsh-tavern-accent-border, rgba(0,0,0,.18)); background: var(--dsh-tavern-accent-soft, rgba(0,0,0,.06)); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }',
      '.dsh-bq-btn[disabled] { opacity: .5; cursor: default; }',
      '.dsh-bq-btn.primary { background: var(--dsh-tavern-accent-active, currentColor); color: Canvas; }',
      '.dsh-bq-hint { font-size: 11px; opacity: .66; }',
      '.dsh-bq-warn { font-size: 11px; color: var(--dsh-tavern-accent-error, #c64545); }',
      '.dsh-bq-preview { padding: 10px; border-radius: 10px; background: var(--dsh-tavern-accent-cream, rgba(127,127,127,.08)); }',
      '.dsh-bq-pv-row { display: flex; gap: 9px; align-items: flex-start; }',
      '.dsh-bq-pv-avatar { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font-weight: 700; color: transparent; background: linear-gradient(170deg, color-mix(in srgb, var(--bubble-color) 40%, CanvasText), var(--bubble-color)); -webkit-background-clip: text; background-clip: text; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--bubble-color) 62%, transparent); }',
      '.dsh-bq-pv-body { flex: 1 1 auto; min-width: 0; }',
      '.dsh-bq-pv-name { font-size: 11px; opacity: .72; }',
      '.dsh-bq-pv-line { font-size: 12px; }',
      '.dsh-bq-cast-item { display: grid; grid-template-columns: 1fr 1.2fr 54px 26px; gap: 6px; align-items: center; margin-bottom: 6px; }',
      '.dsh-bq-textarea { width: 100%; min-height: 84px; max-height: 48vh; flex: none; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--dsh-tavern-accent-border, rgba(0,0,0,.18)); background: transparent; color: inherit; font: inherit; font-size: 12px; resize: vertical; box-sizing: border-box; }',
      '.dsh-bq-block { padding: 8px 9px; border-radius: 8px; background: var(--dsh-tavern-accent-cream, rgba(127,127,127,.08)); white-space: pre-wrap; word-break: break-word; font-size: 11px; max-height: 160px; overflow: auto; }'
    ].join('\n')

    // --- stable name-seeded colour ---------------------------------------------

    // FNV-1a, 32 bit. Deterministic across sessions.
    function hashName(name) {
      var text = String(name || '')
      var h = 0x811c9dc5
      for (var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h >>> 0
    }

    function speakerColor(name, appearance) {
      var a = appearance || DEFAULT_APPEARANCE
      var hsh = hashName(name)
      var spread = a.randomSpread
      var hue = (((hsh % 360) + a.randomHue) % 360 + 360) % 360
      var offset = spread > 0 ? (hsh >>> 8) % (spread + 1) : 0
      var sat = a.randomSat + offset - Math.floor(spread / 2)
      if (sat < 15) sat = 15
      if (sat > 95) sat = 95
      var light = a.randomLight + (((hsh >>> 16) % (spread + 1)) - Math.floor(spread / 2))
      if (light < 30) light = 30
      if (light > 62) light = 62
      return 'hsl(' + hue + ' ' + sat + '% ' + light + '%)'
    }

    // --- DOM decorators (unchanged semantics) ----------------------------------

    function isFallbackBubble(row) {
      if (!row || !row.style || typeof row.style.getPropertyValue !== 'function') return false
      var value = String(row.style.getPropertyValue('--bubble-color') || '').trim().toLowerCase()
      return value === FALLBACK_COLOR
    }

    function rowAlias(row) {
      var alias = row && row.getAttribute ? row.getAttribute('data-alias') : ''
      if (alias) return alias
      var name = row && row.querySelector ? row.querySelector('.fork-bubble-name') : null
      return name && name.textContent ? name.textContent.replace(/\s+/g, ' ').trim() : ''
    }

    function ruleFor(alias, color) {
      var esc
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') esc = CSS.escape(alias)
      else esc = String(alias).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return '.fork-bubble[data-alias="' + esc + '"]{--fork-figure-fallback:' + color + ';--bubble-name-ink:' + color + ';}'
    }

    function splitQuotes(text) {
      var parts = [], last = 0, match
      QUOTE_RE.lastIndex = 0
      while ((match = QUOTE_RE.exec(text)) !== null) {
        if (match.index > last) parts.push({ text: text.slice(last, match.index), quote: false })
        parts.push({ text: match[0], quote: true })
        last = match.index + match[0].length
      }
      if (!parts.length) return null
      if (last < text.length) parts.push({ text: text.slice(last), quote: false })
      return parts
    }

    function collectTextNodes(root, out) {
      var kids = root && root.childNodes ? root.childNodes : []
      for (var i = 0; i < kids.length; i++) {
        var node = kids[i]
        if (node.nodeType === 3) { out.push(node); continue }
        if (node.nodeType !== 1) continue
        var cls = node.className || ''
        if (typeof cls === 'string' && cls.split(/\s+/).indexOf(SPAN_CLASS) >= 0) continue
        collectTextNodes(node, out)
      }
    }

    function decorateLine(line) {
      var nodes = []
      collectTextNodes(line, nodes)
      var changed = false
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i], value = node.nodeValue
        if (!value || value.indexOf('「') < 0 || !node.parentNode) continue
        var parts = splitQuotes(value)
        if (!parts) continue
        var frag = document.createDocumentFragment()
        for (var j = 0; j < parts.length; j++) {
          var part = parts[j]
          if (!part.quote) {
            frag.appendChild(document.createTextNode(part.text))
            continue
          }
          var span = document.createElement('span')
          span.className = SPAN_CLASS
          span.textContent = part.text
          frag.appendChild(span)
        }
        node.parentNode.replaceChild(frag, node)
        changed = true
      }
      return changed
    }

    function glyphTextOf(ph) {
      var out = ''
      var kids = ph.childNodes || []
      for (var i = 0; i < kids.length; i++) {
        var node = kids[i]
        if (node.nodeType === 3) out += node.nodeValue || ''
        else if (typeof node.textContent === 'string') out += node.textContent
      }
      return out
    }

    function decorateAvatarPh(ph) {
      if (!ph || ph.nodeType !== 1 || !ph.childNodes) return false
      for (var i = 0; i < ph.childNodes.length; i++) {
        var node = ph.childNodes[i]
        if (node.nodeType !== 1) continue
        var cls = typeof node.className === 'string' ? node.className : ''
        if (cls.split(/\s+/).indexOf(GLYPH_CLASS) >= 0) return false
      }
      var text = glyphTextOf(ph)
      if (!text) return false
      var span = document.createElement('span')
      span.className = GLYPH_CLASS
      span.textContent = text
      for (var j = ph.childNodes.length - 1; j >= 0; j--) {
        if (ph.removeChild) ph.removeChild(ph.childNodes[j])
      }
      if (ph.appendChild) ph.appendChild(span)
      return true
    }

    function decorateEmptyAvatar(avatar) {
      if (!avatar || avatar.nodeType !== 1 || !avatar.childNodes) return false
      var kids = avatar.childNodes
      for (var i = 0; i < kids.length; i++) {
        var node = kids[i]
        if (node.nodeType === 1) return false
        if (node.nodeType === 3 && (node.nodeValue || '').trim()) return false
      }
      var row = avatar.closest ? avatar.closest(ROW_SELECTOR) : null
      var text = ''
      var name = row && row.querySelector ? row.querySelector('.fork-bubble-name') : null
      if (name && name.textContent) text = name.textContent.replace(/\s+/g, '')
      if (!text && row) text = rowAlias(row)
      var glyph = text ? Array.from(text)[0] : ''
      if (!glyph) return false
      var cls = typeof avatar.className === 'string' ? avatar.className : ''
      var parts = cls ? cls.split(/\s+/) : []
      if (parts.indexOf(PH_CLASS) < 0) {
        parts.push(PH_CLASS)
        avatar.className = parts.join(' ')
      }
      var span = document.createElement('span')
      span.className = GLYPH_CLASS
      span.textContent = glyph
      if (avatar.appendChild) avatar.appendChild(span)
      return true
    }

    function decorateAvatar(el) {
      if (!el || el.nodeType !== 1) return false
      var cls = typeof el.className === 'string' ? el.className : ''
      if (cls.split(/\s+/).indexOf(PH_CLASS) >= 0) return decorateAvatarPh(el)
      return decorateEmptyAvatar(el)
    }

    // --- cast class on rows -----------------------------------------------------

    function classNamesOf(el) {
      if (!el) return []
      if (el.classList && typeof el.classList.length === 'number') {
        var list = []
        for (var i = 0; i < el.classList.length; i++) list.push(el.classList[i])
        return list
      }
      return String(el.className || '').split(/\s+/).filter(Boolean)
    }

    function setClassNames(el, names) {
      if (!el) return
      if (el.classList) {
        el.className = names.join(' ')
        return
      }
      el.className = names.join(' ')
    }

    function castIndexForRow(row, cast) {
      if (!row) return -1
      var nameEl = row.querySelector ? row.querySelector('.fork-bubble-name') : null
      var label = nameEl && nameEl.textContent ? nameEl.textContent : ''
      var idx = castMatch(label, cast)
      if (idx < 0) idx = castMatch(rowAlias(row), cast)
      return idx
    }

    // Idempotent: rewrites the class list only when the wanted index differs.
    // Only rows the host rendered with the flat fallback colour may take a cast colour —
    // a figure that already has its own 形象色/素材色 keeps it untouched.
    function ensureCastClass(row, cast) {
      if (!row || row.nodeType !== 1) return false
      var idx = isFallbackBubble(row) ? castIndexForRow(row, cast) : -1
      var want = idx >= 0 ? CAST_PREFIX + idx : null
      var names = classNamesOf(row)
      var current = null
      for (var i = 0; i < names.length; i++) {
        if (names[i].indexOf(CAST_PREFIX) === 0) { current = names[i]; break }
      }
      if (current === want) return false
      var kept = []
      for (var j = 0; j < names.length; j++) {
        if (names[j].indexOf(CAST_PREFIX) !== 0) kept.push(names[j])
      }
      if (want) kept.push(want)
      setClassNames(row, kept)
      return true
    }

    // --- fixed-prefix bubbles ($bubble[handle|name|variant|action|display|voice]) ---

    function parseSyntheticLine(text) {
      var match = SYNTHETIC_LINE.exec(String(text == null ? '' : text))
      if (!match) return null
      var parts = match[1].split('|')
      // Exactly six fields and none of them blank: the owner's rule is "任何一段都不准留空",
      // so a line missing any field is left as plain text instead of being guessed at.
      if (parts.length !== 6) return null
      var trimmed = []
      for (var i = 0; i < 6; i++) {
        var value = String(parts[i] == null ? '' : parts[i]).trim()
        if (!value) return null
        trimmed.push(value)
      }
      var display = trimmed[4]
      var thought = display.length > 1 && display.charAt(0) === '*' && display.charAt(display.length - 1) === '*'
      if (thought) {
        display = display.slice(1, -1).trim()
        if (!display) return null
      }
      return {
        alias: trimmed[0].toLowerCase(),
        name: trimmed[1],
        variant: trimmed[2],
        action: trimmed[3],
        display: display,
        voice: trimmed[5],
        thought: thought
      }
    }

    function wrapField(raw, open, close) {
      var text = String(raw == null ? '' : raw)
      if (!text) return ''
      if (text.charAt(0) === open) return text
      return open + text + close
    }

    function formatSyntheticLine(parsed) {
      var out = ''
      if (parsed && parsed.action) out += wrapField(parsed.action, '（', '）')
      if (parsed && parsed.display) out += wrapField(parsed.display, '「', '」')
      return out
    }

    // The pack keys mood images by emotion id; the line names the emotion by id or label.
    function moodImageFor(figure, variant) {
      if (!figure) return ''
      var text = String(variant || '').trim()
      var list = Array.isArray(figure.emotions) ? figure.emotions : []
      var hit = null
      for (var i = 0; i < list.length && !hit; i++) {
        if (String(list[i].id || '') === text || String(list[i].label || '') === text) hit = list[i]
      }
      for (var j = 0; j < list.length && !hit; j++) {
        if (text && String(list[j].label || '').indexOf(text) === 0) hit = list[j]
      }
      var moods = figure.moods && typeof figure.moods === 'object' ? figure.moods : {}
      var key = hit && hit.id ? hit.id : text
      if (key && moods[key]) return moods[key]
      if (moods['default']) return moods['default']
      return figure.avatar || ''
    }

    // getDialogueBubbles carries the card's own asset pack roster under config.characters.
    function readFigureRows(data) {
      var config = data && (data.config || data.dialogue)
      return config && Array.isArray(config.characters) ? config.characters : null
    }

    function figureColor(figure) {
      return figure && /^#[0-9a-f]{6}$/i.test(String(figure.color || '')) ? figure.color : ''
    }

    // --- engine ----------------------------------------------------------------

    var CSS = quoteCss(DEFAULT_APPEARANCE)
    var AVATAR_CSS = avatarCss(DEFAULT_APPEARANCE)

    function createEngine() {
      var appearance = cloneDefaults()
      var cast = []
      var aliasColors = new Map()
      var pending = new Set()
      var scheduled = false
      var observer = null
      var root = null
      var styleEl = null
      var aliasEl = null
      var castEl = null
      var syntheticOn = false
      var sessionId = ''
      var figures = []
      var figuresSession = ''

      function refreshStyle() {
        if (styleEl) styleEl.textContent = quoteCss(appearance) + '\n' + avatarCss(appearance) + '\n' + STUDIO_CSS
        if (castEl) castEl.textContent = castRules(cast)
      }

      function syncAliasStyle() {
        if (!aliasEl) return
        var parts = []
        aliasColors.forEach(function (color, alias) { parts.push(ruleFor(alias, color)) })
        aliasEl.textContent = parts.join('\n')
      }

      // --- fixed-prefix bubbles ($bubble[handle|name|variant|action|display|voice]) ---
      function figureFor(parsed) {
        if (!figures || !figures.length) return null
        var alias = String(parsed.alias || '').toLowerCase()
        var name = String(parsed.name || '').trim()
        for (var i = 0; i < figures.length; i++) {
          if (String(figures[i].alias || '').toLowerCase() === alias) return figures[i]
        }
        for (var j = 0; j < figures.length; j++) {
          if (String(figures[j].name || '').trim() === name) return figures[j]
        }
        return null
      }

      // The dialogue-bubble roster is the card's own asset pack (avatars, colours, voices):
      // reading it through the same RPC the editor uses keeps us out of the stage.
      function loadFigures(id) {
        if (!id) return Promise.resolve(figures)
        return tavernRpc('getDialogueBubbles', {}, id).then(function (data) {
          var rows = readFigureRows(data)
          if (!rows) return figures
          figures = rows
          if (root) rescan()
          return figures
        }).catch(function () { return figures })
      }

      function buildSyntheticBubble(parsed) {
        var figure = figureFor(parsed)
        // Colour order: the card's pack colour first, then the local cast table, then a stable name colour.
        var color = figureColor(figure)
        if (!color) {
          var index = castMatch(parsed.name, cast)
          if (index >= 0 && cast[index] && cast[index].color) color = cast[index].color
        }
        if (!color) color = speakerColor(parsed.alias || parsed.name, appearance)
        var avatarSrc = moodImageFor(figure, parsed.variant)
        var doc = document
        var row = doc.createElement('div')
        row.className = 'fork-bubble' + (parsed.thought ? ' fork-bubble-thought' : '')
        row.setAttribute(SYNTHETIC_ATTR, '1')
        if (parsed.alias) row.setAttribute('data-alias', parsed.alias)
        if (figure && figure.voice) row.setAttribute('data-dsh-bq-figure-voice', String(figure.voice))
        if (figure && figure.voiceLang) row.setAttribute('data-dsh-bq-figure-lang', String(figure.voiceLang))
        row.style.setProperty('--bubble-color', color)
        row.style.setProperty('--bubble-name-ink', color)
        var portrait = doc.createElement('div')
        portrait.className = 'fork-bubble-portrait'
        var avatar = doc.createElement('span')
        avatar.className = 'fork-bubble-avatar'
        if (avatarSrc) {
          var img = doc.createElement('img')
          img.setAttribute('src', avatarSrc)
          img.setAttribute('alt', parsed.name)
          img.setAttribute('loading', 'lazy')
          avatar.appendChild(img)
        } else {
          avatar.className = 'fork-bubble-avatar fork-bubble-avatar-ph'
          avatar.textContent = Array.from(parsed.name)[0] || ''
        }
        portrait.appendChild(avatar)
        row.appendChild(portrait)
        var body = doc.createElement('div')
        body.className = 'fork-bubble-body'
        var head = doc.createElement('div')
        head.className = 'fork-bubble-head'
        var nameEl = doc.createElement('span')
        nameEl.className = 'fork-bubble-name'
        nameEl.textContent = parsed.name
        head.appendChild(nameEl)
        if (parsed.variant) {
          var mood = doc.createElement('span')
          mood.className = 'fork-bubble-mood is-neutral'
          mood.textContent = parsed.variant
          head.appendChild(mood)
        }
        body.appendChild(head)
        var textEl = doc.createElement('div')
        textEl.className = 'fork-bubble-text'
        var line = doc.createElement('span')
        line.className = 'fork-bubble-line'
        line.textContent = formatSyntheticLine(parsed)
        textEl.appendChild(line)
        body.appendChild(textEl)
        row.appendChild(body)
        if (parsed.voice) row.setAttribute('data-dsh-bq-voice', parsed.voice)
        return row
      }

      function replaceSyntheticLine(textNode) {
        var parsed = parseSyntheticLine(textNode && textNode.nodeValue)
        if (!parsed || !textNode.parentNode) return false
        var bubble = buildSyntheticBubble(parsed)
        var block = textNode.parentElement
        if (block && block.childNodes.length === 1 && block.parentNode) block.parentNode.replaceChild(bubble, block)
        else textNode.parentNode.replaceChild(bubble, textNode)
        return true
      }

      // Idempotent: once replaced, the text node is gone, so a rescan never doubles it.
      function scanSynthetics(container) {
        if (!syntheticOn || !container || container.nodeType !== 1) return false
        if (container.getAttribute && container.getAttribute(SYNTHETIC_ATTR) === '1') return false
        var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false)
        var hits = []
        var node = walker.nextNode()
        while (node) {
          if (SYNTHETIC_LINE.test(node.nodeValue || '') && !(node.parentElement && node.parentElement.closest && node.parentElement.closest('.fork-bubble'))) hits.push(node)
          node = walker.nextNode()
        }
        var changed = false
        for (var i = 0; i < hits.length; i++) if (replaceSyntheticLine(hits[i])) changed = true
        return changed
      }

      function scanRows(node) {
        if (!node || node.nodeType !== 1) return
        var rows = []
        if (node.matches && node.matches(ROW_SELECTOR)) rows.push(node)
        if (node.querySelectorAll) {
          var found = node.querySelectorAll(ROW_SELECTOR)
          for (var i = 0; i < found.length; i++) rows.push(found[i])
        }
        var changed = false
        for (var j = 0; j < rows.length; j++) {
          var row = rows[j]
          ensureCastClass(row, cast)
          if (!appearance.randomOn) continue
          if (castIndexForRow(row, cast) >= 0) continue
          if (!isFallbackBubble(row)) continue
          var alias = rowAlias(row)
          if (!alias || aliasColors.has(alias)) continue
          aliasColors.set(alias, speakerColor(alias, appearance))
          changed = true
        }
        if (changed) syncAliasStyle()
      }

      function addTarget(element) {
        if (element && element.nodeType === 1) pending.add(element)
      }

      function collect(node, selector) {
        if (!node || node.nodeType !== 1) return
        if (node.matches && node.matches(selector)) addTarget(node)
        if (node.querySelectorAll) {
          var found = node.querySelectorAll(selector)
          for (var i = 0; i < found.length; i++) addTarget(found[i])
        }
      }

      function flush() {
        scheduled = false
        var list = Array.from(pending)
        pending.clear()
        for (var i = 0; i < list.length; i++) {
          var element = list[i]
          scanRows(element)
          scanSynthetics(element)
          var decorate = null
          if (element.matches && element.matches(LINE_SELECTOR)) decorate = decorateLine
          else if (element.matches && element.matches(AVATAR_SELECTOR)) decorate = decorateAvatar
          if (decorate) {
            decorate(element)
          } else if (element.querySelectorAll) {
            var found = element.querySelectorAll(LINE_SELECTOR)
            for (var j = 0; j < found.length; j++) decorateLine(found[j])
            var phs = element.querySelectorAll(AVATAR_SELECTOR)
            for (var k = 0; k < phs.length; k++) decorateAvatar(phs[k])
          }
        }
      }

      function schedule() {
        if (scheduled) return
        scheduled = true
        if (typeof queueMicrotask === 'function') queueMicrotask(flush)
        else setTimeout(flush, 0)
      }

      function onMutations(records) {
        for (var i = 0; i < records.length; i++) {
          var record = records[i]
          if (record.type === 'attributes') {
            addTarget(record.target)
            continue
          }
          if (record.type === 'characterData') {
            var parent = record.target && record.target.parentElement
            var line = parent && parent.closest ? parent.closest(LINE_SELECTOR) : null
            if (line) addTarget(line)
            // Streaming prose grows character by character; the $bubble line only parses
            // once the closing bracket lands, so keep the paragraph queued for a rescan.
            else if (parent) addTarget(parent)
            continue
          }
          var added = record.addedNodes || []
          for (var j = 0; j < added.length; j++) {
            var node = added[j]
            if (!node) continue
            // React swaps whole text nodes when prose updates; the text node itself carries
            // no bubble markup, so queue its parent for the synthetic-line scan.
            if (node.nodeType === 3) {
              addTarget(record.target)
              continue
            }
            if (node.nodeType !== 1) continue
            addTarget(node)
            collect(node, ROW_SELECTOR)
            collect(node, LINE_SELECTOR)
            collect(node, AVATAR_SELECTOR)
          }
        }
        if (pending.size) schedule()
      }

      function rescan() {
        if (!root) return
        aliasColors.clear()
        syncAliasStyle()
        scanRows(root)
        scanSynthetics(root)
        collect(root, LINE_SELECTOR)
        collect(root, AVATAR_SELECTOR)
        flush()
      }

      function mount() {
        if (typeof document === 'undefined' || !document.documentElement) return function () {}
        root = document.documentElement
        var head = document.head || root

        styleEl = document.getElementById(STYLE_ID)
        if (!styleEl) {
          styleEl = document.createElement('style')
          styleEl.id = STYLE_ID
        }
        if (!styleEl.parentNode) head.appendChild(styleEl)

        aliasEl = document.getElementById(ALIAS_STYLE_ID)
        if (!aliasEl) {
          aliasEl = document.createElement('style')
          aliasEl.id = ALIAS_STYLE_ID
          head.appendChild(aliasEl)
        }
        castEl = document.getElementById(CAST_STYLE_ID)
        if (!castEl) {
          castEl = document.createElement('style')
          castEl.id = CAST_STYLE_ID
          head.appendChild(castEl)
        }

        refreshStyle()
        rescan()

        if (typeof MutationObserver === 'function') {
          observer = new MutationObserver(onMutations)
          observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] })
        }

        return function dispose() {
          if (observer) observer.disconnect()
          observer = null
          var ids = [STYLE_ID, ALIAS_STYLE_ID, CAST_STYLE_ID]
          for (var i = 0; i < ids.length; i++) {
            var own = document.getElementById(ids[i])
            if (own && own.parentNode) own.parentNode.removeChild(own)
          }
          var spans = document.querySelectorAll('.' + SPAN_CLASS)
          for (var k = 0; k < spans.length; k++) {
            var span = spans[k]
            if (span.parentNode) span.parentNode.replaceChild(document.createTextNode(span.textContent || ''), span)
          }
          var glyphs = document.querySelectorAll('.' + GLYPH_CLASS)
          for (var m = 0; m < glyphs.length; m++) {
            var glyph = glyphs[m]
            if (glyph.parentNode) glyph.parentNode.replaceChild(document.createTextNode(glyph.textContent || ''), glyph)
          }
        }
      }

      function apply(next, activeSessionId) {
        if (next && next.appearance) appearance = normalizeAppearance(next.appearance)
        if (next && next.cast) cast = normalizeCast(next.cast)
        if (typeof activeSessionId === 'string') sessionId = activeSessionId
        // Recognition and rendering always run. The switches only decide whether the
        // fixed-prefix instruction is injected, so turning one off never hides a line.
        syntheticOn = true
        if (sessionId && sessionId !== figuresSession) {
          figuresSession = sessionId
          loadFigures(sessionId)
        }
        refreshStyle()
        aliasColors.clear()
        syncAliasStyle()
        if (root) rescan()
      }

      return {
        mount: mount,
        apply: apply,
        reloadFigures: function (id) {
          var target = typeof id === 'string' && id ? id : sessionId
          figuresSession = target
          return loadFigures(target)
        },
        state: function () { return { appearance: appearance, cast: cast, syntheticOn: syntheticOn, sessionId: sessionId, figures: figures.length } }
      }
    }

    // --- Tavern HTTP RPC (the same carrier the built-in editor uses) ------------

    function tavernRpc(method, args, sessionId) {
      var body = {}
      if (args) for (var key in args) if (Object.prototype.hasOwnProperty.call(args, key)) body[key] = args[key]
      if (sessionId) body.sessionId = sessionId
      return fetch(RPC_BASE + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin'
      }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      }).then(function (data) {
        if (data && Object.prototype.hasOwnProperty.call(data, 'result')) return data.result
        return data
      })
    }

    function readDialogueState(sessionId) {
      return tavernRpc('getAssetEngineSettings', {}, sessionId).then(function (current) {
        var values = (current && current.values) || {}
        var dialogue = values.dialogue || {}
        var injection = dialogue.injection || {}
        return {
          revision: current ? current.revision : null,
          dialogue: dialogue,
          template: String(injection.template == null ? '' : injection.template),
          extra: String(injection.extra == null ? '' : injection.extra),
          placement: injection.placement === undefined ? null : injection.placement
        }
      })
    }

    // The owner's two blocks are joined verbatim: nothing is appended, nothing is rewritten.
    // (appendPlaceholders in savePrompt is the only place that ever adds the host-required
    //  placeholders, and only after an explicit second click.)
    function buildOverrideTemplate(format, voice) {
      var f = String(format == null ? '' : format)
      var v = String(voice == null ? '' : voice)
      return [f, v].filter(function (part) { return part.trim() }).join('\n\n')
    }

    function sectionText(sections, key) {
      if (!Array.isArray(sections)) return ''
      for (var i = 0; i < sections.length; i++) {
        var section = sections[i]
        if (section && section.key === key) return String(section.text == null ? '' : section.text)
      }
      return ''
    }

    function readSections(sessionId) {
      return tavernRpc('getDialogueBubbles', {}, sessionId).then(function (data) {
        if (!data) return []
        if (Array.isArray(data.sections)) return data.sections
        if (data.preview && Array.isArray(data.preview.sections)) return data.preview.sections
        return []
      }).catch(function () { return [] })
    }

    function saveDialogueState(sessionId, draft) {
      return tavernRpc('getAssetEngineSettings', {}, sessionId).then(function (current) {
        var dialogue = (current && current.values && current.values.dialogue) || {}
        var injection = {}
        var prev = dialogue.injection || {}
        for (var key in prev) if (Object.prototype.hasOwnProperty.call(prev, key)) injection[key] = prev[key]
        injection.template = String(draft.template == null ? '' : draft.template)
        injection.extra = String(draft.extra == null ? '' : draft.extra)
        var patchDialogue = {}
        for (var d in dialogue) if (Object.prototype.hasOwnProperty.call(dialogue, d)) patchDialogue[d] = dialogue[d]
        patchDialogue.injection = injection
        return tavernRpc('saveAssetEngineSettings', {
          expectedRevision: current ? current.revision : undefined,
          patch: { dialogue: patchDialogue }
        }, sessionId)
      })
    }

    // --- panel UI -------------------------------------------------------------

    function Field(label, node, hint) {
      return h('label', { className: 'dsh-bq-field' },
        h('span', { className: 'dsh-bq-field-label' }, label),
        node,
        hint ? h('span', { className: 'dsh-bq-hint' }, hint) : null)
    }

    function NumberInput(value, onChange, min, max, step) {
      return h('input', {
        className: 'dsh-bq-input',
        type: 'number',
        value: value,
        min: min,
        max: max,
        step: step || 1,
        onChange: function (event) { onChange(Number(event.target.value)) }
      })
    }

    function Toggle(value, onChange, label) {
      return h('label', { className: 'dsh-bq-row', style: { cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: value !== false, onChange: function (event) { onChange(event.target.checked) } }),
        h('span', null, label))
    }

    function defaultSettings() {
      return {
        appearance: cloneDefaults(),
        cast: [],
        draft: { format: '', voice: '', template: '', baseTemplate: '', extra: '' },
        synthetic: { defaultOn: false, sessions: {} },
        updatedAt: null
      }
    }

    function normalizeSynthetic(input) {
      var src = input && typeof input === 'object' ? input : {}
      var sessions = {}
      var raw = src.sessions && typeof src.sessions === 'object' ? src.sessions : {}
      for (var key in raw) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
        if (typeof raw[key] === 'boolean') sessions[rowKey(key)] = raw[key]
      }
      return { defaultOn: src.defaultOn === true, sessions: sessions }
    }

    function rowKey(value) { return String(value == null ? '' : value).slice(0, 128) }

    // Session switch overrides the default; an unset session follows the default switch.
    function syntheticEnabled(synthetic, sessionId) {
      var conf = synthetic || { defaultOn: false, sessions: {} }
      var id = rowKey(sessionId)
      if (id && Object.prototype.hasOwnProperty.call(conf.sessions || {}, id)) return conf.sessions[id] === true
      return conf.defaultOn === true
    }

    // Adds or removes the fixed-prefix block inside 补充要求, leaving the owner's own text intact.
    function withSynPrompt(extra, on) {
      var base = String(extra == null ? '' : extra)
      var stripped = base.replace(/\n*\[固定气泡格式\][\s\S]*?\[\/固定气泡格式\]\n*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      if (!on) return stripped
      return stripped ? stripped + '\n\n' + SYN_PROMPT : SYN_PROMPT
    }

    function normalizeSettings(input) {
      var src = input || {}
      var out = defaultSettings()
      out.appearance = normalizeAppearance(src.appearance)
      out.cast = normalizeCast(src.cast)
      var draft = src.draft || {}
      out.draft = {
        format: String(draft.format == null ? '' : draft.format),
        voice: String(draft.voice == null ? '' : draft.voice),
        template: String(draft.template == null ? '' : draft.template),
        baseTemplate: String(draft.baseTemplate == null ? '' : draft.baseTemplate),
        extra: String(draft.extra == null ? '' : draft.extra)
      }
      out.updatedAt = src.updatedAt || null
      out.synthetic = normalizeSynthetic(src.synthetic)
      return out
    }

    function BubbleStudioPanel(props) {
      var studio = props.studio
      var sessionId = props.gameId || ''
      var state = React.useState(normalizeSettings(props.initial))
      var settings = state[0]
      var setSettings = state[1]
      var tabState = React.useState('appearance')
      var tab = tabState[0]
      var setTab = tabState[1]
      var msgState = React.useState('')
      var message = msgState[0]
      var setMessage = msgState[1]
      var liveState = React.useState(null)
      var live = liveState[0]
      var setLive = liveState[1]

      React.useEffect(function () {
        var cancelled = false
        if (!studio.read) return undefined
        studio.read().then(function (fresh) {
          if (!cancelled && fresh) setSettings(fresh)
        }).catch(function () {})
        return function () { cancelled = true }
      }, [])

      // Keep the host half's per-session switch in step with what this panel shows.
      React.useEffect(function () { pushSynthetic(settings) }, [settings.synthetic, sessionId])

      function patch(part) {
        var next = normalizeSettings(settings)
        for (var key in part) if (Object.prototype.hasOwnProperty.call(part, key)) next[key] = part[key]
        setSettings(next)
        return next
      }

      function persist(next) {
        var payload = {}
        var base = props.getRaw ? props.getRaw() : null
        if (base && typeof base === 'object') {
          for (var key in base) if (Object.prototype.hasOwnProperty.call(base, key)) payload[key] = base[key]
        }
        payload[DATA_KEY] = Object.assign({}, next, { updatedAt: new Date().toISOString() })
        return studio.save(payload).then(function () {
          studio.apply(next)
          setMessage('已保存')
          return next
        }).catch(function (error) {
          setMessage('保存失败：' + (error && error.message ? error.message : error))
        })
      }

      function updateAppearance(key, value) {
        var next = normalizeSettings(settings)
        var appearance = normalizeAppearance(next.appearance)
        appearance[key] = value
        next.appearance = appearance
        setSettings(next)
        studio.apply(next)
      }

      function updateCast(index, key, value) {
        var next = normalizeSettings(settings)
        var item = Object.assign({}, next.cast[index] || { name: '', aliases: '', color: '#7c9cf5', enabled: true })
        item[key] = value
        next.cast[index] = item
        setSettings(next)
        studio.apply(next)
      }

      function addCast() {
        var next = normalizeSettings(settings)
        next.cast.push({ name: '新角色', aliases: '', color: '#7c9cf5', enabled: true })
        setSettings(next)
        studio.apply(next)
      }

      function removeCast(index) {
        var next = normalizeSettings(settings)
        next.cast.splice(index, 1)
        setSettings(next)
        studio.apply(next)
      }

      function loadPrompt() {
        if (!sessionId) { setMessage('请先打开一局游戏'); return }
        setMessage('正在读取…')
        readDialogueState(sessionId).then(function (stateData) {
          var next = normalizeSettings(settings)
          if (!next.draft.template || next.draft.template === next.draft.baseTemplate) next.draft.template = stateData.template
          next.draft.baseTemplate = stateData.template
          next.draft.extra = stateData.extra
          setSettings(next)
          setLive({ revision: stateData.revision, placement: stateData.placement, sections: [], loaded: true })
          return readSections(sessionId).then(function (sections) {
            var filled = normalizeSettings(next)
            if (!filled.draft.format) filled.draft.format = sectionText(sections, 'format')
            if (!filled.draft.voice) filled.draft.voice = sectionText(sections, 'voice')
            setSettings(filled)
            setLive({ revision: stateData.revision, placement: stateData.placement, sections: sections, loaded: true })
            setMessage('已读取当前注入')
          })
        }).catch(function (error) {
          setMessage('读取失败：' + (error && error.message ? error.message : error) + '（可退回 v0.8 的官方编辑器）')
        })
      }

      // The owner's text is submitted exactly as typed. No placeholder, no marker, no
      // trailing hint is ever appended behind their back: if the host refuses the template
      // the refusal is reported verbatim and appending the placeholders stays an explicit
      // second click ("补占位符后保存") that says up front what it will add.
      function savePrompt(appendPlaceholders) {
        if (!sessionId) { setMessage('请先打开一局游戏'); return }
        var draft = settings.draft || {}
        var template = String(draft.template || '')
        if (!template.trim()) {
          var f = String(draft.format || '')
          var v = String(draft.voice || '')
          if (f.trim() || v.trim()) template = [f, v].filter(function (part) { return String(part).trim() }).join('\n\n')
          else template = String(draft.baseTemplate || '')
        }
        if (appendPlaceholders && template.trim()) {
          template = String(template).replace(/\s+$/, '') + '\n\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}'
        }
        setMessage(appendPlaceholders ? '正在追加占位符并保存…' : '正在原样保存…')
        saveDialogueState(sessionId, { template: template, extra: draft.extra }).then(function () {
          var next = normalizeSettings(settings)
          next.draft.baseTemplate = template
          setSettings(next)
          setLive(Object.assign({}, live || {}, { shimNeeded: false }))
          setMessage(appendPlaceholders ? '已保存（已在你文本末尾追加三行占位符）' : '已保存，下一轮生效')
          return readSections(sessionId).then(function (sections) {
            var nextLive = Object.assign({}, live || {}, { sections: sections })
            setLive(nextLive)
          })
        }).catch(function (error) {
          var raw = error && error.message ? error.message : String(error)
          if (!appendPlaceholders && /占位符/.test(raw)) {
            setLive(Object.assign({}, live || {}, { shimNeeded: true }))
            setMessage('宿主拒绝了原样模板：' + raw + '。你的文本没有被改动；要保存需点「补占位符后保存」，它只在你文本末尾追加三行占位符。')
            return
          }
          setMessage('保存失败：' + raw + '（官方编辑器通道不可用时可改用舞台设置 › 提示词）')
        })
      }

      function setSynSession(on) {
        var next = normalizeSettings(settings)
        var id = sessionId || (studio.sessionId ? studio.sessionId() : '')
        if (id) next.synthetic.sessions[id] = on === true
        else setMessage('没识别到当前会话，开关未落到具体会话')
        setSettings(next)
        studio.apply(next, id)
        persist(next)
      }

      // Standard API only: the host half registers a scoped `ctx.systemPrompt.section()`
      // for this session. Nothing is written to 气泡 injection, system-append, any
      // settings document or file — the section disappears when the agent unloads.
      function injectSynPrompt(on) {
        if (!sessionId) { setMessage('请先打开一局游戏'); return }
        setMessage(on ? '正在注册提示词段落…' : '正在撤销提示词段落…')
        fetch(SYN_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ sessionId: sessionId, on: !!on })
        }).then(function (response) {
          if (!response.ok) return Promise.reject(new Error('HTTP ' + response.status))
          return response.json()
        }).then(function (data) {
          if (on && data && data.active === false) {
            setMessage('开关已记下：这局还没启动，进入下一轮时自动注册；卸载或重启即消失')
            return
          }
          setMessage(on ? '已按标准 API 注册本会话的 system 段落（不写任何配置与文件）' : '已撤销本会话的 system 段落')
        }).catch(function (error) {
          setMessage('失败：' + (error && error.message ? error.message : error))
        })
      }

      // Push the per-session switch to the host half whenever it changes.
      var lastSynPush = ''
      function pushSynthetic(next) {
        var conf = (next && next.synthetic) || { defaultOn: false, sessions: {} }
        var id = sessionId || ''
        var on = id ? syntheticEnabled(conf, id) : false
        var key = id + '|' + (on ? 1 : 0) + '|' + (conf.defaultOn ? 1 : 0)
        if (key === lastSynPush) return
        lastSynPush = key
        fetch(SYN_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ sessionId: id, on: on, defaultOn: conf.defaultOn === true })
        }).catch(function () { lastSynPush = '' })
      }

      var tabs = h('div', { className: 'dsh-bq-tabs' },
        ['appearance', 'cast', 'prompt', 'syn'].map(function (key) {
          var labels = { appearance: '外观', cast: '角色表', prompt: '气泡提示词', syn: '合成气泡' }
          return h('button', {
            key: key,
            type: 'button',
            className: 'dsh-bq-tab' + (tab === key ? ' on' : ''),
            onClick: function () { setTab(key) }
          }, labels[key])
        }))

      var body = null

      if (tab === 'appearance') {
        var sampleColor = '#7c9cf5'
        body = h('div', null,
          h('div', { className: 'dsh-bq-preview' },
            h('div', { className: 'dsh-bq-pv-row', style: { '--bubble-color': sampleColor } },
              h('div', { className: 'dsh-bq-pv-avatar' }, '露'),
              h('div', { className: 'dsh-bq-pv-body' },
                h('div', { className: 'dsh-bq-pv-name' }, '露娜'),
                h('div', { className: 'dsh-bq-pv-line' },
                  h('span', null, '（提起裙摆）'),
                  h('span', { className: 'dsh-bq-quote' }, '「我把水带来了。」'),
                  h('span', null, '她转身去看星脉。'))))),
          Field('台词字重', NumberInput(settings.appearance.quoteWeight, function (v) { updateAppearance('quoteWeight', v) }, 300, 900, 100), '300 细 / 500 常规 / 700 粗'),
          Field('台词取色比例（%）', NumberInput(settings.appearance.quoteMix, function (v) { updateAppearance('quoteMix', v) }, 30, 100, 1), '100 为纯角色色，数值越低越接近正文墨色'),
          Toggle(settings.appearance.avatarRing, function (v) { updateAppearance('avatarRing', v) }, '头像占位加色环与淡底'),
          Toggle(settings.appearance.avatarGlyph, function (v) { updateAppearance('avatarGlyph', v) }, '头像占位用渐变艺术字'),
          Toggle(settings.appearance.randomOn, function (v) { updateAppearance('randomOn', v) }, '未配色的角色按名字生成稳定随机色'),
          Field('随机色基准色相（°）', NumberInput(settings.appearance.randomHue, function (v) { updateAppearance('randomHue', v) }, 0, 359), '整体旋转色轮，让随机色贴合作品基调'),
          Field('随机色饱和度（%）', NumberInput(settings.appearance.randomSat, function (v) { updateAppearance('randomSat', v) }, 20, 90), ''),
          Field('随机色亮度（%）', NumberInput(settings.appearance.randomLight, function (v) { updateAppearance('randomLight', v) }, 25, 65), ''),
          Field('随机色抖动幅度', NumberInput(settings.appearance.randomSpread, function (v) { updateAppearance('randomSpread', v) }, 0, 20), '0 为同基准色，越大越参差'))
      } else if (tab === 'cast') {
        var items = settings.cast.map(function (item, index) {
          return h('div', { className: 'dsh-bq-cast-item', key: index },
            h('input', { className: 'dsh-bq-input', value: item.name, placeholder: '显示名', onChange: function (e) { updateCast(index, 'name', e.target.value) } }),
            h('input', { className: 'dsh-bq-input', value: item.aliases, placeholder: '称呼/触发词，逗号分隔', onChange: function (e) { updateCast(index, 'aliases', e.target.value) } }),
            h('input', { className: 'dsh-bq-input', type: 'color', value: item.color, onChange: function (e) { updateCast(index, 'color', e.target.value) } }),
            h('button', { type: 'button', className: 'dsh-bq-btn', title: '删除', onClick: function () { removeCast(index) } }, '×'))
        })
        body = h('div', null,
          h('div', { className: 'dsh-bq-hint' }, '角色表由本插件独立维护，不读取舞台人物数据；只对没有舞台配置色的角色生效，已有形象色/素材色的角色保持原色。'),
          h('div', { className: 'dsh-bq-cast-item' },
            h('span', { className: 'dsh-bq-field-label' }, '显示名'),
            h('span', { className: 'dsh-bq-field-label' }, '称呼/触发词'),
            h('span', { className: 'dsh-bq-field-label' }, '颜色'),
            h('span', null, '')),
          h('div', null, items),
          h('div', { className: 'dsh-bq-row' },
            h('button', { type: 'button', className: 'dsh-bq-btn', onClick: addCast }, '+ 新增角色'),
            h('button', { type: 'button', className: 'dsh-bq-btn primary', onClick: function () { persist(settings) } }, '保存角色表')))
      } else if (tab === 'syn') {
        var syn = settings.synthetic || { defaultOn: false, sessions: {} }
        var synId = sessionId || (studio.sessionId ? studio.sessionId() : '')
        var synOn = syntheticEnabled(syn, synId)
        body = h('div', null,
          h('div', { className: 'dsh-bq-hint' }, '$bubble[handle|名字|表情|动作|台词|语音台词] 会用与官方气泡一致的样式渲染。识别与渲染始终开启，开关只决定是否把下面的格式说明注入提示词。'),
          Toggle(syn.defaultOn === true, function (v) {
            var next = normalizeSettings(settings)
            next.synthetic.defaultOn = v === true
            setSettings(next)
            studio.apply(next, synId)
            persist(next)
          }, '默认开关：新会话没有单独设置时跟随它（默认关闭）'),
          Toggle(synOn === true, function (v) { setSynSession(v) }, '本会话注入开关' + (synId ? '：…' + String(synId).slice(-6) : '：未识别当前会话')),
          Field('固定前缀提示词（只读）', h('textarea', {
            className: 'dsh-bq-textarea',
            style: { minHeight: '160px' },
            readOnly: true,
            value: SYN_PROMPT
          }), '按官方气泡格式规则改出来的固定前缀；注入时只加这一段，你原有的补充要求一字不动'),
          h('div', { className: 'dsh-bq-row' },
            h('button', { type: 'button', className: 'dsh-bq-btn primary', onClick: function () { injectSynPrompt(true) } }, '注册本会话段落'),
            h('button', { type: 'button', className: 'dsh-bq-btn', onClick: function () { injectSynPrompt(false) } }, '撤销本会话段落'),
            h('button', { type: 'button', className: 'dsh-bq-btn', onClick: function () { persist(settings) } }, '保存开关'),
            h('button', { type: 'button', className: 'dsh-bq-btn', onClick: function () {
              setMessage('正在读取角色素材…')
              studio.refreshFigures(sessionId).then(function (list) {
                setMessage('已读取角色素材：' + (list && list.length ? list.length : 0) + ' 位')
              }).catch(function (error) {
                setMessage('读取素材失败：' + (error && error.message ? error.message : error))
              })
            } }, '重新读取角色素材')),
          h('div', { className: 'dsh-bq-hint' }, '走向标准 API：host 侧用本会话的 agent 作用域注册 ctx.systemPrompt.section()，只在这一局的 system 里多一段；不写气泡格式规则、不写配音规则、不写 system 附加指令、不写任何设置文档或文件，agent 卸载即消失。头像与颜色按 handle/名字匹配卡片的对话气泡素材（含该表情的差分头像），匹配不到才退回角色表与随机色。'))
      } else {
        var sections = (live && live.sections) || []
        body = h('div', null,
          h('div', { className: 'dsh-bq-hint' }, '提交时一个字都不改：你写什么就存什么，不追加占位符、不加任何说明。宿主若因缺占位符拒绝，会原样显示它的报错，并出现「补占位符后保存」——只有你点它，才会在你文本末尾追加那三行。'),
          Field('格式规则全文', h('textarea', {
            className: 'dsh-bq-textarea',
            style: { minHeight: '220px' },
            value: settings.draft.format,
            onChange: function (e) { var next = normalizeSettings(settings); next.draft.format = e.target.value; setSettings(next) }
          }), '点「读取当前注入」会填入宿主当前实际注入的格式规则，直接改这段即为新规则'),
          Field('配音规则全文', h('textarea', {
            className: 'dsh-bq-textarea',
            style: { minHeight: '120px' },
            value: settings.draft.voice,
            onChange: function (e) { var next = normalizeSettings(settings); next.draft.voice = e.target.value; setSettings(next) }
          }), '留空则不覆盖，由宿主按角色配音数据自动生成'),
          Field('完全自定义模板（高级）', h('textarea', {
            className: 'dsh-bq-textarea',
            style: { minHeight: '110px' },
            value: settings.draft.template,
            onChange: function (e) { var next = normalizeSettings(settings); next.draft.template = e.target.value; setSettings(next) }
          }), '填了就优先，忽略上面两段；按你写的原样提交，不追加任何东西'),
          Field('补充要求（原样追加）', h('textarea', {
            className: 'dsh-bq-textarea',
            style: { minHeight: '84px' },
            value: settings.draft.extra,
            onChange: function (e) { var next = normalizeSettings(settings); next.draft.extra = e.target.value; setSettings(next) }
          })),
          h('div', { className: 'dsh-bq-row' },
            h('button', { type: 'button', className: 'dsh-bq-btn', onClick: loadPrompt }, '读取当前注入'),
            h('button', { type: 'button', className: 'dsh-bq-btn primary', onClick: function () { savePrompt(false) } }, '原样保存'),
            live && live.shimNeeded ? h('button', { type: 'button', className: 'dsh-bq-btn', onClick: function () { savePrompt(true) } }, '补占位符后保存') : null),
          live && live.loaded ? h('div', null,
            h('div', { className: 'dsh-bq-field-label' }, '当前分块（只读）'),
            sections.length ? sections.map(function (section, index) {
              return h('div', { key: index, style: { marginBottom: '8px' } },
                h('div', { className: 'dsh-bq-field-label' }, (section.title || section.key || ('分块 ' + (index + 1))) + (section.tokens ? ' · ' + section.tokens + ' tokens' : '')),
                h('div', { className: 'dsh-bq-block' }, String(section.text || '')))
            }) : h('div', { className: 'dsh-bq-hint' }, '此版本未返回分块明细，可直接看上面两个输入框。')
          ) : h('div', { className: 'dsh-bq-hint' }, '点「读取当前注入」拉取引擎里的实际配置。'))
      }

      return h('div', { className: 'dsh-bq-studio' },
        tabs,
        body,
        h('div', { className: 'dsh-bq-row' },
          h('button', { type: 'button', className: 'dsh-bq-btn primary', onClick: function () { persist(settings) } }, '保存全部设置'),
          h('button', { type: 'button', className: 'dsh-bq-btn', onClick: function () {
            studio.read().then(function (fresh) {
              setSettings(fresh)
              studio.apply(fresh)
              setMessage('已恢复为保存值')
            }).catch(function () { setMessage('恢复失败') })
          } }, '恢复已保存')),
        message ? h('div', { className: message.indexOf('失败') >= 0 ? 'dsh-bq-warn' : 'dsh-bq-hint' }, message) : null,
        h('div', { className: 'dsh-bq-hint' }, '外观与角色色即时生效；提示词写入引擎设置后下一轮生效。'))
    }

    // --- plugin wiring ---------------------------------------------------------

    module.exports.inject = ['tavernUi']
    module.exports.apply = function (ctx) {
      var engine = createEngine()

      ctx.effect(function () {
        try {
          return engine.mount()
        } catch (error) {
          console.warn('[dsh-bubble-quote-ink] 安装失败，已忽略：', error)
          return function () {}
        }
      }, 'dsh-bubble-quote-ink: rendering')

      ctx.effect(function () {
        var ui = ctx.tavernUi
        if (!ui || typeof ui.registerPanel !== 'function') return function () {}
        if (!h) return function () {}

        var raw = null
        var initial = null
        var listeners = []

        function notify() {
          for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](initial) } catch (_) {}
          }
        }

        function activeSessionId() {
          try {
            var sessions = ctx.sessions
            if (!sessions) return ''
            var current = typeof sessions.current === 'function' ? sessions.current() : sessions.current
            if (typeof current === 'string') return current
            if (current && typeof current.id === 'string') return current.id
            var snapshot = sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot() : null
            if (snapshot) {
              if (typeof snapshot.currentId === 'string') return snapshot.currentId
              var cur = snapshot.current
              if (typeof cur === 'string') return cur
              if (cur && typeof cur.id === 'string') return cur.id
            }
          } catch (_) {}
          return ''
        }

        var studio = {
          read: function () {
            return ui.readPluginData().then(function (data) {
              raw = data && typeof data === 'object' ? data : {}
              initial = normalizeSettings(raw[DATA_KEY])
              engine.apply(initial, activeSessionId())
              notify()
              return initial
            })
          },
          save: function (data) {
            raw = data
            initial = normalizeSettings(data && data[DATA_KEY])
            engine.apply(initial, activeSessionId())
            notify()
            return ui.savePluginData(data)
          },
          apply: function (next, id) { engine.apply(next || initial, typeof id === 'string' && id ? id : activeSessionId()) },
          applySession: function (id) { engine.apply(initial, typeof id === 'string' && id ? id : activeSessionId()) },
          refreshFigures: function (id) { return engine.reloadFigures(typeof id === 'string' && id ? id : activeSessionId()) },
          sessionId: activeSessionId,
          subscribe: function (fn) { listeners.push(fn); return function () {
            var at = listeners.indexOf(fn)
            if (at >= 0) listeners.splice(at, 1)
          } }
        }

        var ready = null
        try {
          ready = ui.readPluginData()
        } catch (_) { ready = null }

        var panel = ui.registerPanel({
          id: 'studio',
          title: '气泡编辑台',
          render: function (props) {
            studio.applySession(props.gameId)
            return h(BubbleStudioPanel, { gameId: props.gameId, studio: studio, initial: initial, getRaw: function () { return raw } })
          }
        })

        var group = null
        if (typeof ui.registerStartGroup === 'function') {
          group = ui.registerStartGroup({ title: '气泡编辑', tabs: ['studio'] })
        }

        if (ready && typeof ready.then === 'function') {
          ready.then(function (data) {
            raw = data && typeof data === 'object' ? data : {}
            initial = normalizeSettings(raw[DATA_KEY])
            engine.apply(initial, activeSessionId())
            notify()
          }).catch(function () {})
        }

        return function () {
          if (panel) panel()
          if (group) group()
        }
      }, 'dsh-bubble-quote-ink: studio panel')
    }

    // Exposed for the zero-side-effect self test; harmless to the host.
    module.exports.__test = {
      splitQuotes: splitQuotes,
      decorateLine: decorateLine,
      CSS: CSS,
      AVATAR_CSS: AVATAR_CSS,
      hashName: hashName,
      speakerColor: speakerColor,
      isFallbackBubble: isFallbackBubble,
      rowAlias: rowAlias,
      ruleFor: ruleFor,
      decorateAvatar: decorateAvatar,
      ensureCastClass: ensureCastClass,
      castMatch: castMatch,
      castRules: castRules,
      quoteCss: quoteCss,
      avatarCss: avatarCss,
      normalizeAppearance: normalizeAppearance,
      normalizeCast: normalizeCast,
      normalizeSettings: normalizeSettings,
      buildOverrideTemplate: buildOverrideTemplate,
      sectionText: sectionText,
      DEFAULT_APPEARANCE: DEFAULT_APPEARANCE,
      RPC_BASE: RPC_BASE,
      CAST_PREFIX: CAST_PREFIX,
      STUDIO_CSS: STUDIO_CSS,
      SYNTHETIC_LINE: SYNTHETIC_LINE,
      SYN_PROMPT: SYN_PROMPT,
      SYN_PROMPT_START: SYN_PROMPT_START,
      SYN_PROMPT_END: SYN_PROMPT_END,
      SYNTHETIC_ATTR: SYNTHETIC_ATTR,
      normalizeSynthetic: normalizeSynthetic,
      syntheticEnabled: syntheticEnabled,
      withSynPrompt: withSynPrompt,
      parseSyntheticLine: parseSyntheticLine,
      formatSyntheticLine: formatSyntheticLine,
      wrapField: wrapField,
      moodImageFor: moodImageFor,
      readFigureRows: readFigureRows,
      figureColor: figureColor
    }

    return module.exports
  }
})
