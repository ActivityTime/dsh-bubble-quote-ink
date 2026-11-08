/**
 * dsh-bubble-quote-ink — browser half.
 *
 * Effect (both options the user picked):
 *   1. Only the spoken line inside 「」 takes the speaker's colour (--bubble-color,
 *      already set inline on every .fork-bubble row by bubbles.js).
 *   2. The surrounding （action） and narration keep Tavern's original ink.
 *
 * Why DOM work is needed: .fork-bubble-line is rendered as a plain text child
 * (`h("span", {className:"fork-bubble-line"}, segment.text)`), so CSS cannot
 * select the quoted part. registerTextMarker does not help either: plugin markers
 * are split *before* BubblePublication parses @bubble lines, and bubble text never
 * passes through that pipeline. So we wrap 「…」 in a span after render.
 *
 * Idempotence is structural, not a flag: once a text node is replaced, the
 * remaining text nodes no longer contain a complete 「…」 and text inside an
 * existing .dsh-bq-quote span is skipped. React re-renders are picked up by the
 * MutationObserver. An unfinished streaming line （…「…） simply does not match.
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
    var SPAN_CLASS = 'dsh-bq-quote'
    var LINE_SELECTOR = '.fork-bubble-line'
    var QUOTE_RE = /「([^」]+)」/g

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

    function install() {
      if (typeof document === 'undefined' || !document.documentElement) return function () {}
      var root = document.documentElement
      var head = document.head || root

      var style = document.getElementById(STYLE_ID)
      if (!style) {
        style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        head.appendChild(style)
      }

      var pending = new Set()
      var scheduled = false

      function addLine(element) {
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
      function flush() {
        scheduled = false
        var list = Array.from(pending)
        pending.clear()
        for (var i = 0; i < list.length; i++) decorateLine(list[i])
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
          for (var j = 0; j < added.length; j++) linesUnder(added[j])
        }
        if (pending.size) schedule()
      }

      linesUnder(root)
      flush()

      var observer = null
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(onMutations)
        observer.observe(root, { childList: true, subtree: true, characterData: true })
      }

      return function dispose() {
        if (observer) observer.disconnect()
        var own = document.getElementById(STYLE_ID)
        if (own && own.parentNode) own.parentNode.removeChild(own)
        var spans = document.querySelectorAll(LINE_SELECTOR + ' .' + SPAN_CLASS)
        for (var i = 0; i < spans.length; i++) {
          var span = spans[i]
          if (span.parentNode) span.parentNode.replaceChild(document.createTextNode(span.textContent || ''), span)
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
    module.exports.__test = { splitQuotes: splitQuotes, decorateLine: decorateLine, CSS: CSS }

    // Critical: the loader must receive module.exports (inject/apply live on it).
    return module.exports
  }
})
