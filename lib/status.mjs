#!/usr/bin/env node
/**
 * 状态自检。一条命令看清插件装没装、记忆目录通不通、会不会提醒。
 *
 *   node lib/status.mjs --dir "D:\我的记忆"
 *   node lib/status.mjs --dir "D:\我的记忆" --json
 *
 * 也可以直接把 profile 的 cordis.patch.yml 里那段配置抄进来：
 *   node lib/status.mjs --config "C:\Users\你\.dsh\profiles\desktop\cordis.patch.yml"
 *
 * 0.9.x 起按日/周/月/年四层扫，不再探测命名格式。
 * 这个脚本只读，不写任何文件。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  hasAnyMemory,
  mergeConfigSources,
  normalizeConfig,
  pluginConfigFile,
  readPluginConfig,
  scanMemory,
  selectLayers,
  volumeAvailable,
  volumeRootOf,
} from './index.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))

function parseArgs(argv) {
  const out = { dir: '', config: '', json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir' || a === '-d') out.dir = argv[++i] || ''
    else if (a === '--config' || a === '-c') out.config = argv[++i] || ''
    else if (a === '--json') out.json = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

/** 从 cordis.patch.yml 里抠出 relation-check 那段的 config 缩进块。 */
function configFromYaml(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*id:\s*relation-check\s*$/.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null

  const out = {}
  let inConfig = false
  let configIndent = -1

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const indent = line.match(/^\s*/)[0].length
    if (/^\s*-\s*id:/.test(line) && indent <= (lines[start].match(/^\s*/)[0].length)) break

    if (/^\s*config:\s*$/.test(line)) {
      inConfig = true
      configIndent = indent
      continue
    }

    if (inConfig) {
      if (indent <= configIndent) {
        inConfig = false
        continue
      }
      const m = line.match(/^\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/)
      if (!m) continue
      let value = m[2].trim()
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1)
      }
      if (value === 'true') value = true
      else if (value === 'false') value = false
      else if (value !== '' && /^-?\d+(\.\d+)?$/.test(value)) value = Number(value)
      out[m[1]] = value
    }
  }

  return Object.keys(out).length > 0 ? out : null
}

function readState(file) {
  try {
    let raw = readFileSync(file, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function fmtTime(ms) {
  if (!ms) return '（没有）'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
    return pkg.version || '?'
  } catch {
    return '?'
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(`用法：
  node lib/status.mjs --dir <记忆目录>
  node lib/status.mjs --config <cordis.patch.yml 路径>
  node lib/status.mjs --dir <记忆目录> --json`)
    return
  }

  let rawConfig = {}
  if (args.config) {
    if (!existsSync(args.config)) fail(`找不到配置文件：${args.config}`)
    rawConfig = configFromYaml(args.config)
    if (!rawConfig) fail(`在 ${args.config} 里没找到 id: relation-check 那一段`)
  } else if (args.dir) {
    rawConfig = { diaryDir: args.dir }
  } else {
    fail('缺参数。用 --dir <记忆目录> 或 --config <cordis.patch.yml>。加 --help 看用法。')
  }

  let cfg
  try {
    // 和运行时一样：profile 的 YAML 优先，插件 config.json 次之。
    cfg = normalizeConfig(mergeConfigSources(rawConfig, readPluginConfig()))
  } catch (err) {
    fail(String(err?.message || err))
  }

  const root = volumeRootOf(cfg.diaryDir)
  const diskOk = volumeAvailable(cfg)
  const dirExists = existsSync(cfg.diaryDir)

  const emptyScan = { days: [], weeks: [], months: [], years: [], who: null, foreign: [] }
  const scan = diskOk ? scanMemory(cfg) : emptyScan
  const layers = selectLayers(scan, new Date())
  const state = readState(cfg.stateFile)
  const lastCheckMs = typeof state.lastCheckMs === 'number' ? state.lastCheckMs : 0

  const all = [...scan.days, ...scan.weeks, ...scan.months, ...scan.years]
  const fresh = all.filter((item) => item.mtime > lastCheckMs)
  const hasAny = hasAnyMemory(scan)
  const whoMissing = hasAny && !scan.who

  const willRemind = !diskOk
    ? '会（提醒你盘不可用）'
    : !hasAny && scan.foreign.length > 0
      ? '会（先确认哪些是日记）'
      : !hasAny
        ? '会（提示先建记忆）'
        : fresh.length > 0
          ? `会（${fresh.length} 篇比上次判断新）`
          : '不会（没有新内容）'

  const report = {
    version: readVersion(),
    pluginDir: resolve(HERE, '..'),
    diaryDir: cfg.diaryDir,
    configFile: pluginConfigFile(),
    volumeRoot: root,
    volumeAvailable: diskOk,
    dirExists,
    days: scan.days.length,
    weeks: scan.weeks.length,
    months: scan.months.length,
    years: scan.years.length,
    who: Boolean(scan.who),
    whoMissing,
    foreign: scan.foreign,
    layers: {
      years: layers.years.length,
      months: layers.months.length,
      weeks: layers.weeks.length,
      days: layers.days.length,
    },
    stateFile: cfg.stateFile,
    stateExists: existsSync(cfg.stateFile),
    lastCheckMs,
    lastCheckAt: fmtTime(lastCheckMs),
    verdict: state.verdict || null,
    reason: state.reason || null,
    willRemind,
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const lines = [
    '插件状态',
    `  版本        ${report.version}`,
    `  插件目录    ${report.pluginDir}`,
    `  记忆目录    ${report.diaryDir}`,
    `  盘符        ${report.volumeRoot || '(无)'}  ${report.volumeAvailable ? '可用' : '不可用 —— 检查磁盘是否插好'}`,
    `  目录        ${report.dirExists ? '存在' : '不存在'}`,
    `  识别到      日 ${report.days} / 周 ${report.weeks} / 月 ${report.months} / 年 ${report.years} / 我是谁 ${report.who ? '✓' : '—'}`,
    `  按层抽      年 ${report.layers.years} / 月 ${report.layers.months} / 周 ${report.layers.weeks} / 日 ${report.layers.days}`,
    `  认不出      ${report.foreign.length > 0 ? report.foreign.join('、') : '无'}`,
    `  状态文件    ${report.stateFile}${report.stateExists ? '' : '（不存在）'}`,
    `  上次判断    ${report.lastCheckAt}${report.verdict ? `（${report.verdict}）` : ''}`,
  ]
  if (report.reason) lines.push(`  判断理由    ${report.reason}`)
  if (report.whoMissing) lines.push(`  缺「我是谁」 是 —— 下次判断会带着补写任务`)
  lines.push('', `  现在会提醒  ${report.willRemind}`)

  if (!report.volumeAvailable) {
    lines.push('', `盘 ${report.volumeRoot} 现在不可用。检查移动硬盘/网络盘，插好后重跑这条命令。`)
  } else if (!report.dirExists) {
    lines.push('', `目录还不存在。想做记忆方案就打开 autoInit / memorySetup；不想就让插件只读。`)
  }

  console.log(lines.join('\n'))
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

main()
