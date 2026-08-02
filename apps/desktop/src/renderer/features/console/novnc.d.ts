declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: { credentials?: { password?: string }; wsProtocols?: string[] },
    )
    scaleViewport: boolean
    resizeSession: boolean
    background: string
    viewOnly: boolean
    disconnect(): void
    sendCtrlAltDel(): void
    focus(): void
    blur(): void
  }
}
