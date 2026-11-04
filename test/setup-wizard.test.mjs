import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initMemoryDir, inspectMemoryDir, today } from '../lib/index.js'

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'relation-setup-'))
}

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'relation-setup-home-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return fn(home)
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
}

test('inspectMemoryDir：空目录返回 exists=false，不建任何东西', () => {
  const base = makeDir()
  try {
    const target = join(base, '还没建')
    const result = inspectMemoryDir(target)
    assert.equal(result.ok, true)
    assert.equal(result.exists, false)
    assert.equal(result.hasAny, false)
    assert.equal(existsSync(target), false, '检查不该建目录')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('inspectMemoryDir：识别四层和我是谁', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    writeFileSync(join(dir, '2026-W44-周记.md'), 'b')
    writeFileSync(join(dir, '我是谁.md'), 'c')

    const result = inspectMemoryDir(dir)
    assert.equal(result.ok, true)
    assert.equal(result.exists, true)
    assert.equal(result.isDir, true)
    assert.equal(result.days, 1)
    assert.equal(result.weeks, 1)
    assert.equal(result.who, true)
    assert.equal(result.hasAny, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspectMemoryDir：旧命名给改名建议，不改文件', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-10-28.md'), 'a')
    writeFileSync(join(dir, '随笔.md'), 'b')

    const result = inspectMemoryDir(dir)
    assert.equal(result.ok, true)
    assert.equal(result.foreign.length, 2)

    const dated = result.foreign.find((item) => item.file === '2026-10-28.md')
    assert.equal(dated.suggestion, '2026-10-28-日记.md')

    const note = result.foreign.find((item) => item.file === '随笔.md')
    assert.equal(note.suggestion, null)

    assert.equal(readFileSync(join(dir, '2026-10-28.md'), 'utf8'), 'a')
    assert.equal(readFileSync(join(dir, '随笔.md'), 'utf8'), 'b')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('initMemoryDir：空目录建我是谁和今天的日日记，写 config.json', () => {
  withHome((home) => {
    const base = makeDir()
    try {
      const target = join(base, '我的记忆')
      const result = initMemoryDir(target, 'fresh')

      assert.equal(result.ok, true)
      assert.equal(result.needRestart, true)
      assert.equal(result.configSaved, true)
      assert.ok(result.created.includes(join(target, '我是谁.md')))
      assert.ok(result.created.includes(join(target, `${today()}-日记.md`)))
      assert.equal(existsSync(join(target, '我是谁.md')), true)

      const saved = JSON.parse(readFileSync(join(home, 'dsh-diary-relation-check', 'config.json'), 'utf8'))
      assert.equal(saved.diaryDir, target)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

test('initMemoryDir：已有记忆时拒绝，不覆盖', () => {
  withHome(() => {
    const dir = makeDir()
    try {
      writeFileSync(join(dir, '2026-11-03-日记.md'), '原样')
      const result = initMemoryDir(dir, 'fresh')
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'already-has-memory')
      assert.equal(readFileSync(join(dir, '2026-11-03-日记.md'), 'utf8'), '原样')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('initMemoryDir：目录里有认不出的 md 时拒绝', () => {
  withHome(() => {
    const dir = makeDir()
    try {
      writeFileSync(join(dir, '2026-10-28.md'), 'x')
      const result = initMemoryDir(dir, 'fresh')
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'has-foreign-files')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('initMemoryDir：盘根拒绝', () => {
  withHome(() => {
    const result = initMemoryDir('C:\\', 'fresh')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unsafe-dir')
  })
})

test('initMemoryDir：重复调用不覆盖已有文件', () => {
  withHome(() => {
    const base = makeDir()
    try {
      const target = join(base, '记忆')
      initMemoryDir(target, 'fresh')
      const who = join(target, '我是谁.md')
      writeFileSync(who, '手写的')

      const second = initMemoryDir(target, 'fresh')
      // 第二次会被「已有记忆」挡住（今天那篇已经建出来了）
      assert.equal(second.ok, false)
      assert.equal(readFileSync(who, 'utf8'), '手写的')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
