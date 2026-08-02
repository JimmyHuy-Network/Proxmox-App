import { decodeTermFrame, type TermFrame } from '@pve/api'

/**
 * Shell giả lập phía server cho `/termproxy` → `/vncwebsocket`.
 *
 * Chuyển từ `apps/desktop` (GĐ 0 spike) sang đây ở GĐ 5 để luyện đúng đường
 * đi mock: POST termproxy → WS vncwebsocket → handshake → khung termproxy.
 */

const ESC = '\x1b'
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`
const DIM = `${ESC}[2m`
const GREEN = `${ESC}[32m`
const YELLOW = `${ESC}[33m`
const BLUE = `${ESC}[34m`
const CYAN = `${ESC}[36m`
const RED = `${ESC}[31m`

interface FakeFile {
  name: string
  kind: 'dir' | 'file'
  size: number
  content?: string
}

const FILES: FakeFile[] = [
  { name: 'etc', kind: 'dir', size: 4096 },
  { name: 'var', kind: 'dir', size: 4096 },
  { name: 'root', kind: 'dir', size: 4096 },
  {
    name: 'pve-version.txt',
    kind: 'file',
    size: 62,
    content: 'pve-manager/9.2.1/abcdef1234567890 (running kernel: 6.14.11-1-pve)',
  },
  {
    name: 'ghi-chu.txt',
    kind: 'file',
    size: 96,
    content:
      'Đây là shell giả lập trên mock-server.\nGõ thử tiếng Việt có dấu để kiểm tra đóng khung UTF-8.\nGõ "help" để xem lệnh.',
  },
]

export class FakeShell {
  private buffer = ''
  private cols = 80
  private rows = 24
  private cwd = '/root'
  private closed = false

  private readonly write: (data: string) => void
  private readonly hostname: string
  private readonly title: string

  constructor(
    write: (data: string) => void,
    options: { hostname?: string; title?: string } = {},
  ) {
    this.write = write
    this.hostname = options.hostname ?? 'pve1'
    this.title = options.title ?? 'shell giả lập'
  }

  start(): void {
    this.write(
      [
        '',
        `${BOLD}${GREEN}Proxmox VE 9.2${RESET} ${DIM}(${this.title})${RESET}`,
        '',
        `${DIM}Mock termproxy — thử gõ: ${RESET}${CYAN}echo "Xin chào các bạn"${RESET}`,
        `${DIM}Gõ ${RESET}${CYAN}help${RESET}${DIM} để xem danh sách lệnh.${RESET}`,
        '',
      ].join('\r\n'),
    )
    this.prompt()
  }

  /** Nhận khung đã giải mã, hoặc byte thô từ websocket (tự decode). */
  handleRaw(raw: Uint8Array): void {
    const frame = decodeTermFrame(raw)
    if (frame) this.handleFrame(frame)
  }

  handleFrame(frame: TermFrame): void {
    if (this.closed) return

    switch (frame.type) {
      case 'data':
        this.handleInput(frame.data)
        break
      case 'resize':
        this.cols = frame.cols
        this.rows = frame.rows
        break
      case 'ping':
        break
    }
  }

  close(): void {
    this.closed = true
  }

  get isClosed(): boolean {
    return this.closed
  }

  private prompt(): void {
    this.write(
      `${BOLD}${RED}root@${this.hostname}${RESET}:${BOLD}${BLUE}${this.cwd}${RESET}# `,
    )
  }

  private handleInput(data: string): void {
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        this.write('\r\n')
        const line = this.buffer
        this.buffer = ''
        this.runCommand(line.trim())
        if (!this.closed) this.prompt()
        continue
      }

      if (ch === '\x7f' || ch === '\b') {
        if (this.buffer.length > 0) {
          const chars = [...this.buffer]
          const removed = chars.pop() ?? ''
          this.buffer = chars.join('')
          const width = isWideChar(removed) ? 2 : 1
          this.write('\b \b'.repeat(width))
        }
        continue
      }

      if (ch === '\x03') {
        this.write(`${YELLOW}^C${RESET}\r\n`)
        this.buffer = ''
        this.prompt()
        continue
      }

      if (ch === '\x0c') {
        this.write(`${ESC}[2J${ESC}[H`)
        this.prompt()
        this.write(this.buffer)
        continue
      }

      if (ch === '\x15') {
        const width = [...this.buffer].reduce((n, c) => n + (isWideChar(c) ? 2 : 1), 0)
        this.write('\b \b'.repeat(width))
        this.buffer = ''
        continue
      }

      if (ch < ' ' && ch !== '\t') continue

      this.buffer += ch
      this.write(ch)
    }
  }

  private runCommand(line: string): void {
    if (line === '') return

    const [cmd = '', ...args] = line.split(/\s+/)
    const rest = line.slice(cmd.length).trim()

    switch (cmd) {
      case 'help':
        this.println(
          [
            `${BOLD}Lệnh hỗ trợ:${RESET}`,
            `  ${CYAN}help${RESET}  ${CYAN}ls${RESET}  ${CYAN}pwd${RESET}  ${CYAN}cd${RESET}  ${CYAN}cat${RESET}  ${CYAN}echo${RESET}`,
            `  ${CYAN}pveversion${RESET}  ${CYAN}qm list${RESET}  ${CYAN}pct list${RESET}  ${CYAN}size${RESET}`,
            `  ${CYAN}uname -a${RESET}  ${CYAN}whoami${RESET}  ${CYAN}clear${RESET}  ${CYAN}exit${RESET}`,
          ].join('\r\n'),
        )
        break
      case 'ls':
        this.println(
          FILES.map((f) =>
            f.kind === 'dir' ? `${BOLD}${BLUE}${f.name}${RESET}` : f.name,
          ).join('  '),
        )
        break
      case 'pwd':
        this.println(this.cwd)
        break
      case 'cd': {
        const target = args[0]
        if (!target || target === '~') this.cwd = '/root'
        else if (target === '..') this.cwd = this.cwd.split('/').slice(0, -1).join('/') || '/'
        else if (target.startsWith('/')) this.cwd = target
        else this.cwd = this.cwd === '/' ? `/${target}` : `${this.cwd}/${target}`
        break
      }
      case 'cat': {
        const name = args[0]
        const file = FILES.find((f) => f.name === name)
        if (!file) this.println(`${RED}cat: ${name ?? ''}: Không tìm thấy tệp${RESET}`)
        else if (file.kind === 'dir') this.println(`${RED}cat: ${name}: Là một thư mục${RESET}`)
        else this.println((file.content ?? '').replace(/\n/g, '\r\n'))
        break
      }
      case 'echo':
        this.println(rest.replace(/^["']|["']$/g, ''))
        break
      case 'pveversion':
        this.println('pve-manager/9.2.1/abcdef1234567890 (running kernel: 6.14.11-1-pve)')
        break
      case 'uname':
        this.println(
          `Linux ${this.hostname} 6.14.11-1-pve #1 SMP PREEMPT_DYNAMIC PVE 6.14.11-1 x86_64 GNU/Linux`,
        )
        break
      case 'whoami':
        this.println('root')
        break
      case 'size':
        this.println(
          `${this.cols} cột × ${this.rows} dòng  ${DIM}(kéo giãn cửa sổ rồi gõ lại)${RESET}`,
        )
        break
      case 'qm':
        if (args[0] === 'list') {
          this.println(
            [
              '      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID',
              '       100 debian-13            running        2048           32.00 1234',
              '       101 windows-server       stopped        8192          128.00 0',
              '       102 ubuntu-noble         running        4096           64.00 5678',
            ].join('\r\n'),
          )
        } else this.println(`${RED}qm: lệnh con không hỗ trợ${RESET}`)
        break
      case 'pct':
        if (args[0] === 'list') {
          this.println(
            [
              'VMID       Status     Lock         Name',
              '200        running                 nginx-proxy',
              '201        stopped                 postgres-db',
            ].join('\r\n'),
          )
        } else this.println(`${RED}pct: lệnh con không hỗ trợ${RESET}`)
        break
      case 'clear':
        this.write(`${ESC}[2J${ESC}[H`)
        break
      case 'exit':
      case 'logout':
        this.println(`${DIM}Đã đóng phiên.${RESET}`)
        this.closed = true
        break
      default:
        this.println(`${RED}${cmd}: không tìm thấy lệnh${RESET}  ${DIM}(gõ "help")${RESET}`)
    }
  }

  private println(text: string): void {
    this.write(`${text}\r\n`)
  }
}

function isWideChar(ch: string): boolean {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff)
  )
}
