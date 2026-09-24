import { vi } from 'vitest'

export interface FakeResponse {
  statusCode: number
  data: unknown
}

export interface FakeRequestOptions {
  url: string
  method?: string
  data?: unknown
  header?: Record<string, string>
  success?: (res: FakeResponse) => void
  fail?: (err: { errMsg: string }) => void
}

export interface FakeUploadOptions {
  url: string
  filePath: string
  name: string
  header?: Record<string, string>
  success?: (res: { statusCode: number; data: string }) => void
  fail?: (err: { errMsg: string }) => void
}

type Responder = (options: FakeRequestOptions) => FakeResponse | 'fail'

export function installFakeWx(envVersion: 'develop' | 'trial' | 'release' = 'develop') {
  const storage = new Map<string, unknown>()
  let responder: Responder = () => ({ statusCode: 200, data: null })
  let loginCount = 0

  const request = vi.fn((options: FakeRequestOptions) => {
    const result = responder(options)
    if (result === 'fail') {
      options.fail?.({ errMsg: 'request:fail' })
    } else {
      options.success?.(result)
    }
  })

  const uploadFile = vi.fn((options: FakeUploadOptions) => {
    const result = responder({ url: options.url, method: 'POST', header: options.header })
    if (result === 'fail') {
      options.fail?.({ errMsg: 'uploadFile:fail' })
    } else {
      options.success?.({ statusCode: result.statusCode, data: JSON.stringify(result.data) })
    }
  })

  const login = vi.fn((options: { success?: (res: { code: string }) => void }) => {
    loginCount += 1
    options.success?.({ code: `fake-code-${loginCount}` })
  })

  const showToast = vi.fn()

  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => {
      storage.set(key, value)
    },
    removeStorageSync: (key: string) => {
      storage.delete(key)
    },
    getAccountInfoSync: () => ({ miniProgram: { appId: 'wx-test', envVersion, version: '' } }),
    request,
    uploadFile,
    login,
    showToast,
  })

  return {
    storage,
    request,
    uploadFile,
    login,
    showToast,
    respondWith(next: Responder) {
      responder = next
    },
  }
}
