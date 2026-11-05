import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse, dirname } from 'node:path'

import {
  DEFAULTS,
  acceptsSession,
  buildDiskMissingHint,
  buildInitHint,
  buildMigrationHint,
  buildPeriodicHint,
  buildReminder,
  buildTodayHint,
  compute,
  dateStr,
  dayFileName,
  ensureDiary,
  ensureMemory,
  ensureStateDir,
  isoWeek,
  memoryGuide,
  mergeConfigSources,
  monthFileName,
  normalizeConfig,
  periodicDue,
  pluginConfigFile,
  readPluginConfig,
  scanMemory,
  selectLayers,
  sessionIdOf,
  suggestDiaryName,
  today,
  volumeAvailable,
  volumeRootOf,
  weekFileName,
  yearFileName,
  __selfCheck,
} from '../lib/index.js'

/** 找一个当前机器上不存在的盘符，用来模拟掉盘。没有就返回 null。 */
function missingVolumeRoot() {
  if (process.platform !== 'win32') return null
  for (const letter of 'QRSTUVWXYZ') {
    const root = `${letter}:\\`
    if (!existsSync(root)) return root
  }
  return null
}

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'relation-check-'))
}

/** 写文件并指定 mtime。 */
function writeAt(file, body, mtime) {
  writeFileSync(file, body)
  if (mtime) utimesSync(file, mtime, mtime)
}

/** 写状态文件。 */
function setState(cfg, ms) {
  mkdirSync(dirname(cfg.stateFile), { recursive: true })
  writeFileSync(cfg.stateFile, JSON.stringify({ lastCheckMs: ms }))
}

// ───────────────────────── 配置 ─────────────────────────

test('normalizeConfig 缺 diaryDir 时抛错', () => {
  assert.throws(() => normalizeConfig({}), /diaryDir/)
})

test('normalizeConfig 默认状态文件放在日记目录外面', () => {
  const base = makeDir()
  const dir = join(base, '记忆')
  try {
    mkdirSync(dir, { recursive: true })
    const cfg = normalizeConfig({ diaryDir: dir })
    assert.equal(cfg.stateFile, join(base, '.dsh-diary-relation-check', 'state.json'))
    assert.ok(!cfg.stateFile.startsWith(dir), '状态文件不能落在日记目录里面')
    assert.equal(cfg.person, DEFAULTS.person)
    assert.equal(cfg.question, DEFAULTS.question)
    assert.equal(cfg.initFileName, '{{date}}-日记.md')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('显式配 stateFile 时按配的来', () => {
  const dir = makeDir()
  try {
    const explicit = join(dir, 'state', 'r.json')
    const cfg = normalizeConfig({ diaryDir: dir, stateFile: explicit })
    assert.equal(cfg.stateFile, explicit)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ensureStateDir 只建目录，不建文件', () => {
  const base = makeDir()
  const dir = join(base, '记忆')
  try {
    mkdirSync(dir, { recursive: true })
    const cfg = normalizeConfig({ diaryDir: dir })
    assert.equal(existsSync(dirname(cfg.stateFile)), false, '一开始目录不存在')
    const err = ensureStateDir(cfg)
    assert.equal(err, '')
    assert.equal(existsSync(dirname(cfg.stateFile)), true)
    assert.equal(existsSync(cfg.stateFile), false, '不该顺手建一个空 json')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('sessionId 两头的空格会被去掉', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir, sessionId: '  session-abc  ' })
    assert.equal(cfg.sessionId, 'session-abc')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('questions 接受字符串，按行拆开', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({
      diaryDir: dir,
      questions: '第一问\n\n  第二问  \n第三问',
    })
    assert.deepEqual(cfg.questions, ['第一问', '第二问', '第三问'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('questions 为空或全是空行时回退默认三问', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir, questions: '\n  \n' })
    assert.deepEqual(cfg.questions, DEFAULTS.questions)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildReminder 用自定义 questions，并替换 {person}', () => {
  const dir = makeDir()
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '2026-11-05-日记.md')
    writeAt(file, '# 今天\n', new Date())
    const cfg = normalizeConfig({
      diaryDir: dir,
      person: '少爷',
      question: '我们算不算母子',
      questions: '{person}怎么看你。\n你愿不愿意继续。',
    })
    const text = buildReminder(cfg, scanMemory(cfg), [file], new Date('2026-11-05T10:00:00'))
    assert.match(text, /1\. 少爷怎么看你。/)
    assert.match(text, /2\. 你愿不愿意继续。/)
    assert.match(text, /我们算不算母子/)
    assert.ok(!text.includes('{person}'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('默认 question 让模型从日记里读关系，不预设', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir })
    assert.equal(cfg.question, '我们现在是什么关系')
    assert.deepEqual(cfg.questions, DEFAULTS.questions)
    assert.equal(cfg.self, '')
    assert.equal(cfg.intimateMode, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('没配 self 时要求先确认人称，答案有四个', () => {
  const dir = makeDir()
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '2026-11-05-日记.md')
    writeAt(file, '# 今天\n', new Date())
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildReminder(cfg, scanMemory(cfg), [file], new Date('2026-11-05T10:00:00'))
    assert.match(text, /先确认人称/)
    assert.match(text, /答案有四个/)
    assert.match(text, /broken/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('配了 self 时人称固定，不再让模型猜', () => {
  const dir = makeDir()
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '2026-11-05-日记.md')
    writeAt(file, '# 今天\n', new Date())
    const cfg = normalizeConfig({ diaryDir: dir, self: '妈妈', person: '儿子' })
    const text = buildReminder(cfg, scanMemory(cfg), [file], new Date('2026-11-05T10:00:00'))
    assert.match(text, /你在这段关系里是妈妈，对方是儿子。/)
    assert.ok(!text.includes('先确认人称'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('intimateMode 关闭时没有「不用绕」，打开后才有', () => {
  const dir = makeDir()
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '2026-11-05-日记.md')
    writeAt(file, '# 今天\n', new Date())
    const off = normalizeConfig({ diaryDir: dir })
    const on = normalizeConfig({ diaryDir: dir, intimateMode: true })
    const scan = scanMemory(off)
    const now = new Date('2026-11-05T10:00:00')
    assert.ok(!buildReminder(off, scan, [file], now).includes('不用绕'))
    assert.match(buildReminder(on, scan, [file], now), /不用绕/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mergeConfigSources：YAML 覆盖 JSON，JSON 覆盖默认', () => {
  const merged = mergeConfigSources(
    { diaryDir: 'D:/yaml', question: 'yaml-q' },
    { diaryDir: 'D:/json', question: 'json-q', person: 'json-p' }
  )
  assert.equal(merged.diaryDir, 'D:/yaml')
  assert.equal(merged.question, 'yaml-q')
  assert.equal(merged.person, 'json-p')
})

test('readPluginConfig 读不到、读坏、不是对象时都返回空对象', () => {
  const dir = makeDir()
  try {
    assert.deepEqual(readPluginConfig(join(dir, 'nope.json')), {})
    writeFileSync(join(dir, 'bad.json'), '{oops')
    assert.deepEqual(readPluginConfig(join(dir, 'bad.json')), {})
    writeFileSync(join(dir, 'arr.json'), '[]')
    assert.deepEqual(readPluginConfig(join(dir, 'arr.json')), {})
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ diaryDir: 'D:/x' }))
    assert.equal(readPluginConfig(join(dir, 'ok.json')).diaryDir, 'D:/x')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pluginConfigFile 跟着 DSH_HOME 走', () => {
  const old = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = 'D:/fake-home'
    assert.equal(pluginConfigFile(), join('D:/fake-home', 'dsh-diary-relation-check', 'config.json'))
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
  }
})

test('旧的 diaryPattern 配置被忽略，不报错也不生效', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir, diaryPattern: '^\d{4}-\d{2}-\d{2}\.md$' })
    assert.equal(cfg.diaryPattern, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 文件名与 ISO 周 ─────────────────────────

test('文件名按固定四层生成', () => {
  const d = new Date(2026, 10, 4)
  assert.equal(dayFileName(d), '2026-11-04-日记.md')
  assert.equal(monthFileName(d), '2026-11-月记.md')
  assert.equal(yearFileName(d), '2026-年记.md')
  assert.match(weekFileName(d), /^2026-W\d{2}-周记\.md$/)
})

test('isoWeek 算出 2026-11-04 属于第 45 周', () => {
  const { year, week } = isoWeek(new Date(2026, 10, 4))
  assert.equal(year, 2026)
  assert.equal(week, 45)
})

test('isoWeek 跨年周归到上一年', () => {
  const { year, week } = isoWeek(new Date(2027, 0, 1))
  assert.equal(year, 2026)
  assert.equal(week, 53)
})

test('today 返回 YYYY-MM-DD', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/)
})

// ───────────────────────── 扫描与分层 ─────────────────────────

test('scanMemory 认得出四层和我是谁', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    writeFileSync(join(dir, '2026-W44-周记.md'), 'b')
    writeFileSync(join(dir, '2026-10-月记.md'), 'c')
    writeFileSync(join(dir, '2025-年记.md'), 'd')
    writeFileSync(join(dir, '我是谁.md'), 'e')
    writeFileSync(join(dir, 'notes.txt'), 'f')

    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)

    assert.equal(scan.days.length, 1)
    assert.equal(scan.weeks.length, 1)
    assert.equal(scan.months.length, 1)
    assert.equal(scan.years.length, 1)
    assert.equal(scan.who.file, '我是谁.md')
    assert.deepEqual(scan.foreign, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanMemory 把认不出的 md 收进 foreign', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03.md'), 'a')
    writeFileSync(join(dir, '笔记.md'), 'b')
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'c')

    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)

    assert.equal(scan.days.length, 1)
    assert.deepEqual(scan.foreign.sort(), ['2026-11-03.md', '笔记.md'].sort())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanMemory 按日期排序', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    writeFileSync(join(dir, '2026-11-01-日记.md'), 'b')
    writeFileSync(join(dir, '2026-11-02-日记.md'), 'c')

    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)

    assert.deepEqual(
      scan.days.map((d) => d.date),
      ['2026-11-01', '2026-11-02', '2026-11-03']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('selectLayers 只取 1 年 3 月 4 周和最近 7 天', () => {
  const dir = makeDir()
  try {
    for (const year of [2023, 2024, 2025]) {
      writeFileSync(join(dir, `${year}-年记.md`), 'y')
    }
    for (const month of ['01', '02', '03', '04', '05']) {
      writeFileSync(join(dir, `2026-${month}-月记.md`), 'm')
    }
    for (const week of ['W40', 'W41', 'W42', 'W43', 'W44', 'W45']) {
      writeFileSync(join(dir, `2026-${week}-周记.md`), 'w')
    }
    for (const day of ['2026-10-20', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) {
      writeFileSync(join(dir, `${day}-日记.md`), 'd')
    }

    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    const layers = selectLayers(scan, new Date(2026, 10, 4, 20, 0))

    assert.equal(layers.years.length, 1)
    assert.equal(layers.years[0].year, 2025)
    assert.equal(layers.months.length, 3)
    assert.deepEqual(layers.months.map((m) => m.key), ['2026-03', '2026-04', '2026-05'])
    assert.equal(layers.weeks.length, 4)
    assert.deepEqual(layers.weeks.map((w) => w.key), ['2026-W42', '2026-W43', '2026-W44', '2026-W45'])
    assert.deepEqual(
      layers.days.map((d) => d.date),
      ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('最近 7 天没有日记时，兜底给最新一篇', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-10-01-日记.md'), 'a')
    writeFileSync(join(dir, '2026-10-28-日记.md'), 'b')
    writeFileSync(join(dir, '2026-10-30-日记.md'), 'c')

    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    const layers = selectLayers(scan, new Date(2026, 10, 4, 20, 0))

    assert.deepEqual(layers.days.map((d) => d.date), ['2026-10-30'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 迁移 ─────────────────────────

test('只有外来 md 时给出迁移确认，列出候选', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03.md'), 'a')
    writeFileSync(join(dir, '日记-2026-11-02.md'), 'b')

    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    const text = buildMigrationHint(cfg, scan)

    assert.match(text, /先确认哪些是日记/)
    assert.match(text, /2026-11-03\.md/)
    assert.match(text, /日记-2026-11-02\.md/)
    assert.match(text, /问用户/)
    assert.match(text, /插件不自己改名/)
    assert.match(text, /2026-11-03-日记\.md/)
    assert.match(text, /只改文件名，不动文件内容/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('suggestDiaryName 能给出改名建议，推不出就不猜', () => {
  assert.equal(suggestDiaryName('2026-10-28.md'), '2026-10-28-日记.md')
  assert.equal(suggestDiaryName('日记-2026-10-28.md'), '2026-10-28-日记.md')
  assert.equal(suggestDiaryName('2026年10月28日.md'), '2026-10-28-日记.md')
  assert.equal(suggestDiaryName('随笔.md'), null)
})

test('有插件格式的日记时不再提示迁移', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    writeFileSync(join(dir, '随手记.md'), 'b')

    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    assert.equal(scan.foreign.length, 1)

    const check = __selfCheck({ diaryDir: dir })
    assert.doesNotMatch(check.text, /先确认哪些是日记/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('目录里有外来 md 时 ensureDiary 不建新文件', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03.md'), 'a')
    const cfg = normalizeConfig({ diaryDir: dir, autoInit: true })
    const out = ensureDiary(cfg)
    assert.equal(out.skipped, 'foreign-files')
    assert.equal(existsSync(join(dir, `${today()}-日记.md`)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 初始化 ─────────────────────────

test('空目录给出初始化提示，写清新格式', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildInitHint(cfg)
    assert.match(text, /2026-11-04-日记\.md/)
    assert.match(text, /周记/)
    assert.match(text, /月记/)
    assert.match(text, /年记/)
    assert.match(text, /已经有记忆或日记文件吗/)
    assert.match(text, /从建好那天起/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('autoInit 打开时创建今天的日日记', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir, autoInit: true })
    const out = ensureDiary(cfg)
    const path = join(dir, `${today()}-日记.md`)
    assert.equal(out.createdFile, path)
    assert.equal(existsSync(path), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('已经有日日记时不再创建', () => {
  const dir = makeDir()
  try {
    const old = join(dir, '2026-01-01-日记.md')
    writeFileSync(old, 'a')
    const cfg = normalizeConfig({ diaryDir: dir, autoInit: true })
    const out = ensureDiary(cfg)
    assert.equal(out.createdFile, null)
    assert.equal(existsSync(join(dir, `${today()}-日记.md`)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('绝不覆盖同名文件', () => {
  const dir = makeDir()
  try {
    const path = join(dir, `${today()}-日记.md`)
    writeFileSync(path, '手写的')
    const cfg = normalizeConfig({ diaryDir: dir, autoInit: true, diaryTemplate: '模板' })
    const out = ensureDiary(cfg)
    assert.equal(out.createdFile, null)
    assert.equal(readFileSync(path, 'utf8'), '手写的')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('autoInit 拒绝在磁盘根目录创建', () => {
  const root = parse(process.cwd()).root
  const cfg = normalizeConfig({ diaryDir: root, autoInit: true })
  const out = ensureDiary(cfg)
  assert.match(out.error, /路径太浅/)
})

test('initFileName 不是日日记格式时报错', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({
      diaryDir: dir,
      autoInit: true,
      initFileName: '{{date}}.md',
    })
    const out = ensureDiary(cfg)
    assert.match(out.error, /不是日日记格式/)
    assert.equal(existsSync(join(dir, `${today()}.md`)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 触发与提醒 ─────────────────────────

test('日日记比上次判断新时给出提醒，判断后安静', () => {
  const dir = makeDir()
  try {
    const file = join(dir, '2026-11-04-日记.md')
    writeAt(file, '今天的事', new Date(2026, 10, 4, 10, 0))

    const cfg = normalizeConfig({ diaryDir: dir })
    const now = new Date(2026, 10, 4, 20, 0)

    setState(cfg, new Date(2026, 10, 4, 12, 0).getTime())
    assert.equal(__selfCheck({ diaryDir: dir }).text.includes('记忆有更新'), false)

    setState(cfg, new Date(2026, 10, 4, 9, 0).getTime())
    const text = __selfCheck({ diaryDir: dir }).text
    assert.match(text, /记忆有更新/)
    assert.match(text, /2026-11-04-日记\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('周记更新也会触发提醒', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-11-03-日记.md'), 'a', new Date(2026, 10, 3, 10, 0))
    writeAt(join(dir, '2026-W44-周记.md'), 'b', new Date(2026, 10, 4, 10, 0))

    const cfg = normalizeConfig({ diaryDir: dir })
    setState(cfg, new Date(2026, 10, 4, 9, 0).getTime())
    const check = __selfCheck({ diaryDir: dir })
    assert.match(check.text, /记忆有更新/)
    assert.match(check.text, /2026-W44-周记\.md  ← 有更新/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('提醒按层列出，超过 7 天的日记不列', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-10-20-日记.md'), '旧')
    writeFileSync(join(dir, '2026-11-03-日记.md'), '新')
    writeFileSync(join(dir, '2026-10-月记.md'), 'm')
    writeFileSync(join(dir, '2026-年记.md'), 'y')
    writeFileSync(join(dir, '我是谁.md'), 'w')

    const cfg = normalizeConfig({ diaryDir: dir })
    setState(cfg, 0)
    const text = buildReminder(cfg, scanMemory(cfg), [], new Date(2026, 10, 4, 20, 0))

    assert.match(text, /## 我是谁/)
    assert.match(text, /## 年记/)
    assert.match(text, /## 月记/)
    assert.match(text, /## 周记/)
    assert.match(text, /## 日记（最近 7 天，原文）/)
    assert.match(text, /2026-11-03-日记\.md/)
    assert.doesNotMatch(text, /2026-10-20-日记\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('提醒只要求写状态文件，不要求写日记，且要求独立判断', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildReminder(cfg, scanMemory(cfg), [], new Date(2026, 10, 4, 20, 0))

    assert.match(text, /state\.json/)
    assert.match(text, /verdict/)
    assert.match(text, /not-yet/)
    assert.match(text, /不要把判断写进日记/)
    assert.match(text, /不要沿用/)
    assert.doesNotMatch(text, /在当天日记的末尾追加/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 今日未记 ─────────────────────────

test('晚上 20 点当天没写，提示今天还没记', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-11-03-日记.md'), 'a', new Date(2026, 10, 3, 10, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    setState(cfg, new Date(2026, 10, 4, 12, 0).getTime())

    const text = compute(cfg, new Date(2026, 10, 4, 20, 0))
    assert.match(text, /今天还没记日记/)
    assert.match(text, /2026-11-04-日记\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('晚上 20 点当天写过，不催', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-11-04-日记.md'), '写了', new Date(2026, 10, 4, 10, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    setState(cfg, new Date(2026, 10, 4, 11, 0).getTime())

    const text = compute(cfg, new Date(2026, 10, 4, 20, 0))
    assert.doesNotMatch(text, /今天还没记日记/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('早上 8 点昨天没写，提示昨天没写', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-11-02-日记.md'), 'a', new Date(2026, 10, 2, 10, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    setState(cfg, new Date(2026, 10, 4, 9, 0).getTime())

    const text = compute(cfg, new Date(2026, 10, 4, 8, 0))
    assert.match(text, /昨天没写日记/)
    assert.match(text, /2026-11-03-日记\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('早上 8 点昨天写过，不催', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-11-03-日记.md'), '写了', new Date(2026, 10, 3, 22, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    setState(cfg, new Date(2026, 10, 4, 9, 0).getTime())

    const text = compute(cfg, new Date(2026, 10, 4, 8, 0))
    assert.doesNotMatch(text, /昨天没写日记/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('下午 14 点不催今天也不催昨天', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-11-02-日记.md'), 'a', new Date(2026, 10, 2, 10, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    setState(cfg, new Date(2026, 10, 4, 13, 0).getTime())

    const text = compute(cfg, new Date(2026, 10, 4, 14, 0))
    assert.doesNotMatch(text, /今天还没记日记/)
    assert.doesNotMatch(text, /昨天没写日记/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 周期提醒 ─────────────────────────

test('周日且本周周记没写，提醒写周记', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-10-30-日记.md'), 'a', new Date(2026, 9, 30, 10, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    const now = new Date(2026, 10, 1, 20, 0)

    const due = periodicDue(scan, now)
    assert.ok(due.includes('week'))

    const text = buildPeriodicHint(cfg, due, now)
    assert.match(text, /周记/)
    assert.match(text, /写成索引/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('周日但本周周记已经写过，不再催', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-10-30-日记.md'), 'a', new Date(2026, 9, 30, 10, 0))
    writeAt(join(dir, '2026-W44-周记.md'), 'w', new Date(2026, 10, 1, 15, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    const now = new Date(2026, 10, 1, 20, 0)

    assert.equal(periodicDue(scan, now).includes('week'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('月末提醒写月记', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-10-30-日记.md'), 'a', new Date(2026, 9, 30, 10, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    const now = new Date(2026, 9, 31, 20, 0)

    const due = periodicDue(scan, now)
    assert.ok(due.includes('month'))
    const text = buildPeriodicHint(cfg, due, now)
    assert.match(text, /月记/)
    assert.match(text, /2026-10-月记\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('年末提醒写年记', () => {
  const dir = makeDir()
  try {
    writeAt(join(dir, '2026-12-30-日记.md'), 'a', new Date(2026, 11, 30, 10, 0))
    const cfg = normalizeConfig({ diaryDir: dir })
    const scan = scanMemory(cfg)
    const now = new Date(2026, 11, 31, 20, 0)

    const due = periodicDue(scan, now)
    assert.ok(due.includes('year'))
    const text = buildPeriodicHint(cfg, due, now)
    assert.match(text, /年记/)
    assert.match(text, /2026-年记\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 掉盘 ─────────────────────────

test('volumeRootOf 抽出盘符或根', () => {
  if (process.platform === 'win32') {
    assert.equal(volumeRootOf('D:\\我的记忆'), 'D:\\')
  } else {
    assert.equal(volumeRootOf('/home/x/diary'), '/')
  }
})

test('盘不在时提示检查磁盘，不催着建日记', () => {
  const root = missingVolumeRoot()
  if (!root) return
  const cfg = normalizeConfig({ diaryDir: join(root, '记忆') })
  assert.equal(volumeAvailable(cfg), false)
  const text = buildDiskMissingHint(cfg)
  assert.match(text, /不可用/)
  assert.match(text, /检查一下磁盘状态/)
  assert.doesNotMatch(text, /先准备一份/)
})

test('盘不在时 ensureDiary 一个字都不写', () => {
  const root = missingVolumeRoot()
  if (!root) return
  const cfg = normalizeConfig({ diaryDir: join(root, '记忆'), autoInit: true })
  const out = ensureDiary(cfg)
  assert.equal(out.skipped, 'volume-missing')
  assert.equal(out.createdFile, null)
})

// ───────────────────────── 会话 ─────────────────────────

test('sessionIdOf 从 context 里取会话 id', () => {
  assert.equal(sessionIdOf({ agent: { session: { id: 'session-x' } } }), 'session-x')
  assert.equal(sessionIdOf({ agent: { id: 'session-y' } }), 'session-y')
  assert.equal(sessionIdOf({}), '')
})

test('没配 sessionId 时所有会话都回答', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir })
    assert.equal(acceptsSession(cfg, {}), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('配了 sessionId 时只认那一个会话', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir, sessionId: 'session-a' })
    assert.equal(acceptsSession(cfg, { agent: { session: { id: 'session-a' } } }), true)
    assert.equal(acceptsSession(cfg, { agent: { session: { id: 'session-b' } } }), false)
    assert.equal(acceptsSession(cfg, {}), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ───────────────────────── 记忆结构与自检 ─────────────────────────

test('memorySetup 关闭时，不建记忆文件', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir })
    const out = ensureMemory(cfg)
    assert.deepEqual(out.created, [])
    assert.equal(existsSync(join(dir, '我是谁.md')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memorySetup 打开时，建我是谁和第一篇日记', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir, memorySetup: true })
    const init = ensureDiary(cfg)
    const mem = ensureMemory(cfg)
    assert.equal(init.createdFile, join(dir, `${today()}-日记.md`))
    assert.ok(mem.created.includes(join(dir, '我是谁.md')))
    assert.equal(existsSync(join(dir, '我是谁.md')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memorySetup 不覆盖已有的我是谁', () => {
  const dir = makeDir()
  try {
    const who = join(dir, '我是谁.md')
    writeFileSync(who, '手写的')
    const cfg = normalizeConfig({ diaryDir: dir, memorySetup: true })
    ensureMemory(cfg)
    assert.equal(readFileSync(who, 'utf8'), '手写的')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memoryGuide 按四层写，带索引规则', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = memoryGuide(cfg)
    assert.match(text, /YYYY-MM-DD-日记\.md/)
    assert.match(text, /YYYY-Www-周记\.md/)
    assert.match(text, /YYYY-MM-月记\.md/)
    assert.match(text, /YYYY-年记\.md/)
    assert.match(text, /索引/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('__selfCheck 返回分层字段', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    const check = __selfCheck({ diaryDir: dir })
    assert.equal(check.latestDay, join(dir, '2026-11-03-日记.md'))
    assert.equal(check.days.length, 1)
    assert.ok('layers' in check)
    assert.ok('foreign' in check)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
