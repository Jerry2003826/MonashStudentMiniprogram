import type { Me, UpdateMeBody } from '../../types/api'
import { setCachedMe } from '../auth'
import { request, uploadFile } from '../request'

export async function updateNickname(nickname: string): Promise<Me> {
  const body: UpdateMeBody = { nickname }
  const me = await request<Me>({ method: 'PUT', path: '/me', body })
  setCachedMe(me)
  return me
}

export async function uploadAvatar(filePath: string): Promise<Me> {
  const me = await uploadFile<Me>('/me/avatar', filePath)
  setCachedMe(me)
  return me
}

export async function deleteAccount(): Promise<void> {
  await request<null>({ method: 'DELETE', path: '/me' })
}
