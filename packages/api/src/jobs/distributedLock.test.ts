import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DistributedLock } from './distributedLock.js'
import { JobScheduler } from './scheduler.js'
import type { ScoreSnapshotJob } from './scoreSnapshot.js'

// ---------------------------------------------------------------------------
// In-memory Redis stub – mimics SET NX PX, GET, DEL, PEXPIRE via Lua eval
// ---------------------------------------------------------------------------

interface StoreEntry {
  value: string
  expiresAt: number
}

function makeFakeRedis() {
  const store = new Map<string, StoreEntry>()

  function isAlive(entry: StoreEntry | undefined): entry is StoreEntry {
    return entry !== undefined && entry.expiresAt > Date.now()
  }

  return {
    _store: store,

    async set(
      key: string,
      value: string,
      options?: { NX?: boolean; PX?: number }
    ): Promise<string | null> {
      const existing = store.get(key)
      if (options?.NX && isAlive(existing)) {
        return null
      }
      store.set(key, {
        value,
        expiresAt: options?.PX ? Date.now() + options.PX : Infinity,
      })
      return 'OK'
    },

    /** Dispatches the correct script logic based on argument count. */
    async eval(
      _script: string,
      opts: { keys: string[]; arguments: string[] }
    ): Promise<number> {
      const key = opts.keys[0]
      const token = opts.arguments[0]
      const entry = store.get(key)

      if (!isAlive(entry) || entry.value !== token) {
        return 0
      }

      if (opts.arguments.length === 1) {
        // RELEASE: del key
        store.delete(key)
        return 1
      } else {
        // HEARTBEAT: pexpire key ttlMs
        entry.expiresAt = Date.now() + parseInt(opts.arguments[1])
        return 1
      }
    },
  }
}

type FakeRedis = ReturnType<typeof makeFakeRedis>

// ---------------------------------------------------------------------------
// DistributedLock unit tests
// ---------------------------------------------------------------------------

describe('DistributedLock', () => {
  let redis: FakeRedis
  let lock: DistributedLock

  beforeEach(() => {
    redis = makeFakeRedis()
    lock = new DistributedLock(redis as any, 5_000)
  })

  it('acquires a free lock and returns a token', async () => {
    const token = await lock.acquire('test:lock')
    expect(token).toBeTypeOf('string')
    expect(token).not.toBeNull()
    expect(lock.getMetrics().acquisitions).toBe(1)
    expect(lock.getMetrics().contentions).toBe(0)
  })

  it('returns null when lock is already held', async () => {
    await lock.acquire('test:lock')
    const second = await lock.acquire('test:lock')
    expect(second).toBeNull()
    expect(lock.getMetrics().contentions).toBe(1)
  })

  it('releases lock so another caller can acquire it', async () => {
    const token = await lock.acquire('test:lock')
    await lock.release('test:lock', token!)
    expect(lock.getMetrics().releases).toBe(1)

    const second = await lock.acquire('test:lock')
    expect(second).not.toBeNull()
  })

  it('does not release a lock held by a different token', async () => {
    await lock.acquire('test:lock')
    const released = await lock.release('test:lock', 'wrong-token')
    expect(released).toBe(false)
    expect(lock.getMetrics().releases).toBe(0)
  })

  it('heartbeat extends the lock TTL', async () => {
    const token = await lock.acquire('test:lock', 100)
    const ok = await lock.heartbeat('test:lock', token!, 5_000)
    expect(ok).toBe(true)
    expect(lock.getMetrics().heartbeats).toBe(1)
  })

  it('heartbeat fails when token does not match', async () => {
    await lock.acquire('test:lock', 5_000)
    const ok = await lock.heartbeat('test:lock', 'bad-token', 5_000)
    expect(ok).toBe(false)
    expect(lock.getMetrics().heartbeats).toBe(0)
  })

  it('withLock executes fn and releases on success', async () => {
    const fn = vi.fn().mockResolvedValue('done')
    const { executed, result } = await lock.withLock('test:lock', fn)

    expect(executed).toBe(true)
    expect(result).toBe('done')
    expect(fn).toHaveBeenCalledOnce()
    // Lock must be released after withLock resolves
    const secondToken = await lock.acquire('test:lock')
    expect(secondToken).not.toBeNull()
  })

  it('withLock releases lock even when fn throws', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(lock.withLock('test:lock', fn)).rejects.toThrow('boom')

    // Lock should be released despite the error
    const token = await lock.acquire('test:lock')
    expect(token).not.toBeNull()
  })

  it('withLock returns { executed: false } when lock is already held', async () => {
    // Pre-hold the lock with a different lock instance sharing the same Redis
    const holder = new DistributedLock(redis as any, 5_000)
    await holder.acquire('test:lock')

    const fn = vi.fn()
    const { executed } = await lock.withLock('test:lock', fn)

    expect(executed).toBe(false)
    expect(fn).not.toHaveBeenCalled()
    expect(lock.getMetrics().contentions).toBe(1)
  })

  it('metrics can be reset', async () => {
    await lock.acquire('test:lock')
    lock.resetMetrics()
    expect(lock.getMetrics()).toEqual({
      acquisitions: 0,
      contentions: 0,
      releases: 0,
      heartbeats: 0,
      errors: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// Integration test: two workers competing for the same scheduled job
// ---------------------------------------------------------------------------

describe('DistributedLock — multi-worker integration', () => {
  it('only one of two concurrent workers executes the job per interval', async () => {
    // Shared in-memory Redis simulates a single Redis instance visible to both workers
    const sharedRedis = makeFakeRedis()

    const lockA = new DistributedLock(sharedRedis as any, 10_000)
    const lockB = new DistributedLock(sharedRedis as any, 10_000)

    let executionCount = 0

    const makeJob = (): ScoreSnapshotJob => ({
      run: vi.fn(async () => {
        executionCount++
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 20))
        return { processed: 1, saved: 1, errors: 0, duration: 20, startTime: new Date().toISOString() }
      }),
    } as unknown as ScoreSnapshotJob)

    const jobA = makeJob()
    const jobB = makeJob()

    const schedulerA = new JobScheduler(jobA, {
      intervalMs: 60_000,
      runOnStart: true,
      distributedLock: lockA,
      lockKey: 'cron:integration-test',
    })

    const schedulerB = new JobScheduler(jobB, {
      intervalMs: 60_000,
      runOnStart: true,
      distributedLock: lockB,
      lockKey: 'cron:integration-test',
    })

    // Start both workers simultaneously
    schedulerA.start()
    schedulerB.start()

    // Wait for both to attempt/complete
    await new Promise(resolve => setTimeout(resolve, 100))

    schedulerA.stop()
    schedulerB.stop()

    // Exactly one worker should have run the job
    expect(executionCount).toBe(1)

    // Confirm lock contention was detected across both lock instances
    const totalContentions = lockA.getMetrics().contentions + lockB.getMetrics().contentions
    expect(totalContentions).toBeGreaterThanOrEqual(1)
  })

  it('second worker runs job after first releases the lock', async () => {
    const sharedRedis = makeFakeRedis()

    const lockA = new DistributedLock(sharedRedis as any, 10_000)
    const lockB = new DistributedLock(sharedRedis as any, 10_000)

    const results: string[] = []

    // Worker A acquires and holds the lock briefly
    const tokenA = await lockA.acquire('cron:sequential-test', 5_000)
    expect(tokenA).not.toBeNull()

    // Worker B cannot acquire while A holds it
    const { executed: skipped } = await lockB.withLock('cron:sequential-test', async () => {
      results.push('B')
    })
    expect(skipped).toBe(false)
    expect(results).toHaveLength(0)

    // A releases the lock
    await lockA.release('cron:sequential-test', tokenA!)

    // Now B can acquire and run
    const { executed: ran } = await lockB.withLock('cron:sequential-test', async () => {
      results.push('B')
    })
    expect(ran).toBe(true)
    expect(results).toEqual(['B'])
  })
})

// ---------------------------------------------------------------------------
// JobScheduler integration: lock wired through scheduler
// ---------------------------------------------------------------------------

describe('JobScheduler with distributedLock', () => {
  it('skips job execution when another worker holds the lock', async () => {
    const sharedRedis = makeFakeRedis()
    const holderLock = new DistributedLock(sharedRedis as any, 10_000)
    const schedulerLock = new DistributedLock(sharedRedis as any, 10_000)

    // Simulate another worker already holding the lock
    const token = await holderLock.acquire('cron:score-snapshot', 10_000)
    expect(token).not.toBeNull()

    const mockJob = {
      run: vi.fn().mockResolvedValue({
        processed: 0, saved: 0, errors: 0, duration: 0, startTime: new Date().toISOString(),
      }),
    } as unknown as ScoreSnapshotJob

    const logs: string[] = []
    const scheduler = new JobScheduler(mockJob, {
      intervalMs: 60_000,
      runOnStart: true,
      distributedLock: schedulerLock,
      lockKey: 'cron:score-snapshot',
      logger: (msg) => logs.push(msg),
    })

    scheduler.start()
    await new Promise(resolve => setTimeout(resolve, 50))
    scheduler.stop()

    expect(mockJob.run).not.toHaveBeenCalled()
    expect(logs.some(l => l.includes('skipped') || l.includes('Contention'))).toBe(true)
  })

  it('executes job when lock is free', async () => {
    const sharedRedis = makeFakeRedis()
    const schedulerLock = new DistributedLock(sharedRedis as any, 10_000)

    const mockJob = {
      run: vi.fn().mockResolvedValue({
        processed: 5, saved: 5, errors: 0, duration: 10, startTime: new Date().toISOString(),
      }),
    } as unknown as ScoreSnapshotJob

    const scheduler = new JobScheduler(mockJob, {
      intervalMs: 60_000,
      runOnStart: true,
      distributedLock: schedulerLock,
      lockKey: 'cron:score-snapshot',
    })

    scheduler.start()
    await new Promise(resolve => setTimeout(resolve, 50))
    scheduler.stop()

    expect(mockJob.run).toHaveBeenCalledOnce()
  })
})
