import type { TermFrame } from '@shared/term-protocol'

/**
 * Shell giả lập chạy phía "server" của relay console.
 *
 * Mục đích không phải làm một shell thật, mà là **luyện hết đường đi của giao thức
 * termproxy** khi chưa có Proxmox: đóng khung, echo ký tự nhiều byte, xử lý đổi kích
 * thước, giữ nhịp, và ANSI escape. Nếu gõ được tiếng Việt có dấu ở đây mà không vỡ
 * ký tự thì phần khó nhất của console đã đúng.
 *
 * Ở giai đoạn 1 khối này chuyển sang `apps/mock-server`, nơi nó phục vụ đúng endpoint
 * `/termproxy` + `/vncwebsocket` như thật.
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

const HOSTNAME = 'pve1'
const USER = 'root'

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
      'Đây là shell giả lập.\nGõ thử tiếng Việt có dấu để kiểm tra đóng khung UTF-8.\nGõ "help" để xem lệnh.',
  },
]

export class FakeShell {
  private buffer = ''
  private cols = 80
  private rows = 24
  private cwd = '/root'
  private closed = false

  constructor(private readonly write: (data: string) => void) {}

  /** Gửi MOTD và dấu nhắc đầu tiên. Gọi ngay sau khi client kết nối. */
  start(): void {
    this.write(
      [
        '',
        `${BOLD}${GREEN}Proxmox VE 9.2.1${RESET} ${DIM}(shell giả lập — chưa kết nối server thật)${RESET}`,
        '',
        `${DIM}Đây là môi trường giả lập của giai đoạn 0, dùng để kiểm chứng đường đi console.${RESET}`,
        `${DIM}Hãy thử gõ tiếng Việt có dấu, ví dụ: ${RESET}${CYAN}echo "Xin chào các bạn"${RESET}`,
        `${DIM}Gõ ${RESET}${CYAN}help${RESET}${DIM} để xem danh sách lệnh.${RESET}`,
        '',
      ].join('\r\n'),
    )
    this.prompt()
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
        // Giữ nhịp, không cần phản hồi. Proxmox thật cũng im lặng ở đây.
        break
    }
  }

  close(): void {
    this.closed = true
  }

  private prompt(): void {
    this.write(`${BOLD}${RED}${USER}@${HOSTNAME}${RESET}:${BOLD}${BLUE}${this.cwd}${RESET}# `)
  }

  private handleInput(data: string): void {
    // Duyệt theo code point chứ không theo mã đơn vị UTF-16, để emoji
    // (cặp surrogate) được coi là một ký tự khi xoá lùi.
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        this.write('\r\n')
        const line = this.buffer
        this.buffer = ''
        this.runCommand(line.trim())
        if (!this.closed) this.prompt()
        continue
      }

      // Backspace / Delete
      if (ch === '\x7f' || ch === '\b') {
        if (this.buffer.length > 0) {
          const chars = [...this.buffer]
          const removed = chars.pop() ?? ''
          this.buffer = chars.join('')
          // Ký tự rộng (emoji, chữ Hán) chiếm 2 ô trên terminal.
          const width = isWideChar(removed) ? 2 : 1
          this.write('\b \b'.repeat(width))
        }
        continue
      }

      // Ctrl+C
      if (ch === '\x03') {
        this.write(`${YELLOW}^C${RESET}\r\n`)
        this.buffer = ''
        this.prompt()
        continue
      }

      // Ctrl+L — xoá màn hình
      if (ch === '\x0c') {
        this.write(`${ESC}[2J${ESC}[H`)
        this.prompt()
        this.write(this.buffer)
        continue
      }

      // Ctrl+U — xoá cả dòng
      if (ch === '\x15') {
        const width = [...this.buffer].reduce((n, c) => n + (isWideChar(c) ? 2 : 1), 0)
        this.write('\b \b'.repeat(width))
        this.buffer = ''
        continue
      }

      // Bỏ qua các ký tự điều khiển còn lại (phím mũi tên gửi chuỗi escape).
      if (ch < ' ' && ch !== '\t') continue

      this.buffer += ch
      this.write(ch) // echo — đây chính là chỗ ký tự nhiều byte sẽ vỡ nếu đóng khung sai
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
            `${BOLD}Lệnh hỗ trợ trong shell giả lập:${RESET}`,
            `  ${CYAN}help${RESET}         danh sách này`,
            `  ${CYAN}ls${RESET}           liệt kê tệp`,
            `  ${CYAN}pwd${RESET}          thư mục hiện tại`,
            `  ${CYAN}cd <dir>${RESET}     đổi thư mục`,
            `  ${CYAN}cat <tệp>${RESET}    xem nội dung tệp`,
            `  ${CYAN}echo <chữ>${RESET}   in ra màn hình`,
            `  ${CYAN}pveversion${RESET}   phiên bản Proxmox`,
            `  ${CYAN}qm list${RESET}      danh sách máy ảo QEMU`,
            `  ${CYAN}pct list${RESET}     danh sách container LXC`,
            `  ${CYAN}size${RESET}         kích thước terminal hiện tại`,
            `  ${CYAN}uname -a${RESET}     thông tin kernel`,
            `  ${CYAN}whoami${RESET}       người dùng hiện tại`,
            `  ${CYAN}clear${RESET}        xoá màn hình`,
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
          `Linux ${HOSTNAME} 6.14.11-1-pve #1 SMP PREEMPT_DYNAMIC PVE 6.14.11-1 x86_64 GNU/Linux`,
        )
        break

      case 'whoami':
        this.println(USER)
        break

      case 'size':
        this.println(
          `${this.cols} cột × ${this.rows} dòng  ${DIM}(thử kéo giãn cửa sổ rồi gõ lại)${RESET}`,
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
        } else this.println(`${RED}qm: lệnh con không hỗ trợ trong shell giả lập${RESET}`)
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
        } else this.println(`${RED}pct: lệnh con không hỗ trợ trong shell giả lập${RESET}`)
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

/** Xấp xỉ độ rộng hiển thị. Đủ dùng để xoá lùi cho emoji và chữ Đông Á. */
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
