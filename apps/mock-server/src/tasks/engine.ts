export interface TaskStep {
  /** Mốc thời gian tính từ lúc tác vụ bắt đầu, đơn vị mili giây. */
  atMs: number
  log?: string
  /** Có mặt nghĩa là tác vụ kết thúc tại mốc này. `OK` là thành công. */
  done?: string
}

export interface MockTask {
  upid: string
  node: string
  pid: number
  pstart: number
  starttime: number
  type: string
  id: string
  user: string
  status: 'running' | 'stopped'
  exitstatus?: string
  log: { n: number; t: string }[]
  startedAt: number
  steps: TaskStep[]
  nextStep: number
  /** Chạy khi tác vụ kết thúc thành công — chỗ áp dụng thay đổi trạng thái. */
  onSuccess?: () => void
}

export interface StartTaskInit {
  node: string
  type: string
  id: string
  user: string
  steps: TaskStep[]
  onSuccess?: () => void
}

let pidCounter = 0x1000

function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

/**
 * Bộ máy tác vụ chạy nền.
 *
 * Điểm quan trọng nhất: **trạng thái guest chỉ đổi khi tác vụ kết thúc**, không phải
 * ngay lúc gọi API. Đó đúng là hành vi của Proxmox thật, và nó buộc giao diện phải
 * trung thực — nếu ta đổi trạng thái ngay thì mọi lỗi về cập nhật lạc quan sẽ bị
 * che mất cho tới khi gặp phần cứng thật.
 */
export class TaskEngine {
  private readonly tasks = new Map<string, MockTask>()
  private timer: NodeJS.Timeout | null = null

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 200)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  reset(): void {
    this.tasks.clear()
  }

  /**
   * Tạo UPID đúng định dạng thật:
   * `UPID:node:PID:PSTART:STARTTIME:TYPE:ID:USER@REALM:`
   * với PID, PSTART và STARTTIME viết dạng hex.
   */
  startTask(init: StartTaskInit): MockTask {
    const now = Date.now()
    const starttime = Math.floor(now / 1000)
    const pid = pidCounter++
    const pstart = 0x1a2b3c

    const upid = `UPID:${init.node}:${hex(pid, 8)}:${hex(pstart, 8)}:${hex(starttime, 8)}:${init.type}:${init.id}:${init.user}:`

    const task: MockTask = {
      upid,
      node: init.node,
      pid,
      pstart,
      starttime,
      type: init.type,
      id: init.id,
      user: init.user,
      status: 'running',
      log: [{ n: 1, t: `bắt đầu tác vụ ${init.type}` }],
      startedAt: now,
      steps: [...init.steps].sort((a, b) => a.atMs - b.atMs),
      nextStep: 0,
      ...(init.onSuccess ? { onSuccess: init.onSuccess } : {}),
    }

    this.tasks.set(upid, task)
    return task
  }

  get(upid: string): MockTask | undefined {
    return this.tasks.get(upid)
  }

  list(node?: string): MockTask[] {
    const all = [...this.tasks.values()]
    const filtered = node ? all.filter((t) => t.node === node) : all
    return filtered.sort((a, b) => b.starttime - a.starttime)
  }

  private tick(): void {
    const now = Date.now()

    for (const task of this.tasks.values()) {
      if (task.status === 'stopped') continue

      const elapsed = now - task.startedAt

      while (task.nextStep < task.steps.length) {
        const step = task.steps[task.nextStep]
        if (!step || step.atMs > elapsed) break

        if (step.log) {
          task.log.push({ n: task.log.length + 1, t: step.log })
        }

        if (step.done !== undefined) {
          task.status = 'stopped'
          task.exitstatus = step.done
          task.log.push({ n: task.log.length + 1, t: `TASK ${step.done}` })
          if (step.done === 'OK') task.onSuccess?.()
        }

        task.nextStep += 1
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kịch bản theo loại tác vụ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thời lượng và các dòng log cho từng loại tác vụ.
 *
 * Cố ý cho `vzdump` chạy lâu và in phần trăm: giao diện tiến trình chỉ lộ khuyết
 * điểm khi có một tác vụ đủ dài để nhìn.
 */
export const TASK_TEMPLATES: Record<string, TaskStep[]> = {
  qmstart: [
    { atMs: 300, log: 'đang cấp phát bộ nhớ' },
    { atMs: 900, log: 'khởi động tiến trình QEMU' },
    { atMs: 1800, log: 'máy ảo đã khởi động' },
    { atMs: 2000, done: 'OK' },
  ],
  qmstop: [
    { atMs: 200, log: 'gửi tín hiệu dừng' },
    { atMs: 800, done: 'OK' },
  ],
  qmshutdown: [
    { atMs: 400, log: 'gửi lệnh tắt máy qua ACPI' },
    { atMs: 2500, log: 'hệ điều hành khách đã dừng' },
    { atMs: 3000, done: 'OK' },
  ],
  qmreboot: [
    { atMs: 400, log: 'gửi lệnh khởi động lại' },
    { atMs: 2500, log: 'máy ảo đang khởi động lại' },
    { atMs: 3200, done: 'OK' },
  ],
  qmreset: [{ atMs: 500, done: 'OK' }],
  qmsuspend: [
    { atMs: 500, log: 'đang lưu trạng thái' },
    { atMs: 1500, done: 'OK' },
  ],
  qmresume: [{ atMs: 600, done: 'OK' }],
  vzstart: [
    { atMs: 300, log: 'đang khởi động container' },
    { atMs: 1200, done: 'OK' },
  ],
  vzstop: [{ atMs: 600, done: 'OK' }],
  vzshutdown: [
    { atMs: 400, log: 'đang tắt container' },
    { atMs: 1800, done: 'OK' },
  ],
  qmclone: [
    { atMs: 500, log: 'tạo cấu hình máy ảo mới' },
    { atMs: 2000, log: 'sao chép đĩa: 25%' },
    { atMs: 4000, log: 'sao chép đĩa: 50%' },
    { atMs: 6000, log: 'sao chép đĩa: 75%' },
    { atMs: 8000, log: 'sao chép đĩa: 100%' },
    { atMs: 8500, done: 'OK' },
  ],
  qmigrate: [
    { atMs: 500, log: 'kiểm tra điều kiện di chuyển' },
    { atMs: 2000, log: 'bắt đầu chuyển bộ nhớ' },
    { atMs: 5000, log: 'đã chuyển 60% bộ nhớ' },
    { atMs: 8000, log: 'hoàn tất chuyển bộ nhớ' },
    { atMs: 9000, done: 'OK' },
  ],
  vzmigrate: [
    { atMs: 400, log: 'kiểm tra điều kiện di chuyển container' },
    { atMs: 2000, log: 'sao chép rootfs sang node đích' },
    { atMs: 4000, done: 'OK' },
  ],
  vzdump: [
    { atMs: 500, log: 'INFO: bắt đầu sao lưu' },
    { atMs: 1500, log: 'INFO: tiến trình 10% (429 MB / 4.29 GB)' },
    { atMs: 4000, log: 'INFO: tiến trình 30% (1.29 GB / 4.29 GB)' },
    { atMs: 8000, log: 'INFO: tiến trình 60% (2.57 GB / 4.29 GB)' },
    { atMs: 12000, log: 'INFO: tiến trình 90% (3.86 GB / 4.29 GB)' },
    { atMs: 14000, log: 'INFO: sao lưu hoàn tất' },
    { atMs: 15000, done: 'OK' },
  ],
  imgdel: [{ atMs: 800, done: 'OK' }],
  imgcopy: [
    { atMs: 200, log: 'INFO: nhận file upload' },
    { atMs: 800, log: 'INFO: ghi vào storage' },
    { atMs: 1200, done: 'OK' },
  ],
  imgalloc: [
    { atMs: 300, log: 'INFO: cấp phát đĩa' },
    { atMs: 900, done: 'OK' },
  ],
  download: [
    { atMs: 400, log: 'INFO: bắt đầu tải từ URL' },
    { atMs: 1500, log: 'INFO: tiến trình 40%' },
    { atMs: 3000, log: 'INFO: tiến trình 80%' },
    { atMs: 4000, log: 'INFO: tải xong' },
    { atMs: 4200, done: 'OK' },
  ],
  qmsnapshot: [
    { atMs: 600, log: 'tạo ảnh chụp' },
    { atMs: 1500, done: 'OK' },
  ],
  qmdelsnapshot: [
    { atMs: 400, log: 'xoá ảnh chụp' },
    { atMs: 1000, done: 'OK' },
  ],
  qmrollback: [
    { atMs: 800, log: 'khôi phục về ảnh chụp' },
    { atMs: 2500, done: 'OK' },
  ],
  qmdestroy: [
    { atMs: 500, log: 'xoá đĩa' },
    { atMs: 1800, done: 'OK' },
  ],
  qmcreate: [
    { atMs: 300, log: 'tạo cấu hình máy ảo' },
    { atMs: 900, log: 'cấp phát đĩa' },
    { atMs: 1600, log: 'máy ảo đã được tạo' },
    { atMs: 1800, done: 'OK' },
  ],
  vzcreate: [
    { atMs: 300, log: 'giải nén template' },
    { atMs: 1000, log: 'tạo cấu hình container' },
    { atMs: 1600, log: 'container đã được tạo' },
    { atMs: 1800, done: 'OK' },
  ],
  vzclone: [
    { atMs: 400, log: 'tạo cấu hình container mới' },
    { atMs: 1500, log: 'sao chép rootfs' },
    { atMs: 2800, done: 'OK' },
  ],
  qmresize: [
    { atMs: 400, log: 'thay đổi kích thước đĩa' },
    { atMs: 1200, done: 'OK' },
  ],
  vzresize: [
    { atMs: 400, log: 'thay đổi kích thước volume' },
    { atMs: 1200, done: 'OK' },
  ],
  qmtemplate: [
    { atMs: 400, log: 'chuyển đĩa sang base image' },
    { atMs: 1500, done: 'OK' },
  ],
  qmmove: [
    { atMs: 400, log: 'sao chép đĩa sang storage đích' },
    { atMs: 2000, done: 'OK' },
  ],
  vzmove: [
    { atMs: 400, log: 'sao chép volume sang storage đích' },
    { atMs: 1800, done: 'OK' },
  ],
  // Đối chiếu với PVE 9.2.2 thật: type task của snapshot LXC là vzsnapshot/
  // vzdelsnapshot, khác hẳn qmsnapshot dùng cho QEMU — không dùng chung tên.
  vzsnapshot: [
    { atMs: 500, log: 'tạo ảnh chụp container' },
    { atMs: 1200, done: 'OK' },
  ],
  vzdelsnapshot: [
    { atMs: 300, log: 'xoá ảnh chụp container' },
    { atMs: 800, done: 'OK' },
  ],
  vzrollback: [
    { atMs: 600, log: 'khôi phục container về ảnh chụp' },
    { atMs: 2000, done: 'OK' },
  ],
  vzdestroy: [{ atMs: 1500, done: 'OK' }],
  networkreload: [
    { atMs: 200, log: 'reload network config' },
    { atMs: 800, log: 'ifup -a' },
    { atMs: 1200, done: 'OK' },
  ],
  diskinit: [
    { atMs: 300, log: 'create GPT' },
    { atMs: 900, done: 'OK' },
  ],
  diskwipe: [
    { atMs: 200, log: 'wipe disk' },
    { atMs: 1500, done: 'OK' },
  ],
  dircreate: [{ atMs: 800, done: 'OK' }],
  dirremove: [{ atMs: 600, done: 'OK' }],
  lvmcreate: [{ atMs: 1000, done: 'OK' }],
  lvmremove: [{ atMs: 800, done: 'OK' }],
  lvmthincreate: [{ atMs: 1000, done: 'OK' }],
  lvmthinremove: [{ atMs: 800, done: 'OK' }],
  zfscreate: [
    { atMs: 400, log: 'zpool create' },
    { atMs: 1400, done: 'OK' },
  ],
  zfsremove: [{ atMs: 1000, done: 'OK' }],
  aptupdate: [
    { atMs: 300, log: 'apt-get update' },
    { atMs: 1200, done: 'OK' },
  ],
  acmeorder: [
    { atMs: 400, log: 'order certificate' },
    { atMs: 1600, done: 'OK' },
  ],
  acmerenew: [{ atMs: 1200, done: 'OK' }],
  acmerevoke: [{ atMs: 800, done: 'OK' }],
  acmeaccount: [{ atMs: 1000, done: 'OK' }],
  cephosdcreate: [
    { atMs: 500, log: 'create OSD' },
    { atMs: 2000, done: 'OK' },
  ],
  cephpoolcreate: [{ atMs: 1200, done: 'OK' }],
  clustercreate: [
    { atMs: 400, log: 'create cluster' },
    { atMs: 1500, done: 'OK' },
  ],
  clusterjoin: [
    { atMs: 400, log: 'join cluster' },
    { atMs: 1800, done: 'OK' },
  ],
}

export function templateFor(type: string): TaskStep[] {
  return TASK_TEMPLATES[type] ?? [{ atMs: 1000, done: 'OK' }]
}

/** Biến một kịch bản thành phiên bản thất bại, dùng để dựng giao diện báo lỗi. */
export function failingVariant(steps: TaskStep[], message: string): TaskStep[] {
  const cutoff = Math.max(1, Math.floor(steps.length / 2))
  const partial = steps.slice(0, cutoff).filter((s) => s.done === undefined)
  const lastAt = partial.at(-1)?.atMs ?? 0
  return [...partial, { atMs: lastAt + 500, log: `ERROR: ${message}`, done: message }]
}
