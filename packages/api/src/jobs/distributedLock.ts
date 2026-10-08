import type { RedisClient } from '../cache/redis.js'

export interface LockMetrics {
  acquisitions: number
  contentions: number
  releases: number
  heartbeats: number
  errors: number
}

/**
 * Lua script: delete key only if its value matches the caller's token.
 * Prevents a worker from releasing another worker's lock.
 */
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`

/**
 * Lua script: extend key TTL only if its value matches the caller's token.
 */
const HEARTBEAT_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`

/**
 * Redis-backed distributed lock for preventing duplicate cron executions
 * across scaled worker replicas.
 *
 * Uses SET NX PX for atomic acquire, Lua scripts for safe release/heartbeat,
 * and an automatic heartbeat timer to handle long-running jobs without
 * stale-lock risk.
 *
 * @example
 * ```typescript
 * const lock = new DistributedLock(redisClient, 30_000)
 * const { executed, result } = await lock.withLock('cron:score-snapshot', async () => {
 *   return job.run()
 * }, { logger: console.log })
 * if (!executed) console.log('Another worker is already running this job')
 * ```
 */
export class DistributedLock {
  private metrics: LockMetrics = {
    acquisitions: 0,
    contentions: 0,
    releases: 0,
    heartbeats: 0,
    errors: 0,
  }

  constructor(
    private readonly redis: RedisClient,
    /** Default lock TTL in milliseconds. Must exceed typical job duration. */
    private readonly defaultTtlMs: number = 30_000
  ) {}

  /**
   * Attempt to acquire the lock atomically.
   *
   * @returns A unique ownership token if acquired, or `null` if already held.
   */
  async acquire(key: string, ttlMs?: number): Promise<string | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const ttl = ttlMs ?? this.defaultTtlMs

    try {
      const result = await this.redis.set(key, token, { NX: true, PX: ttl })

      if (result === 'OK') {
        this.metrics.acquisitions++
        return token
      }

      this.metrics.contentions++
      return null
    } catch (error) {
      this.metrics.errors++
      throw error
    }
  }

  /**
   * Release the lock. Only succeeds when the caller owns it (token match).
   *
   * @returns `true` if the lock was released, `false` if it was not owned.
   */
  async release(key: string, token: string): Promise<boolean> {
    try {
      const result = (await this.redis.eval(RELEASE_SCRIPT, {
        keys: [key],
        arguments: [token],
      })) as number

      if (result === 1) {
        this.metrics.releases++
        return true
      }
      return false
    } catch (error) {
      this.metrics.errors++
      return false
    }
  }

  /**
   * Extend the lock TTL to prevent expiry during long-running jobs.
   * Only succeeds when the caller owns it.
   *
   * @returns `true` if the TTL was extended.
   */
  async heartbeat(key: string, token: string, ttlMs?: number): Promise<boolean> {
    const ttl = ttlMs ?? this.defaultTtlMs

    try {
      const result = (await this.redis.eval(HEARTBEAT_SCRIPT, {
        keys: [key],
        arguments: [token, String(ttl)],
      })) as number

      if (result === 1) {
        this.metrics.heartbeats++
        return true
      }
      return false
    } catch (error) {
      this.metrics.errors++
      return false
    }
  }

  /**
   * Execute `fn` while exclusively holding the distributed lock.
   *
   * - Starts an automatic heartbeat timer at 60% of `ttlMs` to keep the
   *   lock alive across long jobs.
   * - Always releases the lock in a `finally` block.
   * - If the lock is already held by another worker, returns
   *   `{ executed: false }` immediately (no waiting/retry).
   *
   * @param key            Redis key used as the lock name.
   * @param fn             Async function to run exclusively.
   * @param options.ttlMs  Lock TTL in ms (default: `defaultTtlMs`).
   * @param options.heartbeatIntervalMs  Heartbeat interval (default: 60% of ttlMs).
   * @param options.logger Optional log function for lock lifecycle events.
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: {
      ttlMs?: number
      heartbeatIntervalMs?: number
      logger?: (msg: string) => void
    } = {}
  ): Promise<{ executed: boolean; result?: T }> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.floor(ttlMs * 0.6)
    const logger = options.logger ?? (() => {})

    const token = await this.acquire(key, ttlMs)

    if (!token) {
      logger(`[DistributedLock] Contention on "${key}" — skipping (another worker holds lock)`)
      return { executed: false }
    }

    logger(`[DistributedLock] Acquired "${key}" (worker: ${token.slice(0, 20)}...)`)

    const heartbeatTimer = setInterval(async () => {
      const ok = await this.heartbeat(key, token, ttlMs)
      if (ok) {
        logger(`[DistributedLock] Heartbeat extended "${key}"`)
      } else {
        logger(`[DistributedLock] Heartbeat failed for "${key}" — lock may have expired`)
      }
    }, heartbeatIntervalMs)

    try {
      const result = await fn()
      return { executed: true, result }
    } finally {
      clearInterval(heartbeatTimer)
      await this.release(key, token)
      logger(`[DistributedLock] Released "${key}"`)
    }
  }

  /** Current lock contention metrics (snapshot copy). */
  getMetrics(): Readonly<LockMetrics> {
    return { ...this.metrics }
  }

  resetMetrics(): void {
    this.metrics = { acquisitions: 0, contentions: 0, releases: 0, heartbeats: 0, errors: 0 }
  }
}
