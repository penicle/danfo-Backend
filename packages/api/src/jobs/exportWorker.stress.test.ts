import { describe, expect, it } from 'vitest'
import { ExportWorker } from './exportWorker.js'
import type { ExportDataSource, ExportRow, ExportWriter } from './exportTypes.js'

const TOTAL_ROWS = 100_000
const BATCH_SIZE = 500
const MEMORY_CEILING_MB = 50

function generateRow(index: number): ExportRow {
  return {
    id: index,
    name: `identity-${index}`,
    score: Math.random() * 100,
    bondedAmount: `${Math.floor(Math.random() * 10000)}`,
    attestationCount: Math.floor(Math.random() * 200),
    timestamp: new Date().toISOString(),
  }
}

function createLargeDataSource(totalRows: number): ExportDataSource {
  return {
    async getTotalCount() {
      return totalRows
    },
    openCursor(batchSize: number): AsyncIterable<ExportRow[]> {
      let offset = 0
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (offset >= totalRows) {
                return { done: true as const, value: undefined }
              }
              const size = Math.min(batchSize, totalRows - offset)
              const batch: ExportRow[] = []
              for (let i = 0; i < size; i++) {
                batch.push(generateRow(offset + i))
              }
              offset += size
              return { done: false as const, value: batch }
            },
          }
        },
      }
    },
  }
}

function createDiscardWriter(): ExportWriter {
  return {
    async open() {},
    async writeBatch(_rows: ExportRow[]) {},
    async close() {},
    async abort() {},
  }
}

describe('ExportWorker stress', () => {
  it(`exports ${TOTAL_ROWS.toLocaleString()} rows within ${MEMORY_CEILING_MB}MB memory ceiling`, async () => {
    const dataSource = createLargeDataSource(TOTAL_ROWS)
    const writer = createDiscardWriter()

    if (global.gc) {
      global.gc()
    }
    const heapBefore = process.memoryUsage().heapUsed

    const worker = new ExportWorker(dataSource, writer, { batchSize: BATCH_SIZE })
    const result = await worker.run()

    const heapAfter = process.memoryUsage().heapUsed
    const deltaMB = (heapAfter - heapBefore) / (1024 * 1024)

    expect(result.totalRows).toBe(TOTAL_ROWS)
    expect(result.batchesProcessed).toBe(Math.ceil(TOTAL_ROWS / BATCH_SIZE))
    expect(result.errors).toBe(0)
    expect(deltaMB).toBeLessThan(MEMORY_CEILING_MB)
  }, 30_000)
})
