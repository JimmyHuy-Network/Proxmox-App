import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import selfsigned from 'selfsigned'

const here = dirname(fileURLToPath(import.meta.url))
const tlsDir = join(here, '..', 'tls')

export interface TlsMaterial {
  key: string
  cert: string
}

/**
 * Sinh (hoặc dùng lại) chứng chỉ tự ký.
 *
 * Cố ý dùng cert tự ký thay vì chạy HTTP trần: Proxmox thật cũng vậy, nên nhờ đó
 * luồng trust-on-first-use ở phía client được luyện thật chứ không phải chỉ tồn tại
 * trên giấy. Xoá thư mục `tls/` rồi khởi động lại là mô phỏng được tình huống
 * chứng chỉ đổi vân tay, dùng để kiểm phần cảnh báo bảo mật.
 */
export function ensureTls(): TlsMaterial {
  const keyPath = join(tlsDir, 'mock-key.pem')
  const certPath = join(tlsDir, 'mock-cert.pem')

  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') }
  }

  const pems = selfsigned.generate([{ name: 'commonName', value: 'pve-mock.local' }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 2, value: 'pve-mock.local' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  })

  mkdirSync(tlsDir, { recursive: true })
  writeFileSync(keyPath, pems.private, 'utf8')
  writeFileSync(certPath, pems.cert, 'utf8')

  return { key: pems.private, cert: pems.cert }
}
