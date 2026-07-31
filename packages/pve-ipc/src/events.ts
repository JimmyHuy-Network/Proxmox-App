import type { ConsoleClosedEvent } from './console'

/**
 * Trạng thái xác thực của một kết nối. Renderer hiển thị thành chấm màu
 * cạnh tên cluster trong thanh chọn kết nối.
 */
export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'cert-challenge'
  | 'tfa-challenge'
  | 'authenticated'
  | 'renewing'
  /** Còn dùng được nhưng có trục trặc — ví dụ một node trong cluster không phản hồi. */
  | 'degraded'
  | 'failed'

export interface AuthEvent {
  kind: 'auth'
  connectionId: string
  phase: ConnectionPhase
  message?: string
}

/**
 * Gặp chứng chỉ chưa tin cậy. Renderer hiện vân tay để người dùng đối chiếu
 * với `pvenode cert info` trên server trước khi bấm Tin cậy.
 */
export interface CertUntrustedEvent {
  kind: 'cert-untrusted'
  connectionId: string
  /** SHA-256, định dạng cặp hai ký tự phân cách bằng dấu hai chấm. */
  fingerprint256: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
}

/** Một nhịp poll `/cluster/resources`. Main poll liên tục kể cả khi cửa sổ thu nhỏ. */
export interface ResourcesEvent {
  kind: 'resources'
  connectionId: string
  resources: unknown[]
  at: number
}

export type TaskPhase = 'started' | 'running' | 'done'

export interface TaskEvent {
  kind: 'task'
  connectionId: string
  upid: string
  phase: TaskPhase
  /** Chỉ có khi phase là 'done'. 'OK' nghĩa là thành công, chuỗi khác là thông báo lỗi. */
  exitstatus?: string
}

/** Một đoạn log của task, đã tôn trọng con trỏ `start` nên không trùng lặp. */
export interface LogChunkEvent {
  kind: 'log-chunk'
  connectionId: string
  upid: string
  lines: { n: number; t: string }[]
}

export interface ConsoleEvent extends ConsoleClosedEvent {
  kind: 'console-closed'
}

/** Mọi thứ main đẩy sang renderer đều đi qua một kênh duy nhất, phân biệt bằng `kind`. */
export type PveEvent =
  | AuthEvent
  | CertUntrustedEvent
  | ResourcesEvent
  | TaskEvent
  | LogChunkEvent
  | ConsoleEvent
