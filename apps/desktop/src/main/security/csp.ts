import { session } from 'electron'

/**
 * Content-Security-Policy cho renderer.
 *
 * Điểm đáng chú ý nhất là `connect-src`: nó **cố ý không** liệt kê host Proxmox.
 * Renderer không được phép nói chuyện trực tiếp với Proxmox — mọi request đi qua
 * IPC vào main, nơi có danh sách trắng endpoint và kho credential. Kết nối mạng
 * duy nhất renderer tự mở là tới relay console trên loopback.
 *
 * Nếu sau này thấy vi phạm CSP vì `connect-src`, đó là dấu hiệu có code renderer
 * đang cố đi tắt ra ngoài — hãy sửa code đó, đừng nới CSP.
 */
function buildPolicy(devServerUrl: string | undefined): string {
  const isDev = Boolean(devServerUrl)

  const connectSrc = ["'self'", 'ws://127.0.0.1:*']
  const scriptSrc = ["'self'"]

  if (isDev && devServerUrl) {
    // Vite HMR dùng websocket và nạp module qua http từ dev server.
    const origin = new URL(devServerUrl).origin
    connectSrc.push(origin, origin.replace(/^http/, 'ws'))
    scriptSrc.push(origin)
    // React Fast Refresh chèn script nội tuyến trong lúc dev.
    scriptSrc.push("'unsafe-inline'")
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // antd và xterm.js đều chèn thẻ <style> lúc chạy, nên buộc phải có 'unsafe-inline'
    // cho style. Đây là rủi ro thấp: nó không cho phép thực thi script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function installCsp(devServerUrl: string | undefined): void {
  const policy = buildPolicy(devServerUrl)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}
