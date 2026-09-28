export type EnvVersion = 'develop' | 'trial' | 'release'

const MOCK_IN_DEVELOP = true

export type DevelopmentLoginUsername =
  'demo-student' | 'demo-owner' | 'demo-reviewer' | 'demo-editor'

// 本地后端联调时同时关闭 MOCK_IN_DEVELOP，并选择 seed_demo 创建的账号。
// 默认走微信登录；体验版/正式版及远程接口永远不会使用开发登录。
const DEVELOPMENT_LOGIN_USERNAME: DevelopmentLoginUsername | null = null

const API_BASE_URLS: Record<EnvVersion, string> = {
  develop: 'http://127.0.0.1:8000/api/v1',
  trial: '',
  release: '',
}

export const MOCK_DELAY_MS = 300

export const MOCK_VERIFICATION_CODE = '123456'

export function getEnvVersion(): EnvVersion {
  return wx.getAccountInfoSync().miniProgram.envVersion
}

export function isMockEnabled(): boolean {
  return getPublicDeployment() === null && MOCK_IN_DEVELOP && getEnvVersion() === 'develop'
}

export function getApiBaseUrl(): string {
  const env = getEnvVersion()
  const deployment = getPublicDeployment()
  if (deployment && /synthetic/i.test(deployment.version)) {
    throw new Error('此为离线构建检查包，无法连接服务')
  }
  const url = deployment?.apiBaseUrl ?? API_BASE_URLS[env]
  if (!url) {
    throw new Error('服务暂未开通，请稍后再试')
  }
  if ((env !== 'develop' || deployment !== null) && !/^https:\/\/[^\s/?#@]+\/api\/v1$/.test(url)) {
    throw new Error('服务配置不可用，请联系运营方')
  }
  return url
}

export function getDevelopmentLoginUsername(): DevelopmentLoginUsername | null {
  if (getPublicDeployment() !== null || getEnvVersion() !== 'develop' || isMockEnabled())
    return null
  const base = getApiBaseUrl()
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/api\/v1$/.test(base)) {
    return null
  }
  return DEVELOPMENT_LOGIN_USERNAME
}
import { getPublicDeployment } from './deployment'
