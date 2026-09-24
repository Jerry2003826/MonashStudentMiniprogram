import { authRoutes } from './handlers/auth'
import { forumRoutes } from './handlers/forum'
import { homeRoutes } from './handlers/home'
import { meRoutes } from './handlers/me'
import { membershipRoutes } from './handlers/membership'
import { merchantRoutes } from './handlers/merchants'
import type { MockRoute } from './router'

export const mockRoutes: MockRoute[] = [
  ...authRoutes,
  ...meRoutes,
  ...membershipRoutes,
  ...homeRoutes,
  ...merchantRoutes,
  ...forumRoutes,
]
