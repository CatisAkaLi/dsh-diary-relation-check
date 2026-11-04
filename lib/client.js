/** 生成物：由 tools/build-client.mjs 从 lib/client/index.js 拼出，别手改。 */
window.__ModuleLoader__.load({
  id: 'dsh-diary-relation-check',
  factory(require) {
/**
 * dsh-diary-relation-check —— Client 半边：设置页里的「记忆检查」一页。
 *
 * 三条约束（跟 dsh-memory-board 学到的那套一样）：
 *   ①只依赖 react 和 `--dsw-alias-*` 主题令牌，不 import 任何 Harness Client 包。
 *     那些包的接口会变，纯 JS 没有类型检查；升级后最坏是外观退化，不会白屏。
 *   ②所有取数/保存都软失败：出错只显示一行红字，不抛、不白屏。
 *   ③保存只写插件的 config.json，不碰 profile 的 YAML，不自动重启。
 *
 * 本文件是 factory 函数体，由 tools/build-client.mjs 包进
 * `window.__ModuleLoader__.load({ id, factory(require) { ... } })`。
 */

const React = require('react')
const h = React.createElement
const { useEffect, useState } = React

const API = '/api/dsh-diary-relation-check'
const MISSING = '（读不到）'

const S = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '880px',
    width: '100%',
    minWidth: 0,
    color: 'var(--dsw-alias-label-primary)',
  },
  heading: { margin: 0, fontSize: '18px', fontWeight: 600 },
  intro: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-label-tertiary)' },
  tabs: { display: 'flex', gap: '16px', borderBottom: '0.5px solid var(--dsw-alias-border-l2)' },
  tab: {
    font: 'inherit',
    fontSize: '13px',
    padding: '7px 1px 9px',
    background: 'none',
    border: 0,
    borderBottom: '2px solid transparent',
    color: 'var(--dsw-alias-label-tertiary)',
    cursor: 'pointer',
  },
  tabActive: {
    color: 'var(--dsw-alias-label-primary)',
    borderBottom: '2px solid var(--dsw-alias-label-primary)',
  },
  stack: { display: 'flex', flexDirection: 'column', gap: '10px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
    padding: '8px 10px',
    border: '0.5px solid var(--dsw-alias-border-l2)',
    borderRadius: '8px',
  },
  rowLabel: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
  rowValue: { fontSize: '13px', wordBreak: 'break-all' },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    border: '0.5px solid var(--dsw-alias-border-l2)',
    borderRadius: '8px',
  },
  blockTitle: { fontSize: '13px', fontWeight: 600 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  chip: {
    fontSize: '12px',
    padding: '2px 8px',
    borderRadius: '999px',
    border: '0.5px solid var(--dsw-alias-border-l2)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  hint: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
  warn: {
    margin: 0,
    fontSize: '12px',
    color: 'var(--dsw-alias-state-warn-primary)',
    whiteSpace: 'pre-wrap',
  },
  error: {
    margin: 0,
    fontSize: '13px',
    color: 'var(--dsw-alias-state-error-primary)',
    whiteSpace: 'pre-wrap',
  },
  ok: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-state-success-primary)' },
  text: { margin: 0, fontSize: '13px', whiteSpace: 'pre-wrap' },
  pre: {
    margin: 0,
    fontSize: '12px',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '50vh',
    overflow: 'auto',
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-l1)',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  label: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
  input: {
    font: 'inherit',
    fontSize: '12.5px',
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '0.5px solid var(--dsw-alias-border-l3)',
    background: 'var(--dsw-alias-bg-l1)',
    color: 'var(--dsw-alias-label-primary)',
  },
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
  button: {
    font: 'inherit',
    fontSize: '12.5px',
    padding: '5px 12px',
    borderRadius: '6px',
    border: '0.5px solid var(--dsw-alias-border-l3)',
    background: 'var(--dsw-alias-button-elevated-fill)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
  },
  buttonPrimary: {
    background: 'var(--dsw-alias-button-primary-fill)',
    color: 'var(--dsw-alias-label-primary-foreground)',
    border: '0.5px solid transparent',
  },
  switchRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
}

/** 拉一次接口。任何异常都变成 error 字段，不抛。 */
function useApi(path) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setState((previous) => ({ ...previous, loading: true }))

    fetch(`${API}${path}`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!alive) return
        if (!body) setState({ loading: false, data: null, error: `HTTP ${response.status}` })
        else setState({ loading: false, data: body, error: body.ok === false ? body.error || body.reason || '请求失败' : null })
      })
      .catch((error) => {
        if (alive) setState({ loading: false, data: null, error: String((error && error.message) || error) })
      })

    return () => {
      alive = false
    }
  }, [path, tick])

  return { ...state, reload: () => setTick((value) => value + 1) }
}

function Row({ label, value }) {
  return h(
    'div',
    { style: S.row },
    h('span', { style: S.rowLabel }, label),
    h('span', { style: S.rowValue }, value === null || value === undefined || value === '' ? MISSING : String(value))
  )
}

function Field({ label, hint, children }) {
  return h(
    'label',
    { style: S.field },
    h('span', { style: S.label }, label),
    children,
    hint ? h('span', { style: S.hint }, hint) : null
  )
}

function ErrorLine({ children }) {
  if (!children) return null
  return h('p', { style: S.error }, children)
}

function Chip({ children }) {
  return h('span', { style: S.chip }, children)
}

function fmtTime(ms) {
  if (typeof ms !== 'number' || ms <= 0) return '还没判断过'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

function StatusPane() {
  const status = useApi('/status')
  const data = status.data

  if (status.loading && !data) return h('p', { style: S.hint }, '读中…')
  if (status.error) return h(ErrorLine, null, status.error)
  if (!data || data.ok !== true) return h(ErrorLine, null, data && data.error ? data.error : '状态读不到')

  const scan = data.scan || {}
  const config = data.config || {}

  return h(
    'div',
    { style: S.stack },
    h(
      'div',
      { style: S.grid },
      h(Row, { label: '记忆目录', value: config.diaryDir }),
      h(Row, { label: '上次判断', value: fmtTime(data.lastCheck && data.lastCheck.ms) }),
      h(Row, { label: '判断结果', value: data.lastCheck && data.lastCheck.verdict }),
      h(Row, { label: '现在会提醒', value: data.willRemind ? '会' : '不会' })
    ),
    h(
      'div',
      { style: S.block },
      h('div', { style: S.blockTitle }, '识别到的记忆'),
      h(
        'div',
        { style: S.chips },
        h(Chip, null, `日 ${scan.days || 0}`),
        h(Chip, null, `周 ${scan.weeks || 0}`),
        h(Chip, null, `月 ${scan.months || 0}`),
        h(Chip, null, `年 ${scan.years || 0}`),
        h(Chip, null, scan.who ? '我是谁 ✓' : '我是谁 —')
      ),
      (scan.foreign || []).length > 0
        ? h(
            'p',
            { style: S.warn },
            `有 ${scan.foreign.length} 个 .md 认不出：${scan.foreign.join('、')}。格式不对时要先确认再改名，只改名不改内容。`
          )
        : null
    ),
    data.lastCheck && data.lastCheck.reason
      ? h(
          'div',
          { style: S.block },
          h('div', { style: S.blockTitle }, '上次的理由'),
          h('p', { style: S.text }, data.lastCheck.reason)
        )
      : null,
    data.text
      ? h(
          'details',
          { style: S.block },
          h('summary', { style: S.blockTitle }, '这次会注入的提醒'),
          h('pre', { style: S.pre }, data.text)
        )
      : null,
    h('p', { style: S.hint }, `插件 ${data.version || MISSING} ｜ 状态文件 ${data.stateFile || MISSING}`)
  )
}

function ConfigPane() {
  const status = useApi('/status')
  const data = status.data
  const [form, setForm] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data && data.ok === true && form === null) {
      const config = data.config || {}
      setForm({
        diaryDir: config.diaryDir || '',
        question: config.question || '',
        person: config.person || '',
        sessionId: config.sessionId || '',
        autoInit: config.autoInit === true,
        memorySetup: config.memorySetup === true,
      })
    }
  }, [data, form])

  if (!data || data.ok !== true) {
    return status.error ? h(ErrorLine, null, status.error) : h('p', { style: S.hint }, '读中…')
  }
  if (!form) return null

  const sources = data.sources || {}
  const fromYaml = (key) => sources[key] === 'yaml'

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm({ ...form, [key]: value })
  }

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const body = await response.json().catch(() => null)
      if (body && body.ok === true) {
        setMessage({ kind: 'ok', text: `已保存到 ${body.file || 'config.json'}。重启 DSH 后生效。` })
      } else {
        setMessage({ kind: 'error', text: body ? body.error || body.reason || '保存失败' : `HTTP ${response.status}` })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: String((error && error.message) || error) })
    }
    setBusy(false)
  }

  return h(
    'div',
    { style: S.stack },
    h(
      'p',
      { style: S.hint },
      '保存只写插件自己的 config.json，不碰 profile 的 YAML。标「profile 覆盖」的项，在这里改不生效，要改 cordis.patch.yml。'
    ),
    h(
      'div',
      { style: S.grid },
      h(
        Field,
        { label: '记忆目录 diaryDir', hint: fromYaml('diaryDir') ? '被 profile 覆盖，改这里不生效' : '日/周/月/年文件都放在这里' },
        h('input', { style: S.input, value: form.diaryDir, onChange: set('diaryDir'), placeholder: 'D:\\我的记忆' })
      ),
      h(
        Field,
        { label: '判断问题 question', hint: fromYaml('question') ? '被 profile 覆盖，改这里不生效' : '默认是亲密关系那一条' },
        h('input', { style: S.input, value: form.question, onChange: set('question') })
      ),
      h(
        Field,
        { label: '代词 person', hint: fromYaml('person') ? '被 profile 覆盖，改这里不生效' : '' },
        h('input', { style: S.input, value: form.person, onChange: set('person') })
      ),
      h(
        Field,
        { label: '会话 id sessionId', hint: fromYaml('sessionId') ? '被 profile 覆盖，改这里不生效' : '留空 = 所有会话都出提醒' },
        h('input', { style: S.input, value: form.sessionId, onChange: set('sessionId') })
      )
    ),
    h(
      'div',
      { style: S.block },
      h('label', { style: S.switchRow }, h('input', { type: 'checkbox', checked: form.autoInit, onChange: set('autoInit') }), '没有日记时自动建今天的日日记（autoInit）'),
      h(
        'label',
        { style: S.switchRow },
        h('input', { type: 'checkbox', checked: form.memorySetup, onChange: set('memorySetup') }),
        '第一次装好就搭一套结构：我是谁 + 分层日记（memorySetup）'
      )
    ),
    h(
      'div',
      { style: S.toolbar },
      h('button', { type: 'button', style: { ...S.button, ...S.buttonPrimary }, disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
      h('span', { style: S.hint }, '不会自动重启，保存后你自己重启 DSH。')
    ),
    message ? h('p', { style: message.kind === 'ok' ? S.ok : S.error }, message.text) : null
  )
}

/** 组件抛错只降级这一块，不白掉整个设置页。 */
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    try {
      console.error('[dsh-diary-relation-check] 设置页组件出错（只降级这一块）：', error)
    } catch {
      /* 没有控制台也要活 */
    }
  }

  render() {
    if (this.state.error) {
      return h(
        'p',
        { style: S.error },
        `记忆检查出错了（只影响这一块）：${String((this.state.error && this.state.error.message) || this.state.error)}`
      )
    }
    return this.props.children
  }
}

function MemoryCheckPage() {
  const [tab, setTab] = useState('status')

  const tabButton = (id, label) =>
    h(
      'button',
      {
        key: id,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === id,
        style: tab === id ? { ...S.tab, ...S.tabActive } : S.tab,
        onClick: () => setTab(id),
      },
      label
    )

  return h(
    'div',
    { style: S.section },
    h('h2', { style: S.heading }, '记忆检查'),
    h('p', { style: S.intro }, '看记忆目录里有什么、上次判断是什么、现在会不会提醒；也能改配置。保存后要重启 DSH 才生效。'),
    h('div', { style: S.tabs, role: 'tablist' }, tabButton('status', '状态'), tabButton('config', '配置')),
    tab === 'status' ? h(PanelBoundary, null, h(StatusPane)) : h(PanelBoundary, null, h(ConfigPane))
  )
}

return {
  inject: ['slots'],
  apply(ctx) {
    try {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'diary-relation-check', order: 110, label: '记忆检查' },
          MemoryCheckPage
        )
      )
      console.info('[dsh-diary-relation-check] 已注册设置页「记忆检查」（状态 / 配置）')
    } catch (error) {
      console.warn('[dsh-diary-relation-check] 设置页注册失败：' + String((error && error.message) || error))
    }
  },
}

  },
});
