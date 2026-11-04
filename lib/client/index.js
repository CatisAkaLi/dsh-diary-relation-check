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

/** 客户端根上下文：apply 里存下来，目录选择器要用。 */
let clientCtx = null

/**
 * 官方目录选择器：有就用，没有返回 null（退化成手填）。
 * 两条路都不 import Harness Client 包，只碰全局口子和 ctx.get。
 */
function directoryPicker() {
  try {
    const desktop = globalThis.__DSH_DIRECTORY_PICKER__
    if (desktop && typeof desktop.pick === 'function') return () => desktop.pick()
  } catch {
    /* 没有就没有 */
  }
  try {
    const workspace = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('uiWorkspace') : null
    if (workspace && typeof workspace.pickDirectory === 'function') return () => workspace.pickDirectory()
  } catch {
    /* 没 inject 会抛，当没有 */
  }
  return null
}

/** 初始化向导：有记忆就去检查，没有就从今天开始建。 */
function SetupPane() {
  const [step, setStep] = useState('ask')
  const [dir, setDir] = useState('')
  const [probe, setProbe] = useState(null)
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const runInspect = async (candidate) => {
    const value = String(candidate === undefined ? dir : candidate).trim()
    if (value === '') {
      setMessage({ kind: 'error', text: '先填一个目录。' })
      return
    }
    setBusy(true)
    setMessage(null)
    setProbe(null)
    try {
      const response = await fetch(`${API}/inspect?dir=${encodeURIComponent(value)}`)
      const body = await response.json().catch(() => null)
      if (body && body.ok === true) {
        setProbe(body)
        setDir(body.dir)
      } else {
        setMessage({ kind: 'error', text: body ? body.error || body.reason || '检查失败' : `HTTP ${response.status}` })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: String((error && error.message) || error) })
    }
    setBusy(false)
  }

  const pick = async () => {
    const picker = directoryPicker()
    if (!picker) {
      setMessage({ kind: 'warn', text: '本机客户端没有官方目录选择器，直接手填路径就行。' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const picked = await picker()
      if (typeof picked === 'string' && picked.trim() !== '') {
        setDir(picked)
        await runInspect(picked)
      } else {
        setMessage({ kind: 'warn', text: '没选（取消了）。也可以手填。' })
      }
    } catch (error) {
      setMessage({ kind: 'warn', text: `选择器没打开成功：${String((error && error.message) || error)}，手填吧。` })
    }
    setBusy(false)
  }

  const useThisDir = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ diaryDir: dir.trim() }),
      })
      const body = await response.json().catch(() => null)
      if (body && body.ok === true) {
        setMessage({ kind: 'ok', text: `已保存到 ${body.file || 'config.json'}。重启 DSH 后生效。` })
        setStep('done')
      } else {
        setMessage({ kind: 'error', text: body ? body.error || body.reason || '保存失败' : `HTTP ${response.status}` })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: String((error && error.message) || error) })
    }
    setBusy(false)
  }

  const runInit = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`${API}/init`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir: dir.trim(), mode: 'fresh', confirm: 'yes' }),
      })
      const body = await response.json().catch(() => null)
      if (body && body.ok === true) {
        setResult(body)
        setStep('done')
      } else {
        setMessage({ kind: 'error', text: body ? body.error || body.reason || '初始化失败' : `HTTP ${response.status}` })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: String((error && error.message) || error) })
    }
    setBusy(false)
  }

  const notice = message
    ? h('p', { style: message.kind === 'ok' ? S.ok : message.kind === 'warn' ? S.warn : S.error }, message.text)
    : null
  const restart = h('p', { style: S.hint }, '不会自动重启；保存或建完之后，重启 DSH 才会加载新目录。')

  if (step === 'ask') {
    return h(
      'div',
      { style: S.stack },
      h('p', { style: S.text }, '先确认一件事：你的 DSH 里已经有记忆或日记文件吗？'),
      h(
        'div',
        { style: S.toolbar },
        h(
          'button',
          { type: 'button', style: { ...S.button, ...S.buttonPrimary }, onClick: () => { setStep('existing'); setMessage(null) } },
          '有记忆，去选目录'
        ),
        h(
          'button',
          { type: 'button', style: S.button, onClick: () => { setStep('fresh'); setMessage(null) } },
          '没有，从现在开始建'
        )
      ),
      h('p', { style: S.hint }, '已经有的话插件会先检查格式；全对就用它，不对只提示改名，不动文件内容。')
    )
  }

  if (step === 'existing') {
    return h(
      'div',
      { style: S.stack },
      h('p', { style: S.text }, '把已有记忆的目录填进来，或者用系统选择器选。检查只读，不写任何文件。'),
      h(
        Field,
        { label: '记忆目录', hint: '目录里要有 我是谁.md / YYYY-MM-DD-日记.md 这类文件' },
        h('input', {
          style: S.input,
          value: dir,
          onChange: (event) => setDir(event.target.value),
          placeholder: 'D:\\我的记忆',
        })
      ),
      h(
        'div',
        { style: S.toolbar },
        h('button', { type: 'button', style: S.button, disabled: busy, onClick: pick }, '选择目录…'),
        h(
          'button',
          { type: 'button', style: { ...S.button, ...S.buttonPrimary }, disabled: busy || dir.trim() === '', onClick: () => runInspect() },
          busy ? '检查中…' : '检查这个目录'
        ),
        h('button', { type: 'button', style: S.button, onClick: () => { setStep('ask'); setProbe(null); setMessage(null) } }, '返回')
      ),
      notice,
      probe
        ? h(
            'div',
            { style: S.block },
            h('div', { style: S.blockTitle }, probe.exists ? (probe.isDir ? '这个目录' : '这不是目录') : '目录还不存在'),
            h(
              'div',
              { style: S.chips },
              h(Chip, null, `日 ${probe.days}`),
              h(Chip, null, `周 ${probe.weeks}`),
              h(Chip, null, `月 ${probe.months}`),
              h(Chip, null, `年 ${probe.years}`),
              h(Chip, null, probe.who ? '我是谁 ✓' : '我是谁 —')
            ),
            probe.foreign.length > 0
              ? h(
                  'div',
                  { style: S.stack },
                  h('p', { style: S.warn }, `有 ${probe.foreign.length} 个文件格式不对。先确认哪些是日记，然后只改文件名、不动内容，改前备份：`),
                  ...probe.foreign.map((item) =>
                    h('p', { key: item.file, style: S.text }, `${item.file}  →  ${item.suggestion || '文件名里没有日期，先确认这是哪天的'}`)
                  ),
                  h('button', { type: 'button', style: S.button, disabled: busy, onClick: () => runInspect(dir) }, '我已改好，重新检查')
                )
              : null,
            probe.hasAny
              ? h('button', { type: 'button', style: { ...S.button, ...S.buttonPrimary }, disabled: busy, onClick: useThisDir }, '就用这个目录')
              : probe.exists && probe.foreign.length === 0
                ? h('button', { type: 'button', style: { ...S.button, ...S.buttonPrimary }, disabled: busy, onClick: () => setStep('fresh') }, '目录是空的，按「没有记忆」来建')
                : null
          )
        : null,
      restart
    )
  }

  if (step === 'fresh') {
    return h(
      'div',
      { style: S.stack },
      h('p', { style: S.text }, '从今天开始建一套：我是谁.md + 今天的日日记。只创建不覆盖；目录里有认不出的 .md 时会拒绝。'),
      h(
        Field,
        { label: '建在哪个目录', hint: '建议用一个空目录或新目录' },
        h('input', {
          style: S.input,
          value: dir,
          onChange: (event) => setDir(event.target.value),
          placeholder: 'D:\\我的记忆',
        })
      ),
      h(
        'div',
        { style: S.toolbar },
        h('button', { type: 'button', style: S.button, disabled: busy, onClick: pick }, '选择目录…'),
        h(
          'button',
          { type: 'button', style: { ...S.button, ...S.buttonPrimary }, disabled: busy || dir.trim() === '', onClick: runInit },
          busy ? '建中…' : '从现在开始建'
        ),
        h('button', { type: 'button', style: S.button, onClick: () => { setStep('ask'); setMessage(null) } }, '返回')
      ),
      notice,
      restart
    )
  }

  return h(
    'div',
    { style: S.stack },
    h('p', { style: S.ok }, '这一步做完了。'),
    result && result.created && result.created.length > 0
      ? h(
          'div',
          { style: S.block },
          h('div', { style: S.blockTitle }, '新建了'),
          ...result.created.map((file) => h('p', { key: file, style: S.text }, file))
        )
      : null,
    result && result.errors && result.errors.length > 0
      ? h('p', { style: S.warn }, `有几步没成：${result.errors.join('；')}`)
      : null,
    result && result.dir ? h('p', { style: S.hint }, `目录：${result.dir}`) : null,
    h('p', { style: S.hint }, '重启 DSH 后生效。'),
    h(
      'div',
      { style: S.toolbar },
      h(
        'button',
        {
          type: 'button',
          style: S.button,
          onClick: () => { setStep('ask'); setProbe(null); setResult(null); setMessage(null); setDir('') },
        },
        '重新来一遍'
      )
    )
  )
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
    h('div', { style: S.tabs, role: 'tablist' }, tabButton('status', '状态'), tabButton('config', '配置'), tabButton('setup', '初始化')),
    tab === 'status'
      ? h(PanelBoundary, null, h(StatusPane))
      : tab === 'config'
        ? h(PanelBoundary, null, h(ConfigPane))
        : h(PanelBoundary, null, h(SetupPane))
  )
}

return {
  inject: ['slots'],
  apply(ctx) {
    clientCtx = ctx
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
