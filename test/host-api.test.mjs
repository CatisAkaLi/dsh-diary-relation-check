import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/index.js'

function fakeCtx() {
  const routes = []
  const sections = []
  const ctx = {
    routes,
    sections,
    connection: {
      fetch: {
        register: (route) => routes.push(route),
      },
    },
    inject(deps, fn) {
      const scope = {}
      if (deps.includes('connection')) scope.connection = ctx.connection
      if (deps.includes('systemPrompt')) scope.systemPrompt = { section: (section) => sections.push(section) }
      fn(scope)
    },
  }
  return ctx
}

/** 把 DSH_HOME 指到临时目录，避免读到真实的 config.json。 */
async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'relation-home-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  }
}

test('host 注册 status 路由并返回分层计数', async () => {
  await withHome(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relation-diary-'))
    try {
      writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')
      writeFileSync(join(dir, '2026-W44-周记.md'), 'b')
      writeFileSync(join(dir, '我是谁.md'), 'c')

      const ctx = fakeCtx()
      apply(ctx, { diaryDir: dir, cacheMs: 0 })

      const route = ctx.routes.find((item) => item.path.endsWith('/status'))
      assert.ok(route, 'status 路由没注册')

      const response = await route.fetch(new Request('http://localhost/api/dsh-diary-relation-check/status'))
      const body = await response.json()

      assert.equal(body.ok, true)
      assert.equal(body.scan.days, 1)
      assert.equal(body.scan.weeks, 1)
      assert.equal(body.scan.who, true)
      assert.equal(body.config.diaryDir, dir)
      assert.equal(typeof body.willRemind, 'boolean')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('POST config 写进插件自己的 config.json，不碰 profile', async () => {
  await withHome(async (home) => {
    const dir = mkdtempSync(join(tmpdir(), 'relation-diary-'))
    try {
      const ctx = fakeCtx()
      apply(ctx, { diaryDir: dir })

      const route = ctx.routes.find((item) => item.path.endsWith('/config') && item.methods.includes('POST'))
      assert.ok(route, 'config 路由没注册')

      const response = await route.fetch(
        new Request('http://localhost/api/dsh-diary-relation-check/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: '换个问题', person: '她' }),
        })
      )
      const body = await response.json()

      assert.equal(body.ok, true)
      assert.equal(body.needRestart, true)
      assert.ok(body.file.includes('dsh-diary-relation-check'))

      const saved = JSON.parse(readFileSync(join(home, 'dsh-diary-relation-check', 'config.json'), 'utf8'))
      assert.equal(saved.question, '换个问题')
      assert.equal(saved.person, '她')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('YAML 配置覆盖 config.json，sources 标 yaml', async () => {
  await withHome(async (home) => {
    const dir = mkdtempSync(join(tmpdir(), 'relation-diary-'))
    try {
      mkdirSync(join(home, 'dsh-diary-relation-check'), { recursive: true })
      writeFileSync(
        join(home, 'dsh-diary-relation-check', 'config.json'),
        JSON.stringify({ question: 'file-q', person: 'file-p' })
      )

      const ctx = fakeCtx()
      apply(ctx, { diaryDir: dir, question: 'yaml-q' })

      const route = ctx.routes.find((item) => item.path.endsWith('/status'))
      const response = await route.fetch(new Request('http://localhost/api/dsh-diary-relation-check/status'))
      const body = await response.json()

      assert.equal(body.config.question, 'yaml-q')
      assert.equal(body.sources.question, 'yaml')
      assert.equal(body.config.person, 'file-p')
      assert.equal(body.sources.person, 'file')
      assert.equal(body.sources.autoInit, 'default')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('POST config 拒绝外部 Origin，接受本机 Origin', async () => {
  await withHome(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relation-diary-'))
    try {
      const ctx = fakeCtx()
      apply(ctx, { diaryDir: dir })
      const route = ctx.routes.find((item) => item.path.endsWith('/config') && item.methods.includes('POST'))

      const evil = await route.fetch(
        new Request('http://localhost/api/dsh-diary-relation-check/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
          body: JSON.stringify({ question: '被改了吗' }),
        })
      )
      assert.equal(evil.status, 403)

      const local = await route.fetch(
        new Request('http://localhost/api/dsh-diary-relation-check/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:54321' },
          body: JSON.stringify({ question: '本机可以' }),
        })
      )
      assert.equal(local.status, 200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('提示文本重复调用稳定，不累积状态', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relation-diary-'))
  try {
    writeFileSync(join(dir, '2026-11-03-日记.md'), 'a')

    const ctx = fakeCtx()
    apply(ctx, { diaryDir: dir, cacheMs: 0 })

    const section = ctx.sections.find((item) => item.name === 'relation-check')
    assert.ok(section, 'relation-check section 没注册')

    const first = section.text({})
    for (let i = 0; i < 20; i++) {
      assert.equal(section.text({}), first, `第 ${i + 1} 次调用文本变了`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('模块导出 name 和 apply，没有静态 inject', async () => {
  const mod = await import('../lib/index.js')
  assert.equal(mod.name, 'dsh-diary-relation-check')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.inject, undefined, '不该静态声明 connection，用动态 inject 才不会拖住别的 profile')
})

test('200 篇日记的 status 在 2 秒内返回', async () => {
  await withHome(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relation-many-'))
    try {
      for (let i = 0; i < 200; i++) {
        const month = String(Math.floor(i / 28) + 1).padStart(2, '0')
        const day = String((i % 28) + 1).padStart(2, '0')
        writeFileSync(join(dir, `2026-${month}-${day}-日记.md`), 'x')
      }

      const ctx = fakeCtx()
      apply(ctx, { diaryDir: dir, cacheMs: 0 })
      const route = ctx.routes.find((item) => item.path.endsWith('/status'))

      const started = Date.now()
      const response = await route.fetch(new Request('http://localhost/api/dsh-diary-relation-check/status'))
      const body = await response.json()
      const cost = Date.now() - started

      assert.equal(body.ok, true)
      assert.equal(body.scan.days, 200)
      assert.ok(cost < 2000, `status 用了 ${cost}ms`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('重复 apply 不崩', async () => {
  await withHome(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relation-twice-'))
    try {
      const ctx = fakeCtx()
      assert.doesNotThrow(() => {
        apply(ctx, { diaryDir: dir })
        apply(ctx, { diaryDir: dir })
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
