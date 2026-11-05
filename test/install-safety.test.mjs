import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, parse } from 'node:path'

import { apply, defaultStateFile } from '../lib/index.js'

/** DSH_HOME 指到临时目录，避免读到真实的 config.json。 */
async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'relation-safe-home-'))
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

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'relation-safe-diary-'))
}

test('没有 connection 服务时 apply 不抛', () => {
  const dir = makeDir()
  try {
    const ctx = {
      inject(_deps, fn) {
        fn({ systemPrompt: { section() {} } })
      },
    }
    assert.doesNotThrow(() => apply(ctx, { diaryDir: dir }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('systemPrompt 服务一直不来时 apply 不抛', () => {
  const dir = makeDir()
  try {
    const ctx = {
      connection: { fetch: { register() {} } },
      inject() {
        /* 服务没就绪，回调不执行 */
      },
    }
    assert.doesNotThrow(() => apply(ctx, { diaryDir: dir }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('缺 diaryDir 时 apply 只打一行错误，不抛', async () => {
  await withHome(async () => {
    assert.doesNotThrow(() => apply({}, {}))
  })
})

test('config.json 损坏时 apply 不崩，status 仍可用', async () => {
  await withHome(async (home) => {
    const dir = makeDir()
    try {
      mkdirSync(join(home, 'dsh-diary-relation-check'), { recursive: true })
      writeFileSync(join(home, 'dsh-diary-relation-check', 'config.json'), '{ 坏掉的 json')

      const routes = []
      const ctx = {
        connection: { fetch: { register: (route) => routes.push(route) } },
        inject(deps, fn) {
          const scope = {}
          if (deps.includes('connection')) scope.connection = ctx.connection
          if (deps.includes('systemPrompt')) scope.systemPrompt = { section() {} }
          fn(scope)
        },
      }

      assert.doesNotThrow(() => apply(ctx, { diaryDir: dir }))

      const status = routes.find((route) => route.path.endsWith('/status'))
      const response = await status.fetch(new Request('http://localhost/api/dsh-diary-relation-check/status'))
      const body = await response.json()
      assert.equal(body.ok, true)
      assert.equal(body.config.diaryDir, dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('日记目录是盘根时，状态文件不落在盘根', () => {
  const root = parse(process.cwd()).root
  const file = defaultStateFile(root)
  const bad = join(root, '.dsh-diary-relation-check')
  assert.ok(!file.startsWith(bad), `不该在盘根建目录：${file}`)
  assert.ok(file.startsWith(join(homedir(), '.dsh')), `应该退回用户目录：${file}`)
  assert.equal(existsSync(bad), false, '测试期间不该真的建出盘根目录')
})

test('状态文件目录建失败时 apply 不崩', () => {
  const dir = makeDir()
  try {
    // 用只读的盘符路径模拟不可写；Windows 上不存在就跳过。
    const ctx = {
      connection: { fetch: { register() {} } },
      inject(_deps, fn) {
        fn({ systemPrompt: { section() {} } })
      },
    }
    assert.doesNotThrow(() => apply(ctx, { diaryDir: dir, stateFile: join(dir, 'x', 'y', 'state.json') }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
