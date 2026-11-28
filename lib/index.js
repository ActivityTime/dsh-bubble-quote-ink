// Host half — registers the fixed-prefix instruction through DSH's own prompt
// registry, never by writing another subsystem's settings or files.
//
// v0.9.7 wrote it into the dialogue-bubble engine (`dialogue.injection.extra`) —
// that is the stage's bubble prompt, out of scope. v0.9.8 wrote it into the
// built-in `system-append` — that overwrites a user-owned setting, also wrong.
// v0.9.9 uses the standard API instead:
//
//   ctx.systemPrompt.section()  — the documented prompt-assembly registry
//                                 (registry + scope, disposer on unload)
//
// A section registered through `agent.ctx` belongs to that one agent's scope,
// so the switch is genuinely per session: nothing is written to disk, nothing
// shadows a shipped prompt, nothing survives the plugin being unloaded.

export const name = 'dsh-bubble-quote-ink'
export const inject = ['systemPrompt', 'webServer', 'agents']

const SECTION_NAME = 'dsh-bubble-quote-ink:synthetic'
const SECTION_ORDER = 190
const ROUTE = '/api/dsh-bubble-quote-ink/synthetic'

export const SYN_PROMPT = [
  '[固定气泡格式]',
  '每一句台词单独一行，写成 $bubble[handle|名字|表情|动作|台词|语音台词]。',
  '- 六个字段全部必填，任何一段都不准留空；缺一段这行就不会被当成台词。',
  '- handle：说话人标识，小写；名字：显示名；表情：这一行舞台上的情绪或姿态。',
  '- 动作：说话人这一行的动作/神态，中文短语，不带括号。',
  '- 台词：实际说的话，中文，不带「」或任何括号。',
  '- 语音台词：同一句在该角色语音语言里的说法；该角色没有语音语言时，也必须填，就写同一句台词原文。',
  '- 每个字段里都不要出现竖线 |；一行一句；叙述与动作描写仍用普通散文。',
  '示例：$bubble[alya|爱莉|性欲|揉乳皱眉|讨厌~|キライ~]',
  '[/固定气泡格式]'
].join('\n')

function readBody(req) {
  return new Promise(function (resolve) {
    var raw = ''
    req.on('data', function (chunk) { raw += chunk })
    req.on('end', function () {
      try { resolve(JSON.parse(raw || '{}')) } catch (_) { resolve({}) }
    })
    req.on('error', function () { resolve({}) })
  })
}

function send(res, code, data) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(data))
}

export function apply(ctx) {
  // Switch state lives in memory only: the panel is the source of truth and
  // pushes it on every open, so a restart simply starts closed again.
  var defaultOn = false
  var sessions = new Map()
  var registered = new Map()

  function wanted(sessionId) {
    if (sessions.has(sessionId)) return sessions.get(sessionId) === true
    return defaultOn === true
  }

  function disable(sessionId) {
    var dispose = registered.get(sessionId)
    if (!dispose) return false
    registered.delete(sessionId)
    try { dispose() } catch (_) {}
    return true
  }

  function enable(sessionId) {
    if (registered.has(sessionId)) return true
    var agent = ctx.agents.get(sessionId)
    if (!agent || !agent.ctx || !agent.ctx.systemPrompt) return false
    // Scoped registration: this section exists only while this agent lives.
    var dispose = agent.ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: SYN_PROMPT
    })
    registered.set(sessionId, function () { try { dispose() } catch (_) {} })
    return true
  }

  function sync(sessionId) {
    if (!sessionId) return false
    return wanted(sessionId) ? enable(sessionId) : disable(sessionId)
  }

  // A session that was not running yet picks the switch up when it starts.
  ctx.effect(function () {
    return ctx.on('agent/created', function (agent) {
      try {
        var id = agent && agent.id
        if (id && wanted(String(id))) enable(String(id))
      } catch (_) {}
    })
  }, 'dsh-bubble-quote-ink: prompt section on agent start')

  ctx.effect(function () {
    var webServer = ctx.webServer
    if (!webServer || typeof webServer.register !== 'function') return function () {}
    return webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async function (req, res) {
        if (!req || req.method === 'GET') {
          return send(res, 200, {
            prompt: SYN_PROMPT,
            defaultOn: defaultOn,
            sessions: Array.from(sessions.keys()),
            registered: Array.from(registered.keys())
          })
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
        var body = await readBody(req)
        if (typeof body.defaultOn === 'boolean') defaultOn = body.defaultOn
        var id = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 128) : ''
        if (id && typeof body.on === 'boolean') sessions.set(id, body.on)
        var active = id ? sync(id) : false
        return send(res, 200, { ok: true, sessionId: id, on: id ? wanted(id) : null, active: active })
      }
    })
  }, 'dsh-bubble-quote-ink: prompt section')

  ctx.effect(function () {
    return function () {
      registered.forEach(function (dispose) { try { dispose() } catch (_) {} })
      registered.clear()
      sessions.clear()
    }
  }, 'dsh-bubble-quote-ink: prompt section cleanup')
}
