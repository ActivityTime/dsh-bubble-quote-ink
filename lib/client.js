/**
 * dsh-bubble-quote-ink — browser half.
 *
 * Effects:
 *   1. Only the spoken line inside 「」 takes the speaker's colour (--bubble-color,
 *      already set inline on every .fork-bubble row by bubbles.js).
 *   2. The surrounding （action） and narration keep Tavern's original ink.
 *   3. Bubbles whose speaker has no configured colour fall back to the host's
 *      flat grey-green (theme.css `--fork-figure-fallback`). For those rows we derive
 *      a stable pseudo-random colour from the speaker name (FNV-1a seed) and override
 *      `--fork-figure-fallback` inside the row's scope via a per-alias CSS rule, plus
 *      `--bubble-name-ink` so the name glyphs colour like configured figures do.
 *   4. The faceless-avatar placeholder (.fork-bubble-avatar-ph, the name's first
 *      glyph) gets a seal-like artistic treatment: gradient-clipped glyph + colour ring,
 *      both driven by --bubble-color (configured colour, or our name-seeded colour
 *      from 3). The glyph text node is wrapped in one span so CSS can gradient-clip it.
 *   5. NEW: speakers with no character entry at all render a completely EMPTY
 *      .fork-bubble-avatar span (bubbles.js's last branch, no initial, no image).
 *      We detect those, add the host's own `fork-bubble-avatar-ph` class (reusing its
 *      sizing/centering rules) and inject the same artistic glyph derived from the
 *      speaker name — so both placeholder scenarios look identical.
 *
 * Why DOM work is needed: .fork-bubble-line is rendered as a plain text child
 * (`h("span", {className:"fork-bubble-line"}, segment.text)`), so CSS cannot
 * select the quoted part. registerTextMarker does not help either: plugin markers
 * are split *before* BubblePublication parses @bubble lines, and bubble text never
 * passes through that pipeline. So we wrap 「…」 in a span after render.
 *
 * Why a per-alias CSS rule instead of inline style mutation: React owns the row's
 * inline style (bubbles.js sets --bubble-color there every render). Overriding the
 * *unreferenced* custom property `--fork-figure-fallback` on a `[data-alias]` selector
 * is invisible to React's diff (it never removes properties it did not set), so the
 * colour survives re-renders without fighting React. The host resolves
 * `--bubble-color: var(--fork-figure-fallback)` per row, so the override lands exactly
 * where we want and nowhere else.
 *
 * Idempotence is structural, not a flag: once a text node is replaced, the
 * remaining text nodes no longer contain a complete 「…」 and text inside an
 * existing .dsh-bq-quote span is skipped; alias rules are keyed by alias in a Map.
 * React re-renders are picked up by the MutationObserver. An unfinished streaming
 * line （…「…） simply does not match.
 *
 * No host services are touched: inject is empty and the work is deferred into
 * ctx.effect, so apply returns immediately (avoids the renderer boot hang).
 */
window.__ModuleLoader__.load({
  id: 'dsh-bubble-quote-ink',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports

    var STYLE_ID = 'dsh-bubble-quote-ink-style'
    var ALIAS_STYLE_ID = 'dsh-bubble-alias-ink-style'
    var SPAN_CLASS = 'dsh-bq-quote'
    var GLYPH_CLASS = 'dsh-bq-avatar-glyph'
    var LINE_SELECTOR = '.fork-bubble-line'
    var ROW_SELECTOR = '.fork-bubble'
    var AVATAR_SELECTOR = '.fork-bubble-avatar'
    var PH_CLASS = 'fork-bubble-avatar-ph'
    var QUOTE_RE = /「([^」]+)」/g
    // The literal inline value bubbles.js writes when a figure has no configured colour.
    var FALLBACK_COLOR = 'var(--fork-figure-fallback)'

    var CSS = [
      LINE_SELECTOR + ' .' + SPAN_CLASS + ' {',
      '  color: var(--bubble-color, var(--row-color, var(--fork-accent, inherit)));',
      '  font-weight: 500;',
      '}',
      '@supports (color: color-mix(in srgb, red, blue)) {',
      '  ' + LINE_SELECTOR + ' .' + SPAN_CLASS + ' {',
      '    color: color-mix(in srgb, var(--bubble-color, var(--row-color, var(--fork-accent, CanvasText))) 82%, var(--fork-ink, CanvasText));',
      '  }',
      '}'
    ].join('\n')

    // Seal-like artistic treatment for the faceless-avatar placeholder. The frame keeps a
    // tinted wash + colour ring; the glyph is gradient-clipped between an ink-tinted tone
    // and the pure bubble colour, so it reads on both the light and the dark theme.
    // Pinned to the ph class (never to .fork-bubble-avatar) so image avatars are untouched.
    var AVATAR_CSS = [
      '.fork-bubble .' + PH_CLASS + ' {',
      '  box-shadow:',
      '    inset 0 0 0 1.5px color-mix(in srgb, var(--bubble-color) 62%, transparent),',
      '    inset 0 -8px 16px -10px color-mix(in srgb, var(--bubble-color) 55%, transparent),',
      '    0 1px 3px rgb(0 0 0 / .15);',
      '}',
      '@supports (color: color-mix(in srgb, red, blue)) {',
      '  .fork-bubble .' + PH_CLASS + ' {',
      '    background: radial-gradient(135% 125% at 30% 18%,',
      '      color-mix(in srgb, var(--bubble-color) 34%, var(--fk-current-bgSolid, Canvas)) 0%,',
      '      color-mix(in srgb, var(--bubble-color) 10%, var(--fk-current-bgSolid, Canvas)) 72%);',
      '  }',
      '  .fork-bubble .' + PH_CLASS + ' .' + GLYPH_CLASS + ' {',
      '    font: 700 1.5em/1 var(--fork-font-reading, serif);',
      '    background: linear-gradient(170deg,',
      '      color-mix(in srgb, var(--bubble-color) 40%, CanvasText) 0%,',
      '      var(--bubble-color) 100%);',
      '    -webkit-background-clip: text;',
      '    background-clip: text;',
      '    color: transparent;',
      '    text-shadow: 0 1px 0 color-mix(in srgb, var(--bubble-color) 28%, Canvas);',
      '  }',
      '}'
    ].join('\n')

    // --- 3. name-seeded colour for unconfigured bubbles ----------------------------

    // FNV-1a, 32 bit. Deterministic across sessions: the same speaker name always
    // yields the same colour, different names spread evenly across the hue wheel.
    function hashName(name) {
      var text = String(name || '')
      var h = 0x811c9dc5
      for (var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h >>> 0
    }

    // Hue spans the whole wheel; saturation/lightness stay in a band that reads well
    // on both the light and the dark theme (mid-dark, clearly saturated).
    function speakerColor(name) {
      var h = hashName(name)
      var hue = h % 360
      var sat = 52 + ((h >>> 8) % 16)    // 52–67 %
      var light = 40 + ((h >>> 16) % 10) // 40–49 %
      return 'hsl(' + hue + ' ' + sat + '% ' + light + '%)'
    }

    // True only for rows the host rendered with the flat fallback colour, i.e. the
    // speaker has no configured 形象色/素材色. Configured rows carry a real colour
    // (hex/rgb/…) and are left untouched.
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

    // ------------------------------------------------------------------------------

    // Split one text node's value into plain / quoted parts. null means "leave untouched".
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

    // Wrap the placeholder glyph's text in one span so CSS can gradient-clip it.
    // Idempotent: skips when a .dsh-bq-avatar-glyph child already exists.
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

    // Fill EMPTY avatar frames (speaker with no character entry: no image, no initial,
    // no spinner — bubbles.js's last branch). We borrow the host's own ph class so the
    // frame shrinks/centres exactly like native placeholders, then inject the artistic
    // glyph from the speaker name. Idempotent: ph class + existing glyph ⇒ skip.
    function decorateEmptyAvatar(avatar) {
      if (!avatar || avatar.nodeType !== 1 || !avatar.childNodes) return false
      var kids = avatar.childNodes
      for (var i = 0; i < kids.length; i++) {
        var node = kids[i]
        if (node.nodeType === 1) return false // image / spinner / already filled
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

    // One avatar element, either kind. A frame we already filled routes to the ph path,
    // whose glyph guard makes the whole thing idempotent.
    function decorateAvatar(el) {
      if (!el || el.nodeType !== 1) return false
      var cls = typeof el.className === 'string' ? el.className : ''
      if (cls.split(/\s+/).indexOf(PH_CLASS) >= 0) return decorateAvatarPh(el)
      return decorateEmptyAvatar(el)
    }

    function install() {
      if (typeof document === 'undefined' || !document.documentElement) return function () {}
      var root = document.documentElement
      var head = document.head || root

      var style = document.getElementById(STYLE_ID)
      if (!style) {
        style = document.createElement('style')
        style.id = STYLE_ID
      }
      style.textContent = CSS + '\n' + AVATAR_CSS
      if (!style.parentNode) head.appendChild(style)

      var aliasStyle = document.getElementById(ALIAS_STYLE_ID)
      if (!aliasStyle) {
        aliasStyle = document.createElement('style')
        aliasStyle.id = ALIAS_STYLE_ID
        head.appendChild(aliasStyle)
      }

      var aliasColors = new Map()

      function syncAliasStyle() {
        var parts = []
        aliasColors.forEach(function (color, alias) { parts.push(ruleFor(alias, color)) })
        aliasStyle.textContent = parts.join('\n')
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
          if (!isFallbackBubble(row)) continue
          var alias = rowAlias(row)
          if (!alias || aliasColors.has(alias)) continue
          aliasColors.set(alias, speakerColor(alias))
          changed = true
        }
        if (changed) syncAliasStyle()
      }

      var pending = new Set()
      var scheduled = false

      function addLine(element) {
        if (element && element.nodeType === 1) pending.add(element)
      }
      function addRow(element) {
        if (element && element.nodeType === 1) pending.add(element)
      }
      function linesUnder(node) {
        if (!node || node.nodeType !== 1) return
        if (node.matches && node.matches(LINE_SELECTOR)) addLine(node)
        if (node.querySelectorAll) {
          var found = node.querySelectorAll(LINE_SELECTOR)
          for (var i = 0; i < found.length; i++) addLine(found[i])
        }
      }
      function avatarsUnder(node) {
        if (!node || node.nodeType !== 1) return
        if (node.matches && node.matches(AVATAR_SELECTOR)) addLine(node)
        if (node.querySelectorAll) {
          var found = node.querySelectorAll(AVATAR_SELECTOR)
          for (var i = 0; i < found.length; i++) addLine(found[i])
        }
      }
      function flush() {
        scheduled = false
        var list = Array.from(pending)
        pending.clear()
        for (var i = 0; i < list.length; i++) {
          var element = list[i]
          scanRows(element)
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
          if (record.type === 'characterData') {
            var parent = record.target && record.target.parentElement
            var line = parent && parent.closest ? parent.closest(LINE_SELECTOR) : null
            if (line) addLine(line)
            continue
          }
          var added = record.addedNodes || []
          for (var j = 0; j < added.length; j++) {
            var node = added[j]
            if (!node || node.nodeType !== 1) continue
            addRow(node)
            linesUnder(node)
            avatarsUnder(node)
          }
        }
        if (pending.size) schedule()
      }

      scanRows(root)
      linesUnder(root)
      avatarsUnder(root)
      flush()

      var observer = null
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(onMutations)
        observer.observe(root, { childList: true, subtree: true, characterData: true })
      }

      return function dispose() {
        if (observer) observer.disconnect()
        for (var i = 0; i < 2; i++) {
          var own = document.getElementById(i ? ALIAS_STYLE_ID : STYLE_ID)
          if (own && own.parentNode) own.parentNode.removeChild(own)
        }
        var spans = document.querySelectorAll(LINE_SELECTOR + ' .' + SPAN_CLASS)
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

    module.exports.inject = []
    module.exports.apply = function (ctx) {
      ctx.effect(function () {
        try {
          return install()
        } catch (error) {
          console.warn('[dsh-bubble-quote-ink] 安装失败，已忽略：', error)
          return function () {}
        }
      })
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
      decorateAvatar: decorateAvatar
    }

    // Critical: the loader must receive module.exports (inject/apply live on it).
    return module.exports
  }
})
