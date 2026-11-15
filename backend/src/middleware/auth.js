/**
 * Authentication middleware.
 *
 * `createAuthMiddleware` populates req.user from a Bearer token when one is
 * provided, but does not require authentication.
 *
 * `createRequireAuthMiddleware` rejects the request with a friendly message
 * when the token is missing or no longer valid. Protected routes should use
 * it so that an expired session can never silently write into a shared
 * fallback folder.
 */
export function createAuthMiddleware(authService, apiKeyService) {
  return async function authenticateToken(req, res, next) {
    try {
      const header = req.headers.authorization || ''
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
      req.user = token ? await authService.verifyToken(token) : null
      if (!req.user && token && apiKeyService) {
        req.user = await apiKeyService.verifyKey(token)
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function createRequireAuthMiddleware(authService, apiKeyService) {
  return async function requireAuth(req, res, next) {
    try {
      const header = req.headers.authorization || ''
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null

      if (!token) {
        return res.status(401).json({
          error: 'You need to be signed in to do that. Please sign in and try again.'
        })
      }

      // A session token, or an API key for a machine.
      let user = await authService.verifyToken(token)
      if (!user && apiKeyService) {
        user = await apiKeyService.verifyKey(token)
      }
      if (!user) {
        return res.status(401).json({
          error: 'Your session has expired. Please sign in again to continue.'
        })
      }

      req.user = user
      next()
    } catch (error) {
      next(error)
    }
  }
}
