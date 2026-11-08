import { Agent, type AgentOptions, type RequestOptions } from 'node:https'
import { connect, type ConnectionOptions } from 'node:tls'
import type { Duplex } from 'node:stream'

export interface TlsPolicy {
  pinnedFingerprint?: string
  allowSelfSigned?: boolean
}

/** Release a socket to HTTP only after TLS and certificate pin verification.
 * Checking on WebSocket `open` is too late: Upgrade already contains credentials.
 */
class PinnedAgent extends Agent {
  private readonly fingerprint: string

  constructor(fingerprint: string, options: AgentOptions) {
    super({ ...options, rejectUnauthorized: false, maxCachedSessions: 0 })
    this.fingerprint = fingerprint.replace(/:/g, '').toUpperCase()
  }

  override createConnection(
    options: RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): undefined {
    if (!callback) throw new Error('Pinned TLS requires an asynchronous connection callback')
    const socket = connect({ ...options, rejectUnauthorized: false } as ConnectionOptions)
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      callback(error, socket)
    }
    socket.once('error', fail)
    socket.setTimeout(10_000, () => fail(new Error('TLS handshake timed out')))
    socket.once('secureConnect', () => {
      const actual = socket.getPeerCertificate().fingerprint256?.replace(/:/g, '').toUpperCase()
      if (!actual || actual !== this.fingerprint) {
        fail(new Error('PVE_CERT_FINGERPRINT_MISMATCH'))
        return
      }
      if (settled) return
      settled = true
      socket.setTimeout(0)
      socket.removeListener('error', fail)
      callback(null, socket)
    })
    // Returning the socket here would let HTTP write before the pin is checked.
    return undefined
  }
}

export function createTlsAgent(policy: TlsPolicy, options: AgentOptions = {}): Agent {
  if (policy.pinnedFingerprint) return new PinnedAgent(policy.pinnedFingerprint, options)
  return new Agent({ ...options, rejectUnauthorized: !policy.allowSelfSigned })
}
