import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** 假 React：只够让函数组件和错误边界跑一遍，不执行 useEffect。 */
function fakeReact() {
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(update) {
      this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) }
    }
  }

  return {
    Component,
    createElement(type, props, ...children) {
      return { type, props, children }
    },
    useState(initial) {
      return [initial, () => {}]
    },
    useEffect() {},
    useCallback(fn) {
      return fn
    },
  }
}

/** 在沙箱里执行浏览器 bundle，返回 factory 和注册记录。 */
function loadBundle() {
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  const loaded = []
  const window = {
    __ModuleLoader__: {
      load(spec) {
        loaded.push(spec)
      },
    },
  }
  const React = fakeReact()
  const require = (name) => (name === 'react' ? React : {})

  vm.runInNewContext(code, { window, console })

  assert.equal(loaded.length, 1, 'bundle 应该只调用一次 __ModuleLoader__.load')
  return { spec: loaded[0], require }
}

test('client bundle 注册 factory，apply 注册设置页', () => {
  const { spec, require } = loadBundle()
  assert.equal(spec.id, 'dsh-diary-relation-check')

  const api = spec.factory(require)
  assert.equal(api.inject.length, 1)
  assert.equal(api.inject[0], 'slots')
  assert.equal(typeof api.apply, 'function')

  const sections = []
  const ctx = {
    slots: {
      inject(_name, fn) {
        fn()
      },
      register(meta, component) {
        sections.push({ meta, component })
        return {}
      },
    },
  }

  api.apply(ctx)

  assert.equal(sections.length, 1)
  assert.equal(sections[0].meta.name, 'settings.section')
  assert.equal(sections[0].meta.id, 'diary-relation-check')
  assert.equal(sections[0].meta.label, '记忆检查')
  assert.equal(typeof sections[0].component, 'function')
})

test('设置页组件假渲染不抛错，返回一棵树', () => {
  const { spec, require } = loadBundle()
  const api = spec.factory(require)
  const sections = []

  api.apply({
    slots: {
      inject(_name, fn) {
        fn()
      },
      register(meta, component) {
        sections.push({ meta, component })
        return {}
      },
    },
  })

  const tree = sections[0].component()
  assert.ok(tree, '组件应该返回一棵树')
  assert.equal(tree.type, 'div')
  assert.ok(Array.isArray(tree.children))
})

test('宿主没有 settings.section 时 apply 不抛错', () => {
  const { spec, require } = loadBundle()
  const api = spec.factory(require)
  const ctx = {
    slots: {
      inject() {
        throw new Error('no such slot')
      },
      register() {
        return {}
      },
    },
  }

  assert.doesNotThrow(() => api.apply(ctx))
})

test('factory 可以多次调用，每次返回独立的 apply', () => {
  const { spec, require } = loadBundle()
  const first = spec.factory(require)
  const second = spec.factory(require)
  assert.notEqual(first, second)
  assert.equal(typeof first.apply, 'function')
  assert.equal(typeof second.apply, 'function')
})
