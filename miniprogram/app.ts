import { ensureLogin, relogin } from './services/auth'
import { showError } from './services/errors'
import { setUnauthorizedHandler } from './services/request'

App({
  onLaunch() {
    setUnauthorizedHandler(relogin)
    ensureLogin().catch(showError)
  },
})
