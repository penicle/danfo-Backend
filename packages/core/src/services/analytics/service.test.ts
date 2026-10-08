import { describe, expect, it, vi } from 'vitest'
import { AnalyticsService, computeStaleness } from './service.js'
import type { Queryable } from '../../db/repositories/queryable.js'

describe('computeStaleness', () => {
  it('marks data as fresh when age is within threshold', () => {
    const now = new Date('2026-03-24T12:00:00.000Z')
    const asOf = new Date('2026-03-24T11:56:00.000Z')

    const result = computeStaleness(asOf, now, 300, false)

    expect(result.fresh).toBe(true)
    expect(result.refreshStatus).toBe('ok')
    expect(result.ageSeconds).toBe(240)
  })

  it('marks data as stale when age exceeds threshold', () => {
    const now = new Date('2026-03-24T12:00:00.000Z')
    const asOf = new Date('2026-03-24T11:50:00.000Z')

    const result = computeStaleness(asOf, now, 300, false)

    expect(result.fresh).toBe(false)
    expect(result.refreshStatus).toBe('stale')
    expect(result.ageSeconds).toBe(600)
  })

  it('marks status as failed_recently when refresh has errors', () => {
    const now = new Date('2026-03-24T12:00:00.000Z')
    const asOf = new Date('2026-03-24T11:58:00.000Z')

    const result = computeStaleness(asOf, now, 300, true)

    expect(result.refreshStatus).toBe('failed_recently')
    expect(result.fresh).toBe(true)
  })
})

describe('AnalyticsService', () => {
  it('returns summary payload with staleness metadata', async () => {
    const db: Queryable = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              active_identities: '10',
              total_identities: '12',
              avg_total_score: '87.12',
              latest_score_calculated_at: '2026-03-24T11:59:00.000Z',
              snapshot_at: '2026-03-24T11:58:00.000Z',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              view_name: 'analytics_metrics_mv',
              last_success_at: '2026-03-24T11:58:00.000Z',
              last_attempt_at: '2026-03-24T11:59:00.000Z',
              last_error: null,
            },
          ],
          rowCount: 1,
        }),
    }

    const service = new AnalyticsService(db, 300)
    const response = await service.getSummary(new Date('2026-03-24T12:00:00.000Z'))

    expect(response.metrics.activeIdentities).toBe(10)
    expect(response.metrics.totalIdentities).toBe(12)
    expect(response.metrics.avgTotalScore).toBeCloseTo(87.12, 2)
    expect(response.staleness.refreshStatus).toBe('ok')
    expect(response.staleness.fresh).toBe(true)
  })
})

