import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportWorker, createExportWorker } from './exportWorker.js'
import type {
  ExportDataSource,
  ExportWriter,
  ExportRow,
} from './exportTypes.js'

function createMockWriter(): ExportWriter & {
  batches: ExportRow[][]
  aborted: boolean
  closed: boolean
} {
  const state = {
    batches: [] as ExportRow[][],
    aborted: false,
    closed: false,
    open: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    writeBatch: vi.fn<(rows: ExportRow[]) => Promise<void>>(),
    close: vi.fn<() => Promise<void>>(),
    abort: vi.fn<() => Promise<void>>(),
  }

  state.writeBatch.mockImplementation(async (rows: ExportRow[]) => {
    state.batches.push([...rows])
  })
  state.close.mockImplementation(async () => {
    state.closed = true
  })
  state.abort.mockImplementation(async () => {
    state.aborted = true
  })

  return state
}

function createMockDataSource(rows: ExportRow[], cursorBatch?: number): ExportDataSource {
  return {
    getTotalCount: vi.fn<() => Promise<number>>().mockResolvedValue(rows.length),
    openCursor(_batchSize: number): AsyncIterable<ExportRow[]> {
      const size = cursorBatch ?? _batchSize
      let offset = 0
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (offset >= rows.length) {
                return { done: true as const, value: undefined }
              }
              const batch = rows.slice(offset, offset + size)
              offset += size
              return { done: false as const, value: batch }
            },
          }
        },
      }
    },
  }
}

describe('ExportWorker', () => {
  let writer: ReturnType<typeof createMockWriter>

  beforeEach(() => {
    writer = createMockWriter()
  })

  it('processes all rows across batches', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }))
    const dataSource = createMockDataSource(rows, 2)

    const worker = new ExportWorker(dataSource, writer, { batchSize: 2 })
    const result = await worker.run()

    expect(result.totalRows).toBe(5)
    expect(result.batchesProcessed).toBe(3)
    expect(result.errors).toBe(0)
  })

  it('calls writer lifecycle in order', async () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const dataSource = createMockDataSource(rows, 2)

    const worker = new ExportWorker(dataSource, writer, { batchSize: 2 })
    await worker.run()

    const openOrder = writer.open.mock.invocationCallOrder[0]
    const writeOrder = writer.writeBatch.mock.invocationCallOrder[0]
    const closeOrder = writer.close.mock.invocationCallOrder[0]

    expect(openOrder).toBeLessThan(writeOrder)
    expect(writeOrder).toBeLessThan(closeOrder)
  })

  it('writes each batch to the writer', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const dataSource = createMockDataSource(rows, 2)

    const worker = new ExportWorker(dataSource, writer, { batchSize: 2 })
    await worker.run()

    expect(writer.writeBatch).toHaveBeenCalledTimes(2)
    expect(writer.batches[0]).toEqual([{ id: 1 }, { id: 2 }])
    expect(writer.batches[1]).toEqual([{ id: 3 }])
  })

  it('handles empty dataset', async () => {
    const dataSource = createMockDataSource([])

    const worker = new ExportWorker(dataSource, writer)
    const result = await worker.run()

    expect(result.totalRows).toBe(0)
    expect(result.batchesProcessed).toBe(0)
    expect(writer.writeBatch).not.toHaveBeenCalled()
    expect(writer.closed).toBe(true)
  })

  it('aborts writer on data source error', async () => {
    const dataSource: ExportDataSource = {
      getTotalCount: vi.fn<() => Promise<number>>().mockResolvedValue(100),
      openCursor(): AsyncIterable<ExportRow[]> {
        let called = false
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (!called) {
                  called = true
                  return { done: false as const, value: [{ id: 1 }] }
                }
                throw new Error('cursor failed')
              },
            }
          },
        }
      },
    }

    const worker = new ExportWorker(dataSource, writer)

    await expect(worker.run()).rejects.toThrow('cursor failed')
    expect(writer.aborted).toBe(true)
    expect(writer.closed).toBe(false)
  })

  it('aborts writer on write error', async () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const dataSource = createMockDataSource(rows, 1)

    writer.writeBatch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'))

    const worker = new ExportWorker(dataSource, writer, { batchSize: 1 })

    await expect(worker.run()).rejects.toThrow('disk full')
    expect(writer.aborted).toBe(true)
    expect(writer.closed).toBe(false)
  })

  it('logs progress for each batch', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: i }))
    const dataSource = createMockDataSource(rows, 2)
    const logs: string[] = []

    const worker = new ExportWorker(dataSource, writer, {
      batchSize: 2,
      logger: (msg) => logs.push(msg),
    })
    await worker.run()

    expect(logs[0]).toContain('Export started')
    expect(logs[0]).toContain('4 rows')
    expect(logs.some((l) => l.includes('Batch 1 written'))).toBe(true)
    expect(logs.some((l) => l.includes('Batch 2 written'))).toBe(true)
    expect(logs[logs.length - 1]).toContain('Export completed')
  })

  it('returns timing metrics', async () => {
    const rows = [{ id: 1 }]
    const dataSource = createMockDataSource(rows)

    const worker = new ExportWorker(dataSource, writer)
    const result = await worker.run()

    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(result.startTime).toBeDefined()
    expect(new Date(result.startTime).getTime()).toBeGreaterThan(0)
  })

  it('uses default batch size of 500', async () => {
    const getTotalCount = vi.fn<() => Promise<number>>().mockResolvedValue(0)
    const openCursor = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true as const, value: undefined }
          },
        }
      },
    })

    const dataSource: ExportDataSource = { getTotalCount, openCursor }
    const worker = new ExportWorker(dataSource, writer)
    await worker.run()

    expect(openCursor).toHaveBeenCalledWith(500)
  })

  it('creates worker with factory function', () => {
    const dataSource = createMockDataSource([])
    const worker = createExportWorker(dataSource, writer)
    expect(worker).toBeInstanceOf(ExportWorker)
  })
})
