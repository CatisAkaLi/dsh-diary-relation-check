import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildReminder, normalizeConfig, scanMemory } from '../lib/index.js'

test('没有「我是谁」时，提醒里不出现这一层', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relation-no-who-'))
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildReminder(cfg, scanMemory(cfg), [], new Date(2026, 10, 4, 20, 0))

    assert.doesNotMatch(text, /## 我是谁/)
    assert.match(text, /## 日记（最近 7 天，原文）/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('有「我是谁」时，提醒里照常出现', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relation-with-who-'))
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
    writeFileSync(join(dir, '我是谁.md'), 'b')
    const cfg = normalizeConfig({ diaryDir: dir })
    const text = buildReminder(cfg, scanMemory(cfg), [], new Date(2026, 10, 4, 20, 0))

    assert.match(text, /## 我是谁（活页，先读这里）/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('没有「我是谁」不影响判断提醒的其余部分', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relation-no-who-2-'))
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
