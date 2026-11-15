/**
 * Rate limiting.
 *
 * The sign in and sign up endpoints are the ones worth limiting: they are
 * the door into an account, and without a limit they are a place to try
 * passwords until one works.
 *
 * The buckets live in memory. That is enough for a single instance, which
 * is how this runs.
 */
export function createRateLimit(options = {}) {
  const windowMs = options.windowMs ?? 15 * 60 * 1000
  const max = options.max ?? 20
  const message = options.message || 'Too many attempts. Please wait a little and try again.'
  const keyFn = options.keyFn || (req => req.ip || req.socket?.remoteAddress || 'unknown')
  const skip = options.skip || (() => false)

  const buckets = new Map()

  /**
   * Clear the count for a key.
   *
   * A person who signs in successfully should not stay close to the
   * limit because they mistyped the password twice first.
   *
   * It takes the same thing the key function takes, so a caller with a
   * request passes the request and it works out the key itself.
   */
  const clear = input => {
    buckets.delete(typeof input === 'string' ? input : keyFn(input))
  }

  // The buckets are swept so the map does not grow for ever.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetAt) buckets.delete(key)
    }
  }, Math.max(windowMs, 60_000))
  if (sweep.unref) sweep.unref()

  function rateLimit(req, res, next) {
    if (skip(req)) return next()

    const key = keyFn(req)
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    bucket.count += 1
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({ error: message, retryAfter })
    }

    next()
  }

  // The count can be cleared, so a person who signs in successfully is
  // not left close to the limit.
  rateLimit.clear = clear

  return rateLimit
}
