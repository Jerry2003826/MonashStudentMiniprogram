import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { installFakeWx } from './helpers/wx'

const root = path.resolve(import.meta.dirname, '../..')
const directory = mkdtempSync(path.join(tmpdir(), 'monash-synthetic-trial-test-'))
const configPath = path.join(directory, 'synthetic-public.json')
const output = path.join(directory, 'synthetic-output')
const config = {
  // Deliberately synthetic and never contacted, uploaded, or kept as a deployable artifact.
  apiBaseUrl: 'https://api.synthetic-fixture.edu/api/v1',
  version: '0.0.0-synthetic-test',
  disclosure: {
    operatorName: '合成测试组织',
    supportContact: '合成测试支持渠道',
    dataRegion: '合成测试地区',
    retentionNotice: '合成测试保存安排，禁止作为真实披露',
  },
}

function run(value: unknown, extra: string[] = ['--check']) {
  writeFileSync(configPath, JSON.stringify(value))
  return spawnSync(
    process.execPath,
    ['scripts/prepare-trial.mjs', '--config', configPath, ...extra],
    { cwd: root, encoding: 'utf8' },
  )
}

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('体验版隔离构建', () => {
  it.each([
    '',
    'http://api.fixture.edu/api/v1',
    'https://127.0.0.1/api/v1',
    'https://localhost/api/v1',
    'https://example.com/api/v1',
    'https://api.fixture.edu/api/v1?token=secret',
    'https://name:secret@api.fixture.edu/api/v1',
  ])('拒绝未配置、不安全或占位地址 %s', (apiBaseUrl) => {
    const result = run({ ...config, apiBaseUrl })
    expect(result.status).toBe(1)
    expect(result.stderr).not.toContain('name:secret')
    expect(existsSync(output)).toBe(false)
  })

  it('拒绝密钥字段与缺少披露的配置', () => {
    expect(run({ ...config, appSecret: 'must-never-ship' }).status).toBe(1)
    expect(run({ ...config, disclosure: { ...config.disclosure, dataRegion: '' } }).status).toBe(1)
    expect(run({ ...config, disclosure: undefined }).status).toBe(1)
  })

  it('只在独立目录生成产物，各微信环境都走真API且保留源码mock默认', () => {
    const before = readFileSync(path.join(root, 'miniprogram/deployment.generated.ts'))
    const result = run(config, ['--output', output])
    expect(result.status, result.stderr + result.stdout).toBe(0)
    const summary = JSON.parse(result.stdout)
    expect(summary).toMatchObject({ uploaded: false, networkVerified: false, synthetic: true })
    expect(summary.packageBytes).toBeLessThan(1.9 * 1024 * 1024)
    expect(readFileSync(path.join(root, 'miniprogram/deployment.generated.ts'))).toEqual(before)
    const project = JSON.parse(readFileSync(path.join(output, 'project.config.json'), 'utf8'))
    expect(project.setting).toMatchObject({
      urlCheck: true,
      uploadWithSourceMap: false,
      useCompilerPlugins: [],
    })
    expect(existsSync(path.join(output, 'project.private.config.json'))).toBe(false)
    expect(readdirSync(output).sort()).toEqual([
      'miniprogram',
      'project.config.json',
      'trial-manifest.json',
    ])
    const manifest = JSON.parse(readFileSync(path.join(output, 'trial-manifest.json'), 'utf8'))
    expect(Object.keys(manifest.files).some((name) => name.endsWith('.ts'))).toBe(false)
    expect(
      Object.keys(manifest.files).some((name) =>
        name.includes('miniprogram_npm/tdesign-miniprogram/button'),
      ),
    ).toBe(true)
    const require = createRequire(path.join(output, 'artifact-check.cjs'))
    const built = require('./miniprogram/config.js') as {
      isMockEnabled(): boolean
      getApiBaseUrl(): string
      getDevelopmentLoginUsername(): null
    }
    for (const env of ['develop', 'trial', 'release'] as const) {
      installFakeWx(env)
      expect(built.isMockEnabled()).toBe(false)
      expect(built.getDevelopmentLoginUsername()).toBeNull()
      // Synthetic fixtures are only for offline compiler inspection, never for
      // sending a real WeChat login code to an invented hostname.
      expect(() => built.getApiBaseUrl()).toThrow('离线构建检查包')
    }
    const second = run(config, ['--output', output])
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('never overwrite')
  }, 30000)
})
/// <reference types="node" />
