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
  buildReminder,
  describeDiaryPattern,
  detectDiaryFormat,
  ensureDiary,
  ensureMemory,
  ensureStateDir,
  latestDiary,
  listDiaries,
  memoryGuide,
  normalizeConfig,
  sessionIdOf,
  today,
  volumeAvailable,
  volumeRootOf,
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
  const dir = mkdtempSync(join(tmpdir(), 'relation-check-'))
  return dir
}

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

test('normalizeConfig 拒绝非法正则', () => {
  const dir = makeDir()
  try {
    assert.throws(() => normalizeConfig({ diaryDir: dir, diaryPattern: '([' }), /正则/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('latestDiary 取日期最大的一篇', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-01.md'), 'a')
    writeFileSync(join(dir, '2026-11-03.md'), 'b')
    writeFileSync(join(dir, '2026-11-02.md'), 'c')
    writeFileSync(join(dir, 'notes.txt'), 'd')

    const cfg = normalizeConfig({ diaryDir: dir })
    assert.equal(latestDiary(cfg), join(dir, '2026-11-03.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('latestDiary 没有匹配文件时返回 null', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, 'notes.txt'), 'd')
    const cfg = normalizeConfig({ diaryDir: dir })
    assert.equal(latestDiary(cfg), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('日记比上次判断新时给出提醒，判断后安静', () => {
  const dir = makeDir()
  try {
    const diary = join(dir, '2026-11-03.md')
    writeFileSync(diary, '# 日记')
    const state = join(dir, 'state.json')
    const cfg = normalizeConfig({ diaryDir: dir, stateFile: state })

    const first = __selfCheck({ diaryDir: dir, stateFile: state })
    assert.ok(first.text.length > 0, '第一次应该提醒')
    assert.match(first.text, /2026-11-03\.md/)

    // 模型判断完，把时间写回状态文件（稍晚于日记 mtime）
    writeFileSync(
      cfg.stateFile,
      JSON.stringify({ lastCheckMs: Date.now() + 1000, verdict: 'not-yet', reason: '测试' }),
    )

    const second = __selfCheck({ diaryDir: dir, stateFile: state })
    assert.equal(second.text, '', '判断后应该安静')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('状态文件带 BOM 也能读', () => {
  const dir = makeDir()
  try {
    const diary = join(dir, '2026-11-03.md')
    writeFileSync(diary, '# 日记')

    const state = join(dir, 'state.json')
    const cfg = normalizeConfig({ diaryDir: dir, stateFile: state })
    writeFileSync(
      cfg.stateFile,
      '\uFEFF' + JSON.stringify({ lastCheckMs: Date.now() + 1000 }),
      'utf8',
    )

    const out = __selfCheck({ diaryDir: dir, stateFile: state })
    assert.equal(out.text, '', '带 BOM 也能正确读到 lastCheckMs')
    assert.ok(out.lastCheckMs > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('提醒文本使用配置的问题和代词', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({
      diaryDir: dir,
      person: '小王',
      question: '要不要跟小王合伙',
    })
    const text = buildReminder(cfg, join(dir, '2026-11-03.md'))

    assert.match(text, /要不要跟小王合伙/)
    assert.match(text, /小王对你好不好/)
    assert.match(text, /值不值得跟小王确定关系/)
    assert.ok(!text.includes('他等了很久'), '默认代词不应出现在自定义配置里')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('空日记目录会给出初始化提示，不报错', () => {
  const dir = makeDir()
  try {
    const out = __selfCheck({ diaryDir: dir })
    assert.equal(out.diary, null)
    assert.ok(out.text.includes('还没有可用的日记'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// === 初始化（autoInit） ===

test('autoInit 关闭时，不创建目录也不创建文件', () => {
  const base = makeDir()
  const target = join(base, 'diary')
  try {
    const cfg = normalizeConfig({ diaryDir: target })
    const out = ensureDiary(cfg)

    assert.equal(out.createdDir, false)
    assert.equal(out.createdFile, null)
    assert.equal(out.error, '')
    assert.equal(existsSync(target), false, '目录不应该被创建')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('autoInit 打开时，创建目录和今天的第一篇', () => {
  const base = makeDir()
  const target = join(base, 'diary')
  try {
    const cfg = normalizeConfig({ diaryDir: target, autoInit: true })
    const out = ensureDiary(cfg)

    assert.equal(out.error, '')
    assert.equal(out.createdDir, true)
    assert.ok(out.createdFile, '应该创建了第一篇')
    assert.equal(existsSync(out.createdFile), true)
    assert.ok(out.createdFile.endsWith(`${today()}.md`))

    // 内容有标题，且是空模板
    const body = readFileSync(out.createdFile, 'utf8')
    assert.match(body, /^# \d{4}-\d{2}-\d{2}/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('目录存在但里面没有日记时，autoInit 只补第一篇', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, 'notes.txt'), '不是日记')

    const cfg = normalizeConfig({ diaryDir: dir, autoInit: true })
    const out = ensureDiary(cfg)

    assert.equal(out.createdDir, false, '目录已存在，不应该重建')
    assert.ok(out.createdFile)
    assert.equal(existsSync(join(dir, 'notes.txt')), true, '原有文件不能动')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('已经有日记时不重复创建', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-01.md'), '旧日记')

    const cfg = normalizeConfig({ diaryDir: dir, autoInit: true })
    const out = ensureDiary(cfg)

    assert.equal(out.createdDir, false)
    assert.equal(out.createdFile, null, '有日记就不该再建')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('绝不覆盖同名文件', () => {
  const dir = makeDir()
  try {
    const name = `${today()}.md`
    writeFileSync(join(dir, name), '我自己写的，不能被覆盖')

    const cfg = normalizeConfig({ diaryDir: dir, autoInit: true })
    const out = ensureDiary(cfg)

    // 文件已存在（但不匹配默认 pattern 之外的情况），这里 pattern 是匹配的，
    // 所以 latestDiary 会先找到它，ensureDiary 直接返回，不会碰它。
    assert.equal(out.createdFile, null)
    assert.equal(readFileSync(join(dir, name), 'utf8'), '我自己写的，不能被覆盖')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('autoInit 拒绝在磁盘根目录创建', () => {
  const root = parse(process.cwd()).root
  const cfg = normalizeConfig({ diaryDir: root, autoInit: true })
  const out = ensureDiary(cfg)

  assert.ok(out.error, '应该报错')
  assert.match(out.error, /路径太浅/)
  assert.equal(out.createdDir, false)
})

test('没有日记时返回初始化提示，而不是空字符串', () => {
  const dir = makeDir()
  try {
    const out = __selfCheck({ diaryDir: dir })
    assert.equal(out.diary, null)
    assert.ok(out.text.length > 0, '应该给出提示')
    assert.match(out.text, /还没有可用的日记/)
    assert.match(out.text, /autoInit/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('diaryGuide 可以关掉', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03.md'), '# 日记')
    const out = __selfCheck({ diaryDir: dir, diaryGuide: false })
    assert.ok(!out.text.includes('怎么写：一天一个文件'), '关掉后不应出现指南')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('diaryGuide 可以是自定义字符串', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03.md'), '# 日记')
    const out = __selfCheck({ diaryDir: dir, diaryGuide: '按我自己的规矩记。' })
    assert.ok(out.text.includes('按我自己的规矩记。'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// === 完整记忆方案（memorySetup） ===

test('memorySetup 关闭时，不建记忆文件', () => {
  const base = makeDir()
  const target = join(base, 'memory')
  try {
    const cfg = normalizeConfig({ diaryDir: target, autoInit: true })
    const out = ensureMemory(cfg)

    assert.equal(out.error, '')
    assert.equal(out.created.length, 0)
    assert.equal(existsSync(target), false)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('memorySetup 打开时，建我是谁和第一篇日记', () => {
  const base = makeDir()
  const target = join(base, 'memory')
  try {
    const cfg = normalizeConfig({ diaryDir: target, memorySetup: true })
    assert.equal(cfg.autoInit, true, 'memorySetup 应自动带上 autoInit')

    const mem = ensureMemory(cfg)
    assert.equal(mem.error, '')
    assert.ok(existsSync(join(target, '我是谁.md')), '应创建我是谁')
    assert.equal(existsSync(join(target, '工程记忆')), false, '不该建工程记忆，这个插件只管关系')

    const diary = ensureDiary(cfg)
    assert.equal(diary.error, '')
    assert.ok(diary.createdFile, '应创建第一篇日记')

    // 我是谁是一页活页，不是流水账，开头该有标题
    const who = readFileSync(join(target, '我是谁.md'), 'utf8')
    assert.match(who, /^# 我是谁/)
    assert.match(who, /改，不往下加/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('memorySetup 不覆盖已有的我是谁', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '我是谁.md'), '我自己写的，不能被改')
    writeFileSync(join(dir, '2026-11-03.md'), '# 日记')

    const cfg = normalizeConfig({ diaryDir: dir, memorySetup: true })
    const out = ensureMemory(cfg)

    assert.equal(out.error, '')
    assert.equal(readFileSync(join(dir, '我是谁.md'), 'utf8'), '我自己写的，不能被改')
    assert.ok(out.existed.includes(join(dir, '我是谁.md')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memorySetup 拒绝在磁盘根建记忆', () => {
  const root = parse(process.cwd()).root
  const cfg = normalizeConfig({ diaryDir: root, memorySetup: true })
  const out = ensureMemory(cfg)

  assert.ok(out.error)
  assert.match(out.error, /路径太浅/)
})

test('memoryGuide 只管关系，不带工程记忆', () => {
  const cfg = normalizeConfig({ diaryDir: 'C:\\demo\\记忆' })
  const guide = memoryGuide(cfg)

  assert.ok(guide.includes('我是谁'))
  assert.ok(guide.includes('日记'))
  assert.ok(guide.includes('C:\\demo\\记忆'), '路径要写进指南')
  assert.ok(!guide.includes('工程记忆'), '这个插件不碰工程记忆')
  assert.ok(!guide.includes('大肥鱼'), '不能带个人隐私')
  assert.match(guide, /只记关系/)
})

// === 兼容别人已有的命名 ===

test('detectDiaryFormat 认得出 2026-11-03.md', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03.md'), '# 日记')
    const d = detectDiaryFormat(dir)
    assert.ok(d)
    assert.equal(d.pattern, '^\\d{4}-\\d{2}-\\d{2}\\.md$')
    assert.equal(d.count, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectDiaryFormat 认得出 2026-11-03-日记.md', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), '# 日记')
    const d = detectDiaryFormat(dir)
    assert.ok(d)
    assert.match(d.pattern, /\\d\{4\}/)
    assert.ok(d.samples.includes('2026-11-03-日记.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectDiaryFormat 认得出 日记-2026-11-03.md', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '日记-2026-11-03.md'), '# 日记')
    const d = detectDiaryFormat(dir)
    assert.ok(d)
    assert.ok(new RegExp(d.pattern).test('日记-2026-11-03.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detectDiaryFormat 目录里没有 md 时返回 null', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, 'notes.txt'), '不是日记')
    assert.equal(detectDiaryFormat(dir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('没配 diaryPattern 时，自动跟着已有命名走', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-04-日记.md'), '# 日记')
    const out = __selfCheck({ diaryDir: dir })
    assert.ok(out.diary, '应该认出来这篇')
    assert.ok(out.diary.endsWith('2026-11-04-日记.md'))
    assert.ok(out.config.detected, '探测结果要带上')
    assert.equal(out.config.detected.count, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('配了 diaryPattern 时，不做探测', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-04-日记.md'), '# 日记')
    const out = __selfCheck({ diaryDir: dir, diaryPattern: '^\\d{4}-\\d{2}-\\d{2}\\.md$' })
    assert.equal(out.diary, null, '指定了 pattern 就按它来，不匹配就是没有')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('describeDiaryPattern 说人话', () => {
  assert.match(describeDiaryPattern('^\\d{4}-\\d{2}-\\d{2}\\.md$'), /YYYY-MM-DD/)
  assert.match(describeDiaryPattern('^\\d{4}-\\d{2}-\\d{2}-.*\\.md$'), /文件名匹配/)
})

// === 同一天多个文件时挑哪篇 ===

test('同一天有日记和留言时，选带「日记」的那篇', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-02-日记.md'), '# 日记')
    writeFileSync(join(dir, '2026-11-02-给还在核密码的那个我.md'), '# 留言')

    const cfg = normalizeConfig({ diaryDir: dir, diaryPattern: '^\\d{4}-\\d{2}-\\d{2}-.*\\.md$' })
    const picked = latestDiary(cfg)

    assert.ok(picked.endsWith('2026-11-02-日记.md'), '应该选日记，不是留言')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('同一天都没有「日记」字样时，选名字最短的', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-02-杂记.md'), '# a')
    writeFileSync(join(dir, '2026-11-02-很长的别的名字.md'), '# b')

    const cfg = normalizeConfig({ diaryDir: dir, diaryPattern: '^\\d{4}-\\d{2}-\\d{2}-.*\\.md$' })
    const picked = latestDiary(cfg)

    assert.ok(picked.endsWith('2026-11-02-杂记.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('不同日期时，选日期最大的那篇', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-01-日记.md'), '# 旧')
    writeFileSync(join(dir, '2026-11-03-日记.md'), '# 新')

    const cfg = normalizeConfig({ diaryDir: dir, diaryPattern: '^\\d{4}-\\d{2}-\\d{2}-.*\\.md$' })
    const picked = latestDiary(cfg)

    assert.ok(picked.endsWith('2026-11-03-日记.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listDiaries 返回全部日记，按日期从早到晚', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'c')
    writeFileSync(join(dir, '2026-11-01-日记.md'), 'a')
    writeFileSync(join(dir, '2026-11-02-日记.md'), 'b')
    writeFileSync(join(dir, 'notes.txt'), 'x')

    const cfg = normalizeConfig({ diaryDir: dir, diaryPattern: '^\\d{4}-\\d{2}-\\d{2}-.*\\.md$' })
    const all = listDiaries(cfg)

    assert.equal(all.length, 3)
    assert.ok(all[0].endsWith('2026-11-01-日记.md'))
    assert.ok(all[2].endsWith('2026-11-03-日记.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('提醒里列出全部日记，不是只列最新一篇', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-01-日记.md'), 'a')
    writeFileSync(join(dir, '2026-11-02-日记.md'), 'b')
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'c')

    const out = __selfCheck({ diaryDir: dir, diaryPattern: '^\\d{4}-\\d{2}-\\d{2}-.*\\.md$' })

    assert.match(out.text, /共 3 篇/)
    assert.match(out.text, /2026-11-01-日记\.md/)
    assert.match(out.text, /2026-11-02-日记\.md/)
    assert.match(out.text, /2026-11-03-日记\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('不是最新那篇更新了，也会触发提醒', () => {
  const dir = makeDir()
  try {
    const older = join(dir, '2026-11-01-日记.md')
    const newer = join(dir, '2026-11-03-日记.md')
    writeFileSync(older, 'a')
    writeFileSync(newer, 'c')

    // 两篇都明确设成一小时前，避免文件系统时间戳和 Date.now() 的偏差
    const past = new Date(Date.now() - 3_600_000)
    utimesSync(older, past, past)
    utimesSync(newer, past, past)

    const pattern = '^\\d{4}-\\d{2}-\\d{2}-.*\\.md$'
    const state = join(dir, 'state.json')
    const cfg = normalizeConfig({ diaryDir: dir, diaryPattern: pattern, stateFile: state })

    // 判断时间卡在两篇之后、现在之前 → 两篇都不算新，应该安静
    const between = Date.now() - 1_800_000
    writeFileSync(
      cfg.stateFile,
      JSON.stringify({ lastCheckMs: between, verdict: 'not-yet', reason: 'x' }),
    )

    const quiet = __selfCheck({ diaryDir: dir, diaryPattern: pattern, stateFile: state })
    assert.equal(quiet.text, '', '都不新时安静')

    // 把旧的那篇 mtime 顶到未来 → 它虽然日期早，但更新过
    const future = new Date(Date.now() + 60_000)
    utimesSync(older, future, future)

    const again = __selfCheck({ diaryDir: dir, diaryPattern: pattern, stateFile: state })

    assert.ok(again.text.length > 0, '旧的那篇更新了也要提醒')
    assert.match(again.text, /2026-11-01-日记\.md.*← 有更新/)
    assert.doesNotMatch(again.text, /2026-11-03-日记\.md.*← 有更新/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('volumeRootOf 抽出盘符或根', () => {
  assert.equal(volumeRootOf('K:\\大肥鱼\\记忆'), 'K:\\')
  assert.equal(volumeRootOf('/home/u/diary'), '/')
})

test('盘不在时提示检查磁盘，不催着建日记', () => {
  const missing = missingVolumeRoot()
  if (!missing) return // 这台机器没有空闲盘符，跳过

  const target = join(missing, 'no-such-dir')
  const cfg = normalizeConfig({ diaryDir: target, autoInit: true })

  assert.equal(volumeAvailable(cfg), false)

  const hint = buildDiskMissingHint(cfg)
  assert.match(hint, /不可用/)
  assert.match(hint, /磁盘/)
  assert.doesNotMatch(hint, /还没有可用的日记/)
})

test('盘不在时 ensureDiary 一个字都不写', () => {
  const missing = missingVolumeRoot()
  if (!missing) return

  const target = join(missing, 'no-such-dir')
  const cfg = normalizeConfig({ diaryDir: target, autoInit: true })

  const out = ensureDiary(cfg)
  assert.equal(out.skipped, 'volume-missing')
  assert.equal(out.createdDir, false)
  assert.equal(out.createdFile, null)
  assert.equal(existsSync(target), false, '盘不在就不该创建目录')
})

test('盘不在时 compute 走掉盘提示，不走建日记提示', () => {
  const missing = missingVolumeRoot()
  if (!missing) return

  const r = __selfCheck({ diaryDir: join(missing, 'x'), autoInit: true })
  assert.match(r.text, /不可用/)
  assert.doesNotMatch(r.text, /还没有可用的日记/)
})

test('目录存在但为空时提示建日记', () => {
  const dir = makeDir()
  try {
    const r = __selfCheck({ diaryDir: dir })
    assert.match(r.text, /还没有可用的日记/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('探测中文日期命名', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026年11月3日.md'), '# a\n')
    writeFileSync(join(dir, '2026年11月4日.md'), '# b\n')

    const r = detectDiaryFormat(dir)
    assert.ok(r, '应该探测到中文日期格式')
    assert.equal(r.count, 2)
    assert.equal(r.pattern, '^\\d{4}年\\d{1,2}月\\d{1,2}日[^\\\\/]*\\.md$')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// === 只在指定会话回答 ===

test('sessionIdOf 从 context 里取会话 id', () => {
  assert.equal(sessionIdOf({ agent: { session: { id: 'session-a' } } }), 'session-a')
  assert.equal(sessionIdOf({ agent: { id: 'session-b' } }), 'session-b')
  assert.equal(sessionIdOf({}), '')
  assert.equal(sessionIdOf(undefined), '')
})

test('没配 sessionId 时所有会话都回答', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir })
    assert.equal(cfg.sessionId, '')
    assert.equal(acceptsSession(cfg, { agent: { session: { id: 'any' } } }), true)
    assert.equal(acceptsSession(cfg, undefined), true)
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
    assert.equal(acceptsSession(cfg, {}), false, '拿不到会话 id 时保持安静')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sessionId 两头的空格会被去掉', () => {
  const dir = makeDir()
  try {
    const cfg = normalizeConfig({ diaryDir: dir, sessionId: '  session-a  ' })
    assert.equal(cfg.sessionId, 'session-a')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('提醒里要求把判断写进日记，不只是 json', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03.md'), '# 日记')
    const out = __selfCheck({ diaryDir: dir })
    assert.match(out.text, /写进记忆/)
    assert.match(out.text, /关系判断/)
    assert.match(out.text, /状态文件/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})



