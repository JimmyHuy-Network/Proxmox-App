/**
 * Chuyển file lớn (upload ISO/vztmpl, tải về) — stream qua main, không qua renderer.
 *
 * Renderer chỉ chọn tham số (node/storage/content) và theo dõi tiến trình qua
 * sự kiện `transfer`. Đường dẫn file thật chỉ tồn tại trong main (dialog).
 */

export type TransferKind = 'upload' | 'download'

export type TransferPhase = 'started' | 'progress' | 'done' | 'error' | 'cancelled'

export interface TransferUploadRequest {
  connectionId: string
  node: string
  storage: string
  /** iso | vztmpl | import */
  content: string
  /** Ghi đè tên file trên storage; mặc định lấy basename của file local. */
  filename?: string
}

export interface TransferDownloadRequest {
  connectionId: string
  node: string
  storage: string
  /** Volid đầy đủ, ví dụ `local:iso/debian.iso`. */
  volume: string
  /**
   * PBS file-restore: đường dẫn base64 trong snapshot.
   * Khi có, main gọi `/file-restore/download` thay vì content volume.
   */
  filepath?: string
}

export interface TransferStartResult {
  transferId: string
}

export interface TransferEvent {
  kind: 'transfer'
  transferId: string
  connectionId: string
  transferKind: TransferKind
  phase: TransferPhase
  bytesSent?: number
  totalBytes?: number
  /** UPID nếu server trả về sau khi upload xong. */
  upid?: string
  message?: string
}
