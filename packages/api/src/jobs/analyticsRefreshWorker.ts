import { logger as rootLogger } from '../utils/logger.js'
import {
  AnalyticsRefreshStrategy,
  type Connectable,
  DEFAULT_ANALYTICS_VIEW_SPECS,
  type AnalyticsViewSpec,
  type RefreshStrategyResult,
  type AnalyticsRefreshMetrics,
} from '../services/analytics/refreshStrategy.js'

/**
 * Result of a single worker invocation. Carries enough structure for the
 * scheduler to maintain its consecutive-failure counter and for operators
 * to debug a failed tick from logs alone.
 */
export interface AnalyticsRefreshWorkerResult {
  startTime: string
  durationMs: number
  duration?: number
  refreshed: boolean
  refreshedViews: string[]
  failedViews: RefreshStrategyResult['failedViews']
  cacheGeneration?: number
  /** Top-level non-fatal error message (e.g. unexpected runtime crash). */
  error?: string
}

export interface AnalyticsRefreshWorkerOptions {
  strategy: AnalyticsRefreshStrategy
  metrics?: AnalyticsRefreshMetrics
  logger?: ((msg: string) => void)
}

/**
 * Thin orchestration layer over the strategy. The worker is intentionally
 * stateful in its *result* (it tracks the last invocation for status
 * queries) but the consecutive-failure counter lives in the scheduler
 * (see `src/jobs/analyticsRefreshScheduler.ts`) so each replica owns its
 * own cooldown decision.
 */
export class AnalyticsRefreshWorker {
  private readonly strategy: AnalyticsRefreshStrategy
  private readonly metrics?: AnalyticsRefreshMetrics
  private readonly log: (msg: string) => void
  private lastResult: AnalyticsRefreshWorkerResult | null = null

  constructor(
    optionsOrStrategy: AnalyticsRefreshWorkerOptions | AnalyticsRefreshStrategy,
    logger?: (msg: string) => void,
    metrics?: AnalyticsRefreshMetrics
  ) {
    if (!optionsOrStrategy) {
      throw new Error('AnalyticsRefreshWorker requires a strategy')
    }
    if ('strategy' in (optionsOrStrategy as any)) {
      const opts = optionsOrStrategy as AnalyticsRefreshWorkerOptions
      if (!opts.strategy) {
        throw new Error('AnalyticsRefreshWorker requires a strategy')
      }
      this.strategy = opts.strategy
      this.metrics = opts.metrics
      this.log = opts.logger ?? ((msg: string) => rootLogger.info(msg))
    } else {
      this.strategy = optionsOrStrategy as AnalyticsRefreshStrategy
      this.metrics = metrics
      this.log = logger ?? ((msg: string) => rootLogger.info(msg))
    }
  }

  async run(): Promise<AnalyticsRefreshWorkerResult> {
    const startMs = Date.now()
    const startTime = new Date(startMs).toISOString()

    this.log('Starting analytics refresh worker...')

    try {
      let refreshed = true
      let refreshedViews: string[] = []
      let failedViews: RefreshStrategyResult['failedViews'] = []
      let cacheGeneration: number | undefined

      if (typeof (this.strategy as any).refreshConcurrently === 'function') {
        await (this.strategy as any).refreshConcurrently()
      } else if (typeof (this.strategy as any).refreshAll === 'function') {
        const result = await this.strategy.refreshAll()
        refreshed = result.failedViews.length === 0
        refreshedViews = result.refreshedViews
        failedViews = result.failedViews
        cacheGeneration = result.cacheGeneration
      }

      const durationMs = Date.now() - startMs
      const workerResult: AnalyticsRefreshWorkerResult = {
        startTime,
        durationMs,
        duration: durationMs,
        refreshed,
        refreshedViews,
        failedViews,
        cacheGeneration,
      }
      this.lastResult = workerResult
      this.log(`Analytics refresh completed successfully in ${durationMs}ms`)
      this.metrics?.incRuns('success')
      this.metrics?.observeDuration(durationMs)
      return workerResult
    } catch (error) {
      const durationMs = Date.now() - startMs
      const message = (error instanceof Error && error.message) ? error.message : 'Unknown refresh error'
      const workerResult: AnalyticsRefreshWorkerResult = {
        startTime,
        durationMs,
        duration: durationMs,
        refreshed: false,
        refreshedViews: [],
        failedViews: [],
        error: message,
      }
      this.lastResult = workerResult
      this.log(`Analytics refresh failed after ${durationMs}ms: ${message}`)
      this.metrics?.incRuns('error')
      this.metrics?.observeDuration(durationMs)
      return workerResult
    }
  }

  /** Last invocation result, useful for health/status exports. */
  getLastResult(): AnalyticsRefreshWorkerResult | null {
    return this.lastResult
  }
}

/**
 * Factory: builds a worker pointed at a real Postgres pool with default view
 * specs. Tests use the explicit constructor instead so they can inject a
 * stub strategy.
 */
export function createAnalyticsRefreshWorker(options: {
  pool: Connectable
  views?: AnalyticsViewSpec[]
  maxAttemptsPerView?: number
  retryBackoffMs?: number
  metrics?: AnalyticsRefreshMetrics
  logger?: (msg: string) => void
}): AnalyticsRefreshWorker {
  const strategy = new AnalyticsRefreshStrategy({
    pool: options.pool,
    views: options.views ?? [...DEFAULT_ANALYTICS_VIEW_SPECS],
    maxAttemptsPerView: options.maxAttemptsPerView,
    retryBackoffMs: options.retryBackoffMs,
    metrics: options.metrics,
    logger: options.logger,
  })
  return new AnalyticsRefreshWorker({ strategy, metrics: options.metrics, logger: options.logger })
}

/**
 * Calculates the refresh interval in milliseconds from a cron expression.
 */
export function getAnalyticsRefreshIntervalMs(cron: string): number {
  if (!cron || typeof cron !== 'string') {
    throw new Error('Cron expression cannot be empty')
  }
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 parts, got ${parts.length}`)
  }
  const [min, hour, dom, mon, dow] = parts
  if (dom !== '*' || mon !== '*' || dow !== '*') {
    throw new Error(`Unsupported cron expression: ${cron}`)
  }
  if (min === '*' && hour === '*') {
    return 60_000
  }
  if (min === '0' && hour === '*') {
    return 3_600_000
  }
  if (min === '0' && hour === '0') {
    return 86_400_000
  }
  const stepMatch = min.match(/^(\*|0)\/(\d+)$/)
  if (stepMatch && hour === '*') {
    const step = parseInt(stepMatch[2], 10)
    if (isNaN(step) || step <= 0) throw new Error(`Invalid step in cron: ${cron}`)
    return step * 60_000
  }
  throw new Error(`Unsupported cron expression: ${cron}`)
}
