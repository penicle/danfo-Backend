export interface ExportRow {
  [key: string]: unknown
}

export interface ExportDataSource {
  getTotalCount(): Promise<number>
  openCursor(batchSize: number): AsyncIterable<ExportRow[]>
}

export interface ExportWriter {
  open(): Promise<void>
  writeBatch(rows: ExportRow[]): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export interface ExportWorkerOptions {
  batchSize?: number
  logger?: (message: string) => void
}

export interface ExportWorkerResult {
  totalRows: number
  batchesProcessed: number
  errors: number
  duration: number
  startTime: string
}
