/**
 * 把 lib/client/index.js 包成浏览器模块，写到 lib/client.js。
 *
 * 为什么需要这一步：DSH 客户端一个包只加载一个 JS 文件，模块身份 = 包名，
 * factory 里不能有 import。所以源码写成 factory 函数体，由这个脚本套上
 * window.__ModuleLoader__.load 的壳。
 *
 * 生成物不要手改；改 lib/client/index.js 再跑 npm run build:client。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'lib', 'client', 'index.js')
const target = join(root, 'lib', 'client.js')

const body = readFileSync(source, 'utf8')
const out = `/** 生成物：由 tools/build-client.mjs 从 lib/client/index.js 拼出，别手改。 */
window.__ModuleLoader__.load({
  id: 'dsh-diary-relation-check',
  factory(require) {
${body}
  },
});
`

writeFileSync(target, out, 'utf8')
console.log(`[build-client] ${target} (${out.length} bytes)`)
