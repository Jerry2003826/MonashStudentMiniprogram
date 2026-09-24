// wx.request 不支持 PATCH
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type Query = Record<string, string | number | undefined>
