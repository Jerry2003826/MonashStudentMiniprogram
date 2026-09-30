import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestOptions } from '../../../miniprogram/services/request'
import { makeMe } from '../helpers/membership'

const mocks = vi.hoisted(() => ({ me: vi.fn(), request: vi.fn() }))
vi.mock('../../../miniprogram/services/auth', () => ({
  fetchMe: mocks.me,
  setCachedMe: vi.fn(),
}))
vi.mock('../../../miniprogram/services/request', () => ({ request: mocks.request }))

interface State {
  email: string
  code: string
  allowedEmailDomains: string[]
  emailPlaceholder: string
  emailDomainHint: string
  loading: boolean
  loadError: boolean
  canApply: boolean
  canSubmit: boolean
}
interface VerifyPage {
  data: State
  setData(patch: Partial<State>): void
  load(): Promise<void>
  updateCanSubmit(): void
  onSubmit(): Promise<void>
  onSendCode(): Promise<void>
  stopCountdown(): void
  onUnload(): void
}

let page: VerifyPage

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('wx', { setNavigationBarTitle: vi.fn(), showToast: vi.fn() })
  vi.stubGlobal('Page', vi.fn())
  mocks.me.mockResolvedValue(makeMe())
  mocks.request.mockResolvedValue({ allowed_email_domains: ['students.example.edu'] })
  await import('../../../miniprogram/pages/verify/index')
  const definition = vi.mocked(Page).mock.calls[0][0] as unknown as VerifyPage
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
})

afterEach(() => {
  page.onUnload()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fill(email: string) {
  page.data.email = email
  page.data.code = '123456'
  page.updateCanSubmit()
}

function writes() {
  return mocks.request.mock.calls.filter(
    ([options]) => (options as RequestOptions).method === 'POST',
  )
}

describe('membership form uses server email configuration', () => {
  it('loads public config and replaces the old production domain in UI and submission', async () => {
    await page.load()
    expect(mocks.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/membership/config',
      auth: false,
    })
    expect(page.data.emailPlaceholder).toBe('name@students.example.edu')
    expect(page.data.emailDomainHint).toBe('支持的邮箱域名：@students.example.edu')
    fill('a@student.monash.edu')
    await page.onSendCode()
    await page.onSubmit()
    expect(page.data.canSubmit).toBe(false)
    expect(writes()).toHaveLength(0)

    fill(' A@Students.Example.edu ')
    expect(page.data.canSubmit).toBe(true)
    mocks.request.mockResolvedValueOnce(null)
    await page.onSendCode()
    expect(mocks.request).toHaveBeenLastCalledWith({
      method: 'POST',
      path: '/membership/email-code',
      body: { email: 'a@students.example.edu' },
    })
    mocks.request.mockResolvedValueOnce(
      makeMe({
        application: {
          id: 1,
          email: 'a@students.example.edu',
          status: 'pending',
          submitted_at: '2026-09-30T00:00:00Z',
          reviewed_at: null,
          review_note: '',
        },
      }),
    )
    await page.onSubmit()
    expect(mocks.request).toHaveBeenLastCalledWith({
      method: 'POST',
      path: '/membership/applications',
      body: { email: 'a@students.example.edu', code: '123456' },
    })
    expect(page.data.canApply).toBe(false)
  })

  it('displays all configured domains and accepts each one', async () => {
    mocks.request.mockResolvedValueOnce({
      allowed_email_domains: [' Students.Example.edu ', 'alumni.example.org'],
    })
    await page.load()
    expect(page.data.allowedEmailDomains).toEqual(['students.example.edu', 'alumni.example.org'])
    expect(page.data.emailDomainHint).toContain('@alumni.example.org')
    for (const domain of page.data.allowedEmailDomains) {
      fill(`a@${domain}`)
      expect(page.data.canSubmit).toBe(true)
    }
  })

  it.each([null, {}, { allowed_email_domains: [] }, { allowed_email_domains: ['*'] }])(
    'fails closed for malformed public config %#',
    async (config) => {
      mocks.request.mockResolvedValueOnce(config)
      await page.load()
      fill('a@student.monash.edu')
      await page.onSendCode()
      await page.onSubmit()
      expect(page.data.loadError).toBe(true)
      expect(page.data.canSubmit).toBe(false)
      expect(page.data.allowedEmailDomains).toEqual([])
      expect(writes()).toHaveLength(0)
    },
  )

  it('clears a previous allowlist on refresh, stays blocked after failure, and recovers on retry', async () => {
    await page.load()
    fill('a@students.example.edu')
    expect(page.data.canSubmit).toBe(true)
    let failConfig!: (error: Error) => void
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failConfig = reject
        }),
    )
    const refresh = page.load()
    expect(page.data.loading).toBe(true)
    expect(page.data.canSubmit).toBe(false)
    expect(page.data.allowedEmailDomains).toEqual([])
    await page.onSendCode()
    await page.onSubmit()
    expect(writes()).toHaveLength(0)
    failConfig(new Error('offline'))
    await refresh
    expect(page.data.loadError).toBe(true)
    expect(page.data.canSubmit).toBe(false)
    await page.load()
    expect(page.data.loadError).toBe(false)
    expect(page.data.canSubmit).toBe(true)
  })

  it('ignores an older config response after a newer load or unload', async () => {
    let finishConfig!: (config: unknown) => void
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishConfig = resolve
        }),
    )
    const oldLoad = page.load()
    mocks.request.mockResolvedValueOnce({ allowed_email_domains: ['new.example.edu'] })
    await page.load()
    finishConfig({ allowed_email_domains: ['old.example.edu'] })
    await oldLoad
    expect(page.data.allowedEmailDomains).toEqual(['new.example.edu'])

    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishConfig = resolve
        }),
    )
    const unloaded = page.load()
    page.onUnload()
    finishConfig({ allowed_email_domains: ['old.example.edu'] })
    await unloaded
    expect(page.data.allowedEmailDomains).toEqual([])
  })
})
