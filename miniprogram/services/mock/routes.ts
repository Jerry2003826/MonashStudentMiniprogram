import { authRoutes } from './handlers/auth'
import { meRoutes } from './handlers/me'
import { membershipRoutes } from './handlers/membership'
import type { MockRoute } from './router'

export const mockRoutes: MockRoute[] = [...authRoutes, ...meRoutes, ...membershipRoutes]
