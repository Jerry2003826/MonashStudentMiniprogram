import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicDeployment } from '../../miniprogram/deployment'
import { getApiBaseUrl, getDevelopmentLoginUsername, isMockEnabled } from '../../miniprogram/config'
import { getTestingLabel } from '../../miniprogram/deployment'
import { getAgreement } from '../../miniprogram/pages/agreement/content'
import { installFakeWx } from './helpers/wx'

const configured = vi.hoisted(() => ({ value: null as PublicDeployment | null }))
vi.mock('../../miniprogram/deployment.generated', () => ({
  get PUBLIC_DEPLOYMENT() {
    return configured.value
  },
}))
beforeEach(() => {
  configured.value = null
})

afterEach(() => vi.unstubAllGlobals())

describe('未生成部署配置的源码', () => {
  it('保留日常开发mock，不启用开发身份', () => {
    installFakeWx('develop')
    expect(isMockEnabled()).toBe(true)
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:8000/api/v1')
    expect(getDevelopmentLoginUsername()).toBeNull()
    expect(getTestingLabel()).toBe('')
  })

  it.each(['trial', 'release'] as const)(
    '%s 严禁mock和开发身份，缺配置不会降级到本地地址',
    (env) => {
      installFakeWx(env)
      expect(isMockEnabled()).toBe(false)
      expect(getDevelopmentLoginUsername()).toBeNull()
      expect(getApiBaseUrl).toThrow('服务暂未开通')
    },
  )
})

describe('已生成公开部署配置的运行模式', () => {
  it.each(['develop', 'trial', 'release'] as const)(
    '%s 使用配置中的HTTPS地址并禁止所有开发身份和mock',
    (env) => {
      configured.value = {
        apiBaseUrl: 'https://api.unit-fixture.edu/api/v1',
        version: '0.0.0-unit-test',
        disclosure: {
          operatorName: '单元测试',
          supportContact: '单元测试',
          dataRegion: '单元测试',
          retentionNotice: '单元测试',
        },
      }
      const wx = installFakeWx(env)
      expect(isMockEnabled()).toBe(false)
      expect(getDevelopmentLoginUsername()).toBeNull()
      expect(getApiBaseUrl()).toBe(configured.value.apiBaseUrl)
      expect(wx.request).not.toHaveBeenCalled()
      expect(wx.login).not.toHaveBeenCalled()
    },
  )
})

describe('隐私说明与真实业务一致', () => {
  const disclosure = {
    operatorName: '合成测试组织',
    supportContact: '合成测试支持渠道',
    dataRegion: '合成测试地区',
    retentionNotice: '合成测试保存安排，不用于实际部署',
  }

  it('真API内测明确持久保存与未开放功能，并展示实际配置的运营信息', () => {
    const privacy = getAgreement('privacy', { demo: false, testing: true, disclosure })
    const text = privacy.sections.map((section) => section.body).join('\n')
    expect(privacy.title).toBe('内测隐私说明')
    expect(text).toContain('持久保存')
    expect(text).toContain('自助注销暂未开放')
    expect(text).toContain(disclosure.operatorName)
    expect(text).toContain(disclosure.dataRegion)
    expect(text).toContain(disclosure.retentionNotice)
    expect(text).not.toContain('只保存在本次运行的内存')
    expect(text).not.toContain('文字和图片')
  })

  it('开发演示准确说明内存数据，不承诺真实反馈已发送', () => {
    const text = getAgreement('privacy', { demo: true, testing: false, disclosure: null })
      .sections.map((section) => section.body)
      .join('\n')
    expect(text).toContain('只保存在本次运行的内存')
    expect(text).toContain('不会发送给运营方')
    expect(text).not.toContain('真实服务会持久保存')
  })
})
