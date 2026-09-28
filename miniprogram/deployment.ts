import { PUBLIC_DEPLOYMENT } from './deployment.generated'

export interface PublicDeployment {
  apiBaseUrl: string
  version: string
  disclosure: {
    operatorName: string
    supportContact: string
    dataRegion: string
    retentionNotice: string
  }
}

export function getPublicDeployment(): PublicDeployment | null {
  return PUBLIC_DEPLOYMENT
}

export function getTestingLabel(): string {
  const env = wx.getAccountInfoSync().miniProgram.envVersion
  return env === 'trial' || (env === 'develop' && PUBLIC_DEPLOYMENT !== null) ? '内测版' : ''
}
