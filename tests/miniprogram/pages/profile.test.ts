import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../../miniprogram/types/api'
import { makeMe } from '../helpers/membership'

const mocks = vi.hoisted(() => ({
  avatar: vi.fn(),
  nickname: vi.fn(),
  delete: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
}))
vi.mock('../../../miniprogram/services/api/me', () => ({
  uploadAvatar: mocks.avatar,
  updateNickname: mocks.nickname,
  deleteAccount: mocks.delete,
}))
vi.mock('../../../miniprogram/services/auth', () => ({ fetchMe: mocks.me, logout: mocks.logout }))

interface ProfilePage {
  data: { me: Me | null; nickname: string; mockFeatures: boolean; testingLabel: string }
  setData(patch: Partial<ProfilePage['data']>): void
  onShow(): void
  applyMe(me: Me): void
  onChooseAvatar(event: { detail: { avatarUrl: string } }): Promise<void>
  onNicknameBlur(event: { detail: { value: string } }): Promise<void>
  onDeleteAccount(): void
}

let page: ProfilePage
const showToast = vi.fn()
const showModal = vi.fn()
const navigateTo = vi.fn()

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.me.mockResolvedValue(makeMe({ state: 'none' }))
  vi.stubGlobal('wx', {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
    showToast,
    showModal,
    navigateTo,
  })
  vi.stubGlobal('Page', (definition: ProfilePage) => {
    page = {
      ...definition,
      data: { ...definition.data },
      setData(patch) {
        Object.assign(this.data, patch)
      },
    }
  })
  await import('../../../miniprogram/pages/profile/index')
  page.applyMe(makeMe({ state: 'none' }))
})
afterEach(() => vi.unstubAllGlobals())

describe('体验版个人资料', () => {
  it('隐藏头像修改，直接触发事件也不能调用未接通接口', async () => {
    page.onShow()
    expect(page.data.mockFeatures).toBe(false)
    expect(page.data.testingLabel).toBe('内测版')
    await page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://test.png' } })
    expect(mocks.avatar).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({ title: '头像修改暂未开放', icon: 'none' })
  })

  it('注销入口仅引导真实反馈，不伪造删除或登出', () => {
    page.onDeleteAccount()
    const options = showModal.mock.calls[0][0]
    expect(options.content).toContain('自助注销暂未开放')
    options.success({ confirm: true })
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/feedback/index' })
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it('昵称失败保留原值且不显示成功，成功后才更新', async () => {
    const original = page.data.nickname
    mocks.nickname.mockRejectedValueOnce(new Error('服务失败'))
    await page.onNicknameBlur({ detail: { value: '新的昵称' } })
    expect(page.data.nickname).toBe(original)
    expect(showToast).not.toHaveBeenCalledWith(expect.objectContaining({ icon: 'success' }))
    mocks.nickname.mockResolvedValueOnce({ ...makeMe({ state: 'none' }), nickname: '新的昵称' })
    await page.onNicknameBlur({ detail: { value: '新的昵称' } })
    expect(page.data.nickname).toBe('新的昵称')
    expect(showToast).toHaveBeenCalledWith({ title: '昵称已更新', icon: 'success' })
  })
})
