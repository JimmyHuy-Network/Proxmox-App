import { HttpError, type HandlerTable, type MockHandler } from '../router.ts'
import { templateFor } from '../tasks/engine.ts'
import type { MockContext } from '../context.ts'
import type { MockBackupJob, MockStorage, MockVolume } from '../state/world.ts'

/**
 * Handlers storage / content / vzdump / backup jobs (giai đoạn 6).
 *
 * Tách khỏi `handlers/index.ts` vì khối này lớn và thay đổi độc lập với guest lifecycle.
 */

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function str(value: unknown): string {
  return String(value ?? '')
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function requireStorage(mock: MockContext, name: string): MockStorage {
  const storage = mock.world.storage(name)
  if (!storage) throw new HttpError(500, `storage '${name}' does not exist`)
  return storage
}

function volumeRow(v: MockVolume): Record<string, unknown> {
  return {
    volid: v.volid,
    format: v.format,
    size: v.size,
    content: v.content,
    ctime: v.ctime,
    ...(v.vmid !== undefined ? { vmid: v.vmid } : {}),
    ...(v.notes ? { notes: v.notes } : {}),
    ...(v.protected ? { protected: 1 } : {}),
    ...(v.encrypted ? { encrypted: 1 } : {}),
    ...(v.verification ? { verification: v.verification } : {}),
  }
}

function storageConfigRow(s: MockStorage): Record<string, unknown> {
  return {
    storage: s.storage,
    type: s.type,
    content: s.content,
    shared: s.shared ? 1 : 0,
    disable: s.enabled ? 0 : 1,
    ...(s.nodes ? { nodes: s.nodes } : {}),
    ...(s.config ?? {}),
  }
}

function storageStatusRow(s: MockStorage): Record<string, unknown> {
  return {
    storage: s.storage,
    type: s.type,
    content: s.content,
    shared: s.shared ? 1 : 0,
    enabled: s.enabled ? 1 : 0,
    active: s.enabled ? 1 : 0,
    total: s.total,
    used: s.used,
    avail: s.avail,
    used_fraction: s.total > 0 ? Number((s.used / s.total).toFixed(4)) : 0,
  }
}

function runTask(
  mock: MockContext,
  init: { node: string; type: string; id: string; user: string; onSuccess?: () => void },
): string {
  const steps = templateFor(init.type)
  return mock.tasks.startTask({ ...init, steps }).upid
}

function contentDir(content: string): string {
  switch (content) {
    case 'iso':
      return 'iso'
    case 'vztmpl':
      return 'vztmpl'
    case 'import':
      return 'import'
    case 'backup':
      return 'backup'
    case 'snippets':
      return 'snippets'
    case 'images':
    case 'rootdir':
      return ''
    default:
      return content
  }
}

function guessFormat(filename: string, content: string): string {
  const lower = filename.toLowerCase()
  if (content === 'iso' || lower.endsWith('.iso')) return 'iso'
  if (lower.endsWith('.tar.zst') || lower.endsWith('.tar.gz')) return 'tzst'
  if (lower.endsWith('.vma.zst')) return 'vma.zst'
  if (lower.endsWith('.qcow2')) return 'qcow2'
  return 'raw'
}

function findVolume(storage: MockStorage, volume: string): MockVolume | undefined {
  // volume path param có thể là `local:iso/x.iso` hoặc chỉ phần sau dấu `:`.
  return storage.contents.find(
    (v) => v.volid === volume || v.volid === `${storage.storage}:${volume}` || v.volid.endsWith(`/${volume}`),
  )
}

function jobRow(job: MockBackupJob): Record<string, unknown> {
  return {
    id: job.id,
    enabled: job.enabled ? 1 : 0,
    schedule: job.schedule,
    storage: job.storage,
    mode: job.mode,
    compress: job.compress,
    ...(job.comment ? { comment: job.comment } : {}),
    ...(job.all ? { all: 1 } : {}),
    ...(job.vmid ? { vmid: job.vmid } : {}),
    ...(job.node ? { node: job.node } : {}),
    ...(job['prune-backups'] ? { 'prune-backups': job['prune-backups'] } : {}),
    ...(job.mailnotification ? { mailnotification: job.mailnotification } : {}),
  }
}

export function registerStorageHandlers(on: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler) => void): void {
  // ── Cluster storage config ─────────────────────────────────────────────────

  on('GET', '/storage', ({ mock }) => mock.world.current.storages.map(storageConfigRow))

  on('GET', '/storage/{storage}', ({ input, mock }) => {
    const s = requireStorage(mock, str(input['storage']))
    return storageConfigRow(s)
  })

  on('POST', '/storage', ({ input, mock }) => {
    const storage = str(input['storage'])
    const type = str(input['type'])
    if (!storage) throw new HttpError(400, 'Parameter verification failed.', { storage: 'parameter is missing' })
    if (mock.world.storage(storage)) {
      throw new HttpError(500, `storage ID '${storage}' already defined`)
    }

    const content = str(input['content'] || 'images')
    const shared = truthy(input['shared']) || ['nfs', 'cifs', 'rbd', 'cephfs', 'iscsi', 'pbs'].includes(type)
    const config: Record<string, string | number | boolean> = {}
    for (const key of [
      'path',
      'server',
      'export',
      'share',
      'username',
      'password',
      'domain',
      'datastore',
      'pool',
      'monhost',
      'portal',
      'target',
      'vgname',
      'thinpool',
      'sparse',
      'fs-name',
      'namespace',
      'fingerprint',
    ]) {
      if (input[key] !== undefined) config[key] = input[key] as string | number | boolean
    }

    const created: MockStorage = {
      storage,
      type,
      content,
      shared,
      enabled: !truthy(input['disable']),
      total: 100 * 1024 ** 3,
      used: 0,
      avail: 100 * 1024 ** 3,
      contents: [],
      ...(input['nodes'] !== undefined ? { nodes: str(input['nodes']) } : {}),
      ...(Object.keys(config).length > 0 ? { config } : {}),
    }
    mock.world.addStorage(created)
    return storageConfigRow(created)
  })

  on('PUT', '/storage/{storage}', ({ input, mock }) => {
    const s = requireStorage(mock, str(input['storage']))
    if (input['content'] !== undefined) s.content = str(input['content'])
    if (input['nodes'] !== undefined) s.nodes = str(input['nodes'])
    if (input['disable'] !== undefined) s.enabled = !truthy(input['disable'])
    if (input['shared'] !== undefined) s.shared = truthy(input['shared'])
    s.config ??= {}
    for (const [key, value] of Object.entries(input)) {
      if (['storage', 'type', 'content', 'nodes', 'disable', 'shared', 'digest'].includes(key)) continue
      if (value !== undefined) s.config[key] = value as string | number | boolean
    }
    return null
  })

  on('DELETE', '/storage/{storage}', ({ input, mock }) => {
    const name = str(input['storage'])
    if (!mock.world.removeStorage(name)) throw new HttpError(500, `storage '${name}' does not exist`)
    return null
  })

  // ── Node storage status / content ──────────────────────────────────────────

  on('GET', '/nodes/{node}/storage', ({ mock }) => mock.world.current.storages.map(storageStatusRow))

  on('GET', '/nodes/{node}/storage/{storage}', ({ input, mock }) => {
    requireStorage(mock, str(input['storage']))
    return [{ subdir: 'content' }, { subdir: 'status' }, { subdir: 'rrd' }, { subdir: 'rrddata' }]
  })

  on('GET', '/nodes/{node}/storage/{storage}/status', ({ input, mock }) => {
    return storageStatusRow(requireStorage(mock, str(input['storage'])))
  })

  on('GET', '/nodes/{node}/storage/{storage}/content', ({ input, mock }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const content = input['content']
    return storage.contents
      .filter((v) => (typeof content === 'string' ? v.content === content : true))
      .map(volumeRow)
  })

  on('POST', '/nodes/{node}/storage/{storage}/content', ({ input, mock }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const vmid = num(input['vmid'])
    const filename = str(input['filename'])
    // size: kilobyte, optional suffix M/G (schema pattern `\d+[MG]?`).
    const sizeBytes = (() => {
      const raw = str(input['size'] ?? '1024M')
      const m = /^(\d+)([MG])?$/i.exec(raw)
      if (!m) return 1024 ** 3
      const n = Number(m[1])
      const u = (m[2] ?? 'K').toUpperCase()
      if (u === 'G') return n * 1024 ** 3
      if (u === 'M') return n * 1024 ** 2
      return n * 1024
    })()
    const format = str(input['format'] || 'raw')
    // filename ở đây là tên volume (vd. vm-100-disk-1), không phải size.
    const diskName = filename || (Number.isFinite(vmid) ? `vm-${vmid}-disk-0` : `vol-${Date.now()}`)
    const volid = `${storage.storage}:${diskName}`
    if (storage.contents.some((v) => v.volid === volid)) {
      throw new HttpError(500, `volume '${volid}' already exists`)
    }

    storage.contents.push({
      volid,
      format,
      size: sizeBytes,
      content: storage.content.includes('images') ? 'images' : 'rootdir',
      ...(Number.isFinite(vmid) && vmid > 0 ? { vmid } : {}),
      ctime: Math.floor(Date.now() / 1000),
    })
    mock.world.adjustStorageUsage(storage.storage, sizeBytes)
    // Schema returns volume identifier (không phải UPID).
    return volid
  })

  on('GET', '/nodes/{node}/storage/{storage}/content/{volume}', ({ input, mock, reply, query }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const volumeKey = str(input['volume'])
    const vol =
      findVolume(storage, volumeKey) ??
      storage.contents[0] ?? {
        volid: `${storage.storage}:${volumeKey}`,
        format: 'raw',
        size: 1024,
        content: 'images',
        ctime: Math.floor(Date.now() / 1000),
      }

    // Desktop download stream: ?download=1 → trả bytes giả (giới hạn 1 MiB trong mock).
    if (truthy(query['download'] ?? input['download'])) {
      const size = Math.min(vol.size, 1024 * 1024)
      const buf = Buffer.alloc(size, 0x42)
      void reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', String(size))
        .header('Content-Disposition', `attachment; filename="${vol.volid.split('/').pop()}"`)
      reply.send(buf)
      return null
    }

    return volumeRow(vol)
  })

  on('PUT', '/nodes/{node}/storage/{storage}/content/{volume}', ({ input, mock }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const vol = findVolume(storage, str(input['volume']))
    if (!vol) throw new HttpError(500, 'volume does not exist')
    if (input['notes'] !== undefined) vol.notes = str(input['notes'])
    if (input['protected'] !== undefined) vol.protected = truthy(input['protected'])
    return null
  })

  on('DELETE', '/nodes/{node}/storage/{storage}/content/{volume}', ({ input, mock, auth }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const volume = str(input['volume'])
    const vol = findVolume(storage, volume)
    if (!vol) throw new HttpError(500, 'volume does not exist')
    if (vol.protected) throw new HttpError(500, 'volume is protected')

    const node = str(input['node'])
    return runTask(mock, {
      node,
      type: 'imgdel',
      id: volume,
      user: auth.username,
      onSuccess: () => {
        storage.contents = storage.contents.filter((v) => v.volid !== vol.volid)
        mock.world.adjustStorageUsage(storage.storage, -vol.size)
      },
    })
  })

  // ── Upload / download-url ──────────────────────────────────────────────────

  on('POST', '/nodes/{node}/storage/{storage}/upload', ({ input, mock, auth }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const content = str(input['content'])
    let filename = str(input['filename'])
    // Multipart: filename có thể là Buffer (nội dung file) — tên thật nằm ở __uploadFilename.
    if (input['__uploadFilename']) filename = str(input['__uploadFilename'])
    if (!filename || filename.includes('/') || filename.includes('\\')) {
      throw new HttpError(400, 'Parameter verification failed.', { filename: 'invalid filename' })
    }
    if (!storage.content.split(',').includes(content) && content !== 'import') {
      throw new HttpError(500, `storage '${storage.storage}' does not support content type '${content}'`)
    }

    const size =
      typeof input['__uploadSize'] === 'number'
        ? (input['__uploadSize'] as number)
        : typeof input['size'] === 'number' || typeof input['size'] === 'string'
          ? num(input['size'])
          : 1024 * 1024

    const dir = contentDir(content)
    const volid = dir ? `${storage.storage}:${dir}/${filename}` : `${storage.storage}:${filename}`
    if (storage.contents.some((v) => v.volid === volid)) {
      throw new HttpError(500, `volume '${volid}' already exists`)
    }

    const node = str(input['node'])
    return runTask(mock, {
      node,
      type: 'imgcopy',
      id: filename,
      user: auth.username,
      onSuccess: () => {
        storage.contents.push({
          volid,
          format: guessFormat(filename, content),
          size: Number.isFinite(size) ? size : 0,
          content: content === 'import' ? 'import' : content,
          ctime: Math.floor(Date.now() / 1000),
        })
        mock.world.adjustStorageUsage(storage.storage, Number.isFinite(size) ? size : 0)
      },
    })
  })

  on('POST', '/nodes/{node}/storage/{storage}/download-url', ({ input, mock, auth }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const content = str(input['content'])
    const filename = str(input['filename'])
    const url = str(input['url'])
    if (!filename) throw new HttpError(400, 'Parameter verification failed.', { filename: 'parameter is missing' })
    if (!/^https?:\/\//.test(url)) {
      throw new HttpError(400, 'Parameter verification failed.', { url: 'invalid url' })
    }

    const dir = contentDir(content)
    const volid = `${storage.storage}:${dir}/${filename}`
    const node = str(input['node'])
    // Giả lập tải ~8 MB.
    const size = 8 * 1024 * 1024

    return runTask(mock, {
      node,
      type: 'download',
      id: filename,
      user: auth.username,
      onSuccess: () => {
        if (storage.contents.some((v) => v.volid === volid)) return
        storage.contents.push({
          volid,
          format: guessFormat(filename, content),
          size,
          content,
          ctime: Math.floor(Date.now() / 1000),
          notes: `downloaded from ${url}`,
        })
        mock.world.adjustStorageUsage(storage.storage, size)
      },
    })
  })

  // ── Prune backups ─────────────────────────────────────────────────────────

  on('GET', '/nodes/{node}/storage/{storage}/prunebackups', ({ input, mock }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const backups = storage.contents.filter((v) => v.content === 'backup')
    // Dry-run: liệt kê những bản sẽ bị xoá nếu keep-last=1 (giữ mới nhất mỗi vmid).
    const byVmid = new Map<number | 'none', MockVolume[]>()
    for (const b of backups) {
      const key = b.vmid ?? 'none'
      const list = byVmid.get(key) ?? []
      list.push(b)
      byVmid.set(key, list)
    }
    const prune: Record<string, unknown>[] = []
    for (const list of byVmid.values()) {
      list.sort((a, b) => b.ctime - a.ctime)
      for (const old of list.slice(1)) {
        prune.push({ volid: old.volid, ctime: old.ctime, ...(old.vmid !== undefined ? { vmid: old.vmid } : {}) })
      }
    }
    return prune
  })

  on('DELETE', '/nodes/{node}/storage/{storage}/prunebackups', ({ input, mock, auth }) => {
    const storage = requireStorage(mock, str(input['storage']))
    const node = str(input['node'])
    return runTask(mock, {
      node,
      type: 'imgdel',
      id: storage.storage,
      user: auth.username,
      onSuccess: () => {
        const backups = storage.contents.filter((v) => v.content === 'backup')
        const byVmid = new Map<number | 'none', MockVolume[]>()
        for (const b of backups) {
          const key = b.vmid ?? 'none'
          const list = byVmid.get(key) ?? []
          list.push(b)
          byVmid.set(key, list)
        }
        const keep = new Set<string>()
        for (const list of byVmid.values()) {
          list.sort((a, b) => b.ctime - a.ctime)
          if (list[0]) keep.add(list[0].volid)
        }
        const removed = storage.contents.filter((v) => v.content === 'backup' && !keep.has(v.volid))
        storage.contents = storage.contents.filter((v) => v.content !== 'backup' || keep.has(v.volid))
        for (const r of removed) mock.world.adjustStorageUsage(storage.storage, -r.size)
      },
    })
  })

  // ── vzdump ────────────────────────────────────────────────────────────────

  on('POST', '/nodes/{node}/vzdump', ({ input, mock, auth }) => {
    const node = str(input['node'])
    const storageName = str(input['storage'] || 'local')
    const storage = requireStorage(mock, storageName)
    if (!storage.content.split(',').includes('backup')) {
      throw new HttpError(500, `storage '${storageName}' does not support backups`)
    }

    const all = truthy(input['all'])
    const vmids = all
      ? mock.world.current.guests.filter((g) => g.node === node).map((g) => g.vmid)
      : str(input['vmid'] || '')
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)

    if (vmids.length === 0) throw new HttpError(400, 'Parameter verification failed.', { vmid: 'parameter is missing' })

    const compress = str(input['compress'] || 'zstd')
    const ext = compress === 'zstd' ? 'vma.zst' : compress === 'gzip' ? 'vma.gz' : 'vma'

    return runTask(mock, {
      node,
      type: 'vzdump',
      id: String(vmids[0]),
      user: auth.username,
      onSuccess: () => {
        const now = new Date()
        const stamp = now.toISOString().replace(/[-:]/g, '_').replace(/\.\d+Z$/, '').replace('T', '-')
        for (const vmid of vmids) {
          const guest = mock.world.guest(vmid)
          const kind = guest?.type === 'lxc' ? 'lxc' : 'qemu'
          const filename = `vzdump-${kind}-${vmid}-${stamp}.${ext}`
          const volid = `${storage.storage}:backup/${filename}`
          if (storage.contents.some((v) => v.volid === volid)) continue
          const size = 512 * 1024 * 1024
          storage.contents.push({
            volid,
            format: ext,
            size,
            content: 'backup',
            vmid,
            ctime: Math.floor(Date.now() / 1000),
          })
          mock.world.adjustStorageUsage(storage.storage, size)
        }
      },
    })
  })

  on('GET', '/nodes/{node}/vzdump/defaults', () => ({
    mode: 'snapshot',
    compress: 'zstd',
    storage: 'local',
    'prune-backups': 'keep-last=3',
  }))

  on('GET', '/nodes/{node}/vzdump/extractconfig', ({ input }) => {
    const volume = str(input['volume'])
    // Đủ để restore wizard hiển thị — không phải config thật.
    return `# extracted from ${volume}\ncores: 2\nmemory: 2048\nname: restored-guest\nostype: l26\n`
  })

  // ── Backup jobs ───────────────────────────────────────────────────────────

  on('GET', '/cluster/backup', ({ mock }) => mock.world.backupJobs().map(jobRow))

  on('POST', '/cluster/backup', ({ input, mock }) => {
    const id = str(input['id'] || `backup-${Date.now().toString(36)}`)
    if (mock.world.backupJobs().some((j) => j.id === id)) {
      throw new HttpError(500, `backup job '${id}' already exists`)
    }
    const job: MockBackupJob = {
      id,
      enabled: input['enabled'] === undefined ? true : truthy(input['enabled']),
      schedule: str(input['schedule'] || 'sun 01:00'),
      storage: str(input['storage'] || 'local'),
      mode: str(input['mode'] || 'snapshot'),
      compress: str(input['compress'] || 'zstd'),
      ...(input['comment'] !== undefined ? { comment: str(input['comment']) } : {}),
      ...(truthy(input['all']) ? { all: true } : {}),
      ...(input['vmid'] !== undefined ? { vmid: str(input['vmid']) } : {}),
      ...(input['node'] !== undefined ? { node: str(input['node']) } : {}),
      ...(input['prune-backups'] !== undefined ? { 'prune-backups': str(input['prune-backups']) } : {}),
    }
    mock.world.backupJobs().push(job)
    return null
  })

  on('GET', '/cluster/backup/{id}', ({ input, mock }) => {
    const id = str(input['id'])
    const job =
      mock.world.backupJobs().find((j) => j.id === id) ??
      mock.world.backupJobs()[0] ?? {
        id,
        enabled: true,
        schedule: '02:00',
        storage: 'local',
        mode: 'snapshot',
        compress: 'zstd',
      }
    return jobRow(job)
  })

  on('PUT', '/cluster/backup/{id}', ({ input, mock }) => {
    const job = mock.world.backupJobs().find((j) => j.id === str(input['id']))
    if (!job) throw new HttpError(500, 'backup job does not exist')
    if (input['enabled'] !== undefined) job.enabled = truthy(input['enabled'])
    if (input['schedule'] !== undefined) job.schedule = str(input['schedule'])
    if (input['storage'] !== undefined) job.storage = str(input['storage'])
    if (input['mode'] !== undefined) job.mode = str(input['mode'])
    if (input['compress'] !== undefined) job.compress = str(input['compress'])
    if (input['comment'] !== undefined) job.comment = str(input['comment'])
    if (input['all'] !== undefined) job.all = truthy(input['all'])
    if (input['vmid'] !== undefined) job.vmid = str(input['vmid'])
    if (input['node'] !== undefined) job.node = str(input['node'])
    if (input['prune-backups'] !== undefined) job['prune-backups'] = str(input['prune-backups'])
    return null
  })

  on('DELETE', '/cluster/backup/{id}', ({ input, mock }) => {
    const id = str(input['id'])
    const jobs = mock.world.backupJobs()
    const idx = jobs.findIndex((j) => j.id === id)
    if (idx < 0) throw new HttpError(500, 'backup job does not exist')
    jobs.splice(idx, 1)
    return null
  })

  on('GET', '/cluster/backup-info/not-backed-up', ({ mock }) => {
    const covered = new Set<number>()
    for (const job of mock.world.backupJobs()) {
      if (!job.enabled) continue
      if (job.all) {
        for (const g of mock.world.current.guests) covered.add(g.vmid)
      } else if (job.vmid) {
        for (const id of job.vmid.split(',')) covered.add(Number(id.trim()))
      }
    }
    return mock.world.current.guests
      .filter((g) => !covered.has(g.vmid))
      .map((g) => ({ vmid: g.vmid, type: g.type, name: g.name, node: g.node }))
  })

  // ── Scan helpers (add-storage wizard) ──────────────────────────────────────

  on('GET', '/nodes/{node}/scan/nfs', () => [
    { path: '/export/pve', options: 'rw,sync,no_root_squash' },
    { path: '/export/iso', options: 'ro,sync' },
  ])

  on('GET', '/nodes/{node}/scan/cifs', () => [
    { share: 'backup', description: 'Lab backup share' },
    { share: 'iso', description: 'ISO library' },
  ])

  on('GET', '/nodes/{node}/scan/lvm', () => [{ vg: 'pve', size: 500 * 1024 ** 3, free: 200 * 1024 ** 3 }])

  on('GET', '/nodes/{node}/scan/lvmthin', () => [
    { lv: 'data', vg: 'pve', size: 400 * 1024 ** 3, used: 180 * 1024 ** 3 },
  ])

  on('GET', '/nodes/{node}/scan/zfs', () => [
    { pool: 'rpool', size: 500 * 1024 ** 3, free: 300 * 1024 ** 3 },
  ])

  on('GET', '/nodes/{node}/scan/pbs', () => [
    { store: 'store1', comment: 'Primary PBS datastore' },
    { store: 'store2', comment: 'Archive' },
  ])

  on('GET', '/nodes/{node}/scan/iscsi', () => [
    { target: 'iqn.2024-01.local.lab:storage', portal: '192.168.1.70:3260' },
  ])

  // ── PBS file-restore (duyệt + tải file) ─────────────────────────────────────

  on('GET', '/nodes/{node}/storage/{storage}/file-restore/list', ({ input, mock }) => {
    requireStorage(mock, str(input['storage']))
    const volume = str(input['volume'] || '')
    if (!volume) throw new HttpError(400, 'Parameter verification failed.', { volume: 'parameter is missing' })

    const filepath = str(input['filepath'] || '/')
    const decoded =
      filepath === '/' || filepath === ''
        ? '/'
        : (() => {
            try {
              return Buffer.from(filepath, 'base64').toString('utf8') || filepath
            } catch {
              return filepath
            }
          })()

    if (decoded === '/' || decoded === '') {
      return [
        { filepath: Buffer.from('/etc').toString('base64'), text: 'etc', type: 'd', size: 0, leaf: 0 },
        { filepath: Buffer.from('/home').toString('base64'), text: 'home', type: 'd', size: 0, leaf: 0 },
        {
          filepath: Buffer.from('/var/log/syslog').toString('base64'),
          text: 'syslog',
          type: 'f',
          size: 4096,
          leaf: 1,
        },
      ]
    }
    if (decoded === '/etc' || decoded.endsWith('/etc')) {
      return [
        {
          filepath: Buffer.from('/etc/passwd').toString('base64'),
          text: 'passwd',
          type: 'f',
          size: 2048,
          leaf: 1,
        },
        {
          filepath: Buffer.from('/etc/hostname').toString('base64'),
          text: 'hostname',
          type: 'f',
          size: 32,
          leaf: 1,
        },
      ]
    }
    return []
  })

  on('GET', '/nodes/{node}/storage/{storage}/file-restore/download', ({ input, mock, reply, query }) => {
    requireStorage(mock, str(input['storage']))
    const volume = str(input['volume'] || query['volume'] || '')
    const filepath = str(input['filepath'] || query['filepath'] || '')
    if (!volume) throw new HttpError(400, 'Parameter verification failed.', { volume: 'parameter is missing' })
    if (!filepath) throw new HttpError(400, 'Parameter verification failed.', { filepath: 'parameter is missing' })

    let name = 'restored.bin'
    try {
      const decoded = Buffer.from(filepath, 'base64').toString('utf8')
      name = decoded.split('/').filter(Boolean).pop() || name
    } catch {
      // giữ tên mặc định
    }
    const size = 2048
    const buf = Buffer.alloc(size, 0x50)
    buf.write(`pbs-file-restore:${volume}:${name}\n`, 0, 'utf8')
    void reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', String(size))
      .header('Content-Disposition', `attachment; filename="${name}"`)
    reply.send(buf)
    return null
  })

  on('GET', '/nodes/{node}/storage/{storage}/identity', ({ input, mock }) => {
    const s = requireStorage(mock, str(input['storage']))
    return {
      server: s.config?.['server'] ?? 'pbs.local',
      datastore: s.config?.['datastore'] ?? 'store1',
      ...(s.type !== 'pbs' ? { comment: 'mock identity stub' } : {}),
    }
  })
}

/** Gắn các handler storage vào bảng chung. */
export function applyStorageHandlers(handlers: HandlerTable): void {
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[`${method} ${path}`] = handler
  }
  registerStorageHandlers(on)
}
