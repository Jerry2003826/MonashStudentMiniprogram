import { authRoutes } from './handlers/auth'
import { activityRoutes } from './handlers/activities'
import { forumRoutes } from './handlers/forum'
import { homeRoutes } from './handlers/home'
import { meRoutes } from './handlers/me'
import { membershipRoutes } from './handlers/membership'
import { merchantRoutes } from './handlers/merchants'
import { supportRoutes } from './handlers/support'
import { staffRoutes } from './handlers/staff'
import type { MockRoute } from './router'

export const mockRoutes: MockRoute[] = [
  ...authRoutes,
  ...meRoutes,
  ...membershipRoutes,
  ...homeRoutes,
  ...merchantRoutes,
  ...forumRoutes,
  ...activityRoutes,
  ...supportRoutes,
  ...staffRoutes,
]
