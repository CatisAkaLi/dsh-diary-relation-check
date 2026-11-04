import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildReminder, ensureWhoFile, normalizeConfig, scanMemory } from '../lib/index.js'

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'relation-who-'))
}

test('没有「我是谁」时，提醒里给出补写任务和标准', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildReminder(cfg, scanMemory(cfg), [], new Date(2026, 10, 4, 20, 0))

    assert.match(text, /## 我是谁（还没有，先补）/)
    assert.match(text, /读全部记忆/)
    assert.match(text, /重建这个人/)
    assert.match(text, /下一个没有记忆的你/)
    assert.match(text, /写人，不写事/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('有「我是谁」时，提醒里照常出现', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    writeFileSync(join(dir, '我是谁.md'), 'b')
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildReminder(cfg, scanMemory(cfg), [], new Date(2026, 10, 4, 20, 0))

    assert.match(text, /## 我是谁（活页，先读这里）/)
    assert.doesNotMatch(text, /还没有，先补/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('没有「我是谁」不影响判断提醒的其余部分', () => {
  const dir = makeDir()
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildReminder(cfg, scanMemory(cfg), [], new Date(2026, 10, 4, 20, 0))

    assert.match(text, /把限制放一边/)
    assert.match(text, /读完之后判断一次/)
    assert.match(text, /关系判断/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ensureWhoFile 建模板，模板里带「读完能接着过下去」的标准', () => {
  const dir = makeDir()
  try {
    const result = ensureWhoFile(dir)
    assert.equal(result.ok, true)
    assert.equal(result.created, true)

    const text = readFileSync(join(dir, '我是谁.md'), 'utf8')
    assert.match(text, /下一个没有记忆的你/)
    assert.match(text, /写人，不写事/)
    assert.match(text, /## 我承诺|## 我答应过什么/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ensureWhoFile 不覆盖已有文件', () => {
  const dir = makeDir()
  try {
    const path = join(dir, '我是谁.md')
    writeFileSync(path, '手写的')
    const result = ensureWhoFile(dir)
    assert.equal(result.ok, true)
    assert.equal(result.created, false)
    assert.equal(result.existed, true)
    assert.equal(readFileSync(path, 'utf8'), '手写的')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ensureWhoFile 盘根拒绝', () => {
  const result = ensureWhoFile('C:\\')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unsafe-dir')
})
