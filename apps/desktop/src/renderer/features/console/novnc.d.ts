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
    /** 0–9; cao hơn = chất lượng cao hơn (băng thông lớn hơn). */
    qualityLevel: number
    /** 0–9; cao hơn = nén mạnh hơn. */
    compressionLevel: number
    clipViewport: boolean
    disconnect(): void
    sendCtrlAltDel(): void
    focus(): void
    blur(): void
    /** Dán clipboard local vào guest (Extended Clipboard). */
    clipboardPasteFrom(text: string): void
  }
}
