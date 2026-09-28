import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, expect, it } from 'vitest'

const sourceScript = path.resolve(import.meta.dirname, '../../scripts/prepare-components.mjs')
let root: string
const distribution = 'node_modules/tdesign-miniprogram/miniprogram_dist'
const output = 'miniprogram/miniprogram_npm/tdesign-miniprogram'

function write(relative: string, content: string) {
  const destination = path.join(root, relative)
  mkdirSync(path.dirname(destination), { recursive: true })
  writeFileSync(destination, content)
}

function packageMetadata(miniprogram = 'miniprogram_dist', version = '1.17.0') {
  write(
    'node_modules/tdesign-miniprogram/package.json',
    JSON.stringify({ name: 'tdesign-miniprogram', version, miniprogram }),
  )
}

function run() {
  return spawnSync(process.execPath, [path.join(root, 'scripts/prepare-components.mjs')], {
    cwd: root,
    encoding: 'utf8',
  })
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'monash-components-test-'))
  mkdirSync(path.join(root, 'scripts'))
  copyFileSync(sourceScript, path.join(root, 'scripts/prepare-components.mjs'))
  packageMetadata()
  write(
    'package-lock.json',
    JSON.stringify({ packages: { 'node_modules/tdesign-miniprogram': { version: '1.17.0' } } }),
  )
  write(`${distribution}/button/button.wxml`, '<button>发布组件</button>')
  write(`${distribution}/miniprogram_npm/tslib/index.js`, 'exports.__fixture = true')
  write('miniprogram/styles/icons.wxss', 'embedded-font-must-stay-unchanged')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

it('全新目录包含发布包自带依赖，重复准备删除旧产物但保留字体和其他组件', () => {
  expect(existsSync(path.join(root, output))).toBe(false)
  const first = run()
  expect(first.status, first.stderr).toBe(0)
  expect(JSON.parse(first.stdout)).toMatchObject({ version: '1.17.0', files: 2 })
  expect(readFileSync(path.join(root, `${output}/miniprogram_npm/tslib/index.js`), 'utf8')).toBe(
    'exports.__fixture = true',
  )
  write(`${output}/obsolete.js`, 'old')
  write('miniprogram/miniprogram_npm/another-package/index.js', 'keep')
  expect(run().status).toBe(0)
  expect(existsSync(path.join(root, `${output}/obsolete.js`))).toBe(false)
  expect(readFileSync(path.join(root, 'miniprogram/styles/icons.wxss'), 'utf8')).toBe(
    'embedded-font-must-stay-unchanged',
  )
  expect(
    readFileSync(path.join(root, 'miniprogram/miniprogram_npm/another-package/index.js'), 'utf8'),
  ).toBe('keep')
})

it('发布路径逃逸被拒绝，不创建输出', () => {
  packageMetadata('../outside')
  const result = run()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('inside its declared directory')
  expect(existsSync(path.join(root, output))).toBe(false)
})

it('与锁文件版本不一致时拒绝，不替换现有产物', () => {
  write(`${output}/existing.js`, 'keep')
  packageMetadata('miniprogram_dist', '99.0.0')
  expect(run().stderr).toContain('does not match package-lock.json')
  expect(readFileSync(path.join(root, `${output}/existing.js`), 'utf8')).toBe('keep')
})

it('源树中的符号链接被拒绝，复制失败前保留现有产物', () => {
  write(`${output}/existing.js`, 'keep')
  symlinkSync(path.join(root, 'package-lock.json'), path.join(root, distribution, 'linked.json'))
  const result = run()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Symlinks')
  expect(readFileSync(path.join(root, `${output}/existing.js`), 'utf8')).toBe('keep')
})

it('目标祖先为符号链接时拒绝，不写入链接目标', () => {
  const outside = path.join(root, 'outside-output')
  mkdirSync(outside)
  symlinkSync(outside, path.join(root, 'miniprogram/miniprogram_npm'), 'dir')
  const result = run()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Symlinks')
  expect(existsSync(path.join(outside, 'tdesign-miniprogram'))).toBe(false)
})
