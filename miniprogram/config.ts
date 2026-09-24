export type EnvVersion = 'develop' | 'trial' | 'release'

const MOCK_IN_DEVELOP = true

const API_BASE_URLS: Record<EnvVersion, string> = {
  develop: 'http://127.0.0.1:8000/api/v1',
  trial: '',
  release: '',
}

export const MOCK_DELAY_MS = 300

export function getEnvVersion(): EnvVersion {
  return wx.getAccountInfoSync().miniProgram.envVersion
}

export function isMockEnabled(): boolean {
  return MOCK_IN_DEVELOP && getEnvVersion() === 'develop'
}

export function getApiBaseUrl(): string {
  const env = getEnvVersion()
  const url = API_BASE_URLS[env]
  if (!url) {
    throw new Error(`还没有配置 ${env} 环境的接口地址，请修改 miniprogram/config.ts`)
  }
  return url
}
