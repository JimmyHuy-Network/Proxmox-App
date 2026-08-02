import { HttpError, type HandlerTable, type MockHandler } from '../router.ts'
import {
  capsFromPrivs,
  computeEffectivePrivs,
  type MockApiToken,
  type MockGroup,
  type MockRealm,
  type MockRole,
  type MockTfaEntry,
} from '../state/phase8.ts'
import type { MockContext } from '../context.ts'

/**
 * Access đầy đủ (GĐ 8): users/groups/roles/ACL/token/realms/TFA/pools + permissions/cap.
 */

function str(value: unknown): string {
  return String(value ?? '')
}

function userGroups(mock: MockContext, userid: string): string[] {
  const fromUser = mock.world.current.users.find((u) => u.userid === userid)?.groups
  const fromGroups = mock.phase8.groups.filter((g) =>
    (g.users ?? '')
      .split(',')
      .map((x) => x.trim())
      .includes(userid),
  )
  const set = new Set<string>([
    ...(fromUser ? fromUser.split(',').map((g) => g.trim()).filter(Boolean) : []),
    ...fromGroups.map((g) => g.groupid),
  ])
  return [...set]
}

function requirePriv(mock: MockContext, username: string, path: string, priv: string): void {
  const privs = computeEffectivePrivs(
    mock.acls,
    mock.phase8.roles,
    username,
    path,
    userGroups(mock, username),
  )
  if (!privs.has(priv) && username !== 'root@pam') {
    throw new HttpError(403, `Permission check failed (${priv}, ${path})`)
  }
}

function register(on: (m: 'GET' | 'POST' | 'PUT' | 'DELETE', p: string, h: MockHandler) => void): void {
  // ── Domains / realms ───────────────────────────────────────────────────────
  on('GET', '/access/domains', ({ mock }) =>
    mock.phase8.realms.map((r) => ({
      realm: r.realm,
      type: r.type,
      ...(r.comment ? { comment: r.comment } : {}),
    })),
  )

  on('POST', '/access/domains', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Sys.Modify')
    const realm = str(input['realm'])
    const type = str(input['type'] || 'pve')
    if (!realm) throw new HttpError(400, 'realm required')
    if (mock.phase8.realms.some((r) => r.realm === realm)) {
      throw new HttpError(400, `realm '${realm}' already exists`)
    }
    const entry: MockRealm = { realm, type, comment: str(input['comment'] || '') || undefined }
    for (const [k, v] of Object.entries(input)) {
      if (['realm', 'type', 'comment'].includes(k)) continue
      entry[k] = v
    }
    mock.phase8.realms.push(entry)
    return null
  })

  on('GET', '/access/domains/{realm}', ({ input, mock }) => {
    const realm = str(input['realm'])
    const row = mock.phase8.realms.find((r) => r.realm === realm)
    if (!row) throw new HttpError(500, `realm '${realm}' does not exist`)
    return { ...row }
  })

  on('PUT', '/access/domains/{realm}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Sys.Modify')
    const realm = str(input['realm'])
    const row = mock.phase8.realms.find((r) => r.realm === realm)
    if (!row) throw new HttpError(500, `realm '${realm}' does not exist`)
    for (const [k, v] of Object.entries(input)) {
      if (k === 'realm') continue
      if (v === undefined || v === null || v === '') {
        delete row[k]
      } else {
        row[k] = v
      }
    }
    return null
  })

  on('DELETE', '/access/domains/{realm}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Sys.Modify')
    const realm = str(input['realm'])
    if (realm === 'pam' || realm === 'pve') {
      throw new HttpError(400, 'cannot delete built-in realm')
    }
    mock.phase8.realms = mock.phase8.realms.filter((r) => r.realm !== realm)
    return null
  })

  on('POST', '/access/domains/{realm}/sync', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Sys.Modify')
    const realm = str(input['realm'])
    if (!mock.phase8.realms.some((r) => r.realm === realm)) {
      throw new HttpError(500, `realm '${realm}' does not exist`)
    }
    // Sync giả — không đổi user; trả null như PVE khi dry-run off đơn giản.
    return null
  })

  // ── Users ──────────────────────────────────────────────────────────────────
  on('GET', '/access/users', ({ mock }) =>
    mock.world.current.users.map((u) => ({
      userid: u.userid,
      enable: u.enable ? 1 : 0,
      realm_type: u.realm,
      ...(u.comment ? { comment: u.comment } : {}),
      ...(u.groups ? { groups: u.groups } : {}),
    })),
  )

  on('POST', '/access/users', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'User.Modify')
    const userid = str(input['userid'])
    if (!userid.includes('@')) throw new HttpError(400, 'userid must be user@realm')
    if (mock.world.current.users.some((u) => u.userid === userid)) {
      throw new HttpError(400, 'user already exists')
    }
    const [name, realm] = userid.split('@')
    void name
    mock.world.current.users.push({
      userid,
      enable: input['enable'] === 0 || input['enable'] === '0' ? false : true,
      realm: realm ?? 'pve',
      comment: str(input['comment'] || '') || undefined,
      groups: str(input['groups'] || '') || undefined,
    })
    return null
  })

  on('GET', '/access/users/{userid}', ({ input, mock }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const u = mock.world.current.users.find((x) => x.userid === userid)
    if (!u) throw new HttpError(500, `user '${userid}' does not exist`)
    return {
      userid: u.userid,
      enable: u.enable ? 1 : 0,
      ...(u.comment ? { comment: u.comment } : {}),
      ...(u.groups ? { groups: u.groups } : {}),
    }
  })

  on('PUT', '/access/users/{userid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'User.Modify')
    const userid = decodeURIComponent(str(input['userid']))
    const u = mock.world.current.users.find((x) => x.userid === userid)
    if (!u) throw new HttpError(500, `user '${userid}' does not exist`)
    if (input['comment'] !== undefined) u.comment = str(input['comment']) || undefined
    if (input['groups'] !== undefined) u.groups = str(input['groups']) || undefined
    if (input['enable'] !== undefined) {
      u.enable = !(input['enable'] === 0 || input['enable'] === '0' || input['enable'] === false)
    }
    return null
  })

  on('DELETE', '/access/users/{userid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'User.Modify')
    const userid = decodeURIComponent(str(input['userid']))
    if (userid === 'root@pam') throw new HttpError(400, 'cannot delete root@pam')
    mock.world.current.users = mock.world.current.users.filter((u) => u.userid !== userid)
    mock.phase8.tokens = mock.phase8.tokens.filter((t) => t.userid !== userid)
    mock.phase8.tfa = mock.phase8.tfa.filter((t) => t.userid !== userid)
    mock.acls = mock.acls.filter((a) => !(a.type === 'user' && a.ugid === userid))
    return null
  })

  on('PUT', '/access/password', ({ input, mock, auth }) => {
    // Đổi mật khẩu — mock chấp nhận mọi mật khẩu trừ 'sai'; không lưu.
    const userid = str(input['userid'] || auth.username)
    if (userid !== auth.username) {
      requirePriv(mock, auth.username, '/access', 'User.Modify')
    }
    if (str(input['password']) === 'sai') throw new HttpError(400, 'invalid password')
    return null
  })

  // ── Groups ─────────────────────────────────────────────────────────────────
  on('GET', '/access/groups', ({ mock }) =>
    mock.phase8.groups.map((g) => ({
      groupid: g.groupid,
      ...(g.comment ? { comment: g.comment } : {}),
      ...(g.users ? { users: g.users } : {}),
    })),
  )

  on('POST', '/access/groups', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Group.Allocate')
    const groupid = str(input['groupid'])
    if (!groupid) throw new HttpError(400, 'groupid required')
    if (mock.phase8.groups.some((g) => g.groupid === groupid)) {
      throw new HttpError(400, 'group already exists')
    }
    const g: MockGroup = {
      groupid,
      comment: str(input['comment'] || '') || undefined,
    }
    mock.phase8.groups.push(g)
    return null
  })

  on('GET', '/access/groups/{groupid}', ({ input, mock }) => {
    const groupid = str(input['groupid'])
    const g = mock.phase8.groups.find((x) => x.groupid === groupid)
    if (!g) throw new HttpError(500, `group '${groupid}' does not exist`)
    return { ...g }
  })

  on('PUT', '/access/groups/{groupid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Group.Allocate')
    const groupid = str(input['groupid'])
    const g = mock.phase8.groups.find((x) => x.groupid === groupid)
    if (!g) throw new HttpError(500, `group '${groupid}' does not exist`)
    if (input['comment'] !== undefined) g.comment = str(input['comment']) || undefined
    return null
  })

  on('DELETE', '/access/groups/{groupid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Group.Allocate')
    const groupid = str(input['groupid'])
    mock.phase8.groups = mock.phase8.groups.filter((g) => g.groupid !== groupid)
    mock.acls = mock.acls.filter((a) => !(a.type === 'group' && a.ugid === groupid))
    return null
  })

  // ── Roles ──────────────────────────────────────────────────────────────────
  on('GET', '/access/roles', ({ mock }) =>
    mock.phase8.roles.map((r) => ({
      roleid: r.roleid,
      privs: r.privs,
      special: r.special ? 1 : 0,
    })),
  )

  on('POST', '/access/roles', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Sys.Modify')
    const roleid = str(input['roleid'])
    if (!roleid) throw new HttpError(400, 'roleid required')
    if (mock.phase8.roles.some((r) => r.roleid === roleid)) {
      throw new HttpError(400, 'role already exists')
    }
    const role: MockRole = { roleid, privs: str(input['privs'] || ''), special: false }
    mock.phase8.roles.push(role)
    return null
  })

  on('GET', '/access/roles/{roleid}', ({ input, mock }) => {
    const roleid = str(input['roleid'])
    const r = mock.phase8.roles.find((x) => x.roleid === roleid)
    if (!r) throw new HttpError(500, `role '${roleid}' does not exist`)
    return { ...r, special: r.special ? 1 : 0 }
  })

  on('PUT', '/access/roles/{roleid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Sys.Modify')
    const roleid = str(input['roleid'])
    const r = mock.phase8.roles.find((x) => x.roleid === roleid)
    if (!r) throw new HttpError(500, `role '${roleid}' does not exist`)
    if (r.special) throw new HttpError(400, 'cannot modify special role')
    if (input['privs'] !== undefined) r.privs = str(input['privs'])
    return null
  })

  on('DELETE', '/access/roles/{roleid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Sys.Modify')
    const roleid = str(input['roleid'])
    const r = mock.phase8.roles.find((x) => x.roleid === roleid)
    if (!r) throw new HttpError(500, `role '${roleid}' does not exist`)
    if (r.special) throw new HttpError(400, 'cannot delete special role')
    mock.phase8.roles = mock.phase8.roles.filter((x) => x.roleid !== roleid)
    return null
  })

  // ── ACL ────────────────────────────────────────────────────────────────────
  on('GET', '/access/acl', ({ mock }) =>
    mock.acls.map((a) => ({
      path: a.path,
      ugid: a.ugid,
      type: a.type,
      roleid: a.roleid,
      ...(a.propagate !== undefined ? { propagate: a.propagate } : {}),
    })),
  )

  on('PUT', '/access/acl', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/access', 'Permissions.Modify')
    const path = str(input['path'] ?? '')
    if (!path) throw new HttpError(400, 'Parameter verification failed. (path: property is missing)')
    const roles = str(input['roles'] ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
    if (roles.length === 0) {
      throw new HttpError(400, 'Parameter verification failed. (roles: property is missing)')
    }
    const users = str(input['users'] ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
    const groups = str(input['groups'] ?? '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
    const tokens = str(input['tokens'] ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (users.length + groups.length + tokens.length === 0) {
      throw new HttpError(400, 'no users/groups/tokens specified')
    }
    const del = input['delete'] === 1 || input['delete'] === true || input['delete'] === '1'
    const propagate =
      input['propagate'] === 0 || input['propagate'] === false || input['propagate'] === '0' ? 0 : 1

    const entries: { ugid: string; type: 'user' | 'group' | 'token' }[] = [
      ...users.map((ugid) => ({ ugid, type: 'user' as const })),
      ...groups.map((ugid) => ({ ugid, type: 'group' as const })),
      ...tokens.map((ugid) => ({ ugid, type: 'token' as const })),
    ]

    for (const entry of entries) {
      for (const roleid of roles) {
        if (del) {
          mock.acls = mock.acls.filter(
            (a) =>
              !(a.path === path && a.ugid === entry.ugid && a.type === entry.type && a.roleid === roleid),
          )
        } else {
          const exists = mock.acls.some(
            (a) =>
              a.path === path && a.ugid === entry.ugid && a.type === entry.type && a.roleid === roleid,
          )
          if (!exists) {
            mock.acls.push({ path, ugid: entry.ugid, type: entry.type, roleid, propagate })
          }
        }
      }
    }
    return null
  })

  // ── Permissions (effective) ────────────────────────────────────────────────
  on('GET', '/access/permissions', ({ input, mock, auth }) => {
    const userid = str(input['userid'] || auth.username)
    if (userid !== auth.username) {
      requirePriv(mock, auth.username, '/access', 'Sys.Audit')
    }
    const pathFilter = input['path'] !== undefined ? str(input['path']) : undefined
    const groups = userGroups(mock, userid)

    // Dump tree: /, /vms, /nodes, /storage, /access, /sdn
    const paths = pathFilter
      ? [pathFilter]
      : ['/', '/vms', '/nodes', '/storage', '/access', '/sdn', '/pool']

    const out: Record<string, Record<string, number>> = {}
    for (const path of paths) {
      const privs = computeEffectivePrivs(mock.acls, mock.phase8.roles, userid, path, groups)
      const map: Record<string, number> = {}
      for (const p of privs) map[p] = 1
      if (Object.keys(map).length > 0) out[path] = map
    }
    return out
  })

  // ── API tokens ─────────────────────────────────────────────────────────────
  on('GET', '/access/users/{userid}/token', ({ input, mock }) => {
    const userid = decodeURIComponent(str(input['userid']))
    return mock.phase8.tokens
      .filter((t) => t.userid === userid)
      .map((t) => ({
        tokenid: t.tokenid,
        ...(t.comment ? { comment: t.comment } : {}),
        privsep: t.privsep ?? 1,
        ...(t.expire !== undefined ? { expire: t.expire } : {}),
      }))
  })

  on('POST', '/access/users/{userid}/token/{tokenid}', ({ input, mock, auth }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const tokenid = str(input['tokenid'])
    if (userid !== auth.username) requirePriv(mock, auth.username, '/access', 'User.Modify')
    if (mock.phase8.tokens.some((t) => t.userid === userid && t.tokenid === tokenid)) {
      throw new HttpError(400, 'token already exists')
    }
    const secret = `00000000-1111-2222-3333-${String(Date.now()).slice(-12).padStart(12, '0')}`
    const entry: MockApiToken = {
      userid,
      tokenid,
      comment: str(input['comment'] || '') || undefined,
      privsep: input['privsep'] === 0 || input['privsep'] === '0' ? 0 : 1,
      secret,
    }
    mock.phase8.tokens.push(entry)
    // Đồng bộ AuthStore token list nếu là root automation
    mock.auth.tokens.push({ username: userid, tokenId: tokenid, secret })
    return {
      full_tokenid: `${userid}!${tokenid}`,
      info: { ...(entry.comment ? { comment: entry.comment } : {}), privsep: entry.privsep },
      value: secret,
    }
  })

  on('GET', '/access/users/{userid}/token/{tokenid}', ({ input, mock }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const tokenid = str(input['tokenid'])
    const t = mock.phase8.tokens.find((x) => x.userid === userid && x.tokenid === tokenid)
    if (!t) throw new HttpError(500, 'token does not exist')
    return {
      ...(t.comment ? { comment: t.comment } : {}),
      privsep: t.privsep ?? 1,
      ...(t.expire !== undefined ? { expire: t.expire } : {}),
    }
  })

  on('PUT', '/access/users/{userid}/token/{tokenid}', ({ input, mock, auth }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const tokenid = str(input['tokenid'])
    if (userid !== auth.username) requirePriv(mock, auth.username, '/access', 'User.Modify')
    const t = mock.phase8.tokens.find((x) => x.userid === userid && x.tokenid === tokenid)
    if (!t) throw new HttpError(500, 'token does not exist')
    if (input['comment'] !== undefined) t.comment = str(input['comment']) || undefined
    if (input['privsep'] !== undefined) {
      t.privsep = input['privsep'] === 0 || input['privsep'] === '0' ? 0 : 1
    }
    return null
  })

  on('DELETE', '/access/users/{userid}/token/{tokenid}', ({ input, mock, auth }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const tokenid = str(input['tokenid'])
    if (userid !== auth.username) requirePriv(mock, auth.username, '/access', 'User.Modify')
    mock.phase8.tokens = mock.phase8.tokens.filter((t) => !(t.userid === userid && t.tokenid === tokenid))
    const idx = mock.auth.tokens.findIndex((t) => t.username === userid && t.tokenId === tokenid)
    if (idx >= 0) mock.auth.tokens.splice(idx, 1)
    return null
  })

  // ── TFA ────────────────────────────────────────────────────────────────────
  on('GET', '/access/tfa', ({ mock }) => {
    const byUser = new Map<string, MockTfaEntry[]>()
    for (const e of mock.phase8.tfa) {
      const list = byUser.get(e.userid) ?? []
      list.push(e)
      byUser.set(e.userid, list)
    }
    return [...byUser.entries()].map(([userid, entries]) => ({
      userid,
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        ...(e.description ? { description: e.description } : {}),
        enable: e.enable ?? 1,
        created: e.created ?? 0,
      })),
    }))
  })

  on('GET', '/access/tfa/{userid}', ({ input, mock }) => {
    const userid = decodeURIComponent(str(input['userid']))
    return mock.phase8.tfa
      .filter((e) => e.userid === userid)
      .map((e) => ({
        id: e.id,
        type: e.type,
        ...(e.description ? { description: e.description } : {}),
        enable: e.enable ?? 1,
        created: e.created ?? 0,
      }))
  })

  on('POST', '/access/tfa/{userid}', ({ input, mock, auth }) => {
    const userid = decodeURIComponent(str(input['userid']))
    if (userid !== auth.username) requirePriv(mock, auth.username, '/access', 'User.Modify')
    const id = `totp-${Date.now()}`
    const entry: MockTfaEntry = {
      userid,
      id,
      type: (str(input['type'] || 'totp') as MockTfaEntry['type']) || 'totp',
      description: str(input['description'] || '') || undefined,
      enable: 1,
      created: Math.floor(Date.now() / 1000),
    }
    mock.phase8.tfa.push(entry)
    return { id, type: entry.type }
  })

  on('GET', '/access/tfa/{userid}/{id}', ({ input, mock }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const id = str(input['id'])
    const e = mock.phase8.tfa.find((x) => x.userid === userid && x.id === id)
    if (!e) throw new HttpError(500, 'no such tfa entry')
    return {
      id: e.id,
      type: e.type,
      ...(e.description ? { description: e.description } : {}),
      enable: e.enable ?? 1,
      created: e.created ?? 0,
    }
  })

  on('PUT', '/access/tfa/{userid}/{id}', ({ input, mock, auth }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const id = str(input['id'])
    if (userid !== auth.username) requirePriv(mock, auth.username, '/access', 'User.Modify')
    const e = mock.phase8.tfa.find((x) => x.userid === userid && x.id === id)
    if (!e) throw new HttpError(500, 'no such tfa entry')
    if (input['description'] !== undefined) e.description = str(input['description']) || undefined
    if (input['enable'] !== undefined) {
      e.enable = input['enable'] === 0 || input['enable'] === '0' ? 0 : 1
    }
    return null
  })

  on('DELETE', '/access/tfa/{userid}/{id}', ({ input, mock, auth }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const id = str(input['id'])
    if (userid !== auth.username) requirePriv(mock, auth.username, '/access', 'User.Modify')
    mock.phase8.tfa = mock.phase8.tfa.filter((e) => !(e.userid === userid && e.id === id))
    return null
  })

  on('GET', '/access/users/{userid}/tfa', ({ input, mock }) => {
    const userid = decodeURIComponent(str(input['userid']))
    const types = [...new Set(mock.phase8.tfa.filter((e) => e.userid === userid).map((e) => e.type))]
    return { types: types.length ? types.join(',') : undefined, user: userid }
  })

  // ── Pools ──────────────────────────────────────────────────────────────────
  on('GET', '/pools', ({ input, mock }) => {
    const poolid = input['poolid'] !== undefined ? str(input['poolid']) : undefined
    if (poolid) {
      const p = mock.phase8.pools.find((x) => x.poolid === poolid)
      if (!p) throw new HttpError(500, `pool '${poolid}' does not exist`)
      return [{ poolid: p.poolid, ...(p.comment ? { comment: p.comment } : {}), members: p.members }]
    }
    return mock.phase8.pools.map((p) => ({
      poolid: p.poolid,
      ...(p.comment ? { comment: p.comment } : {}),
    }))
  })

  on('POST', '/pools', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/', 'Pool.Allocate')
    const poolid = str(input['poolid'])
    if (!poolid) throw new HttpError(400, 'poolid required')
    if (mock.phase8.pools.some((p) => p.poolid === poolid)) {
      throw new HttpError(400, 'pool already exists')
    }
    mock.phase8.pools.push({
      poolid,
      comment: str(input['comment'] || '') || undefined,
      members: [],
    })
    // giữ fixture pools đồng bộ đọc cũ
    if (!mock.world.current.pools.some((p) => p.poolid === poolid)) {
      mock.world.current.pools.push({ poolid, comment: str(input['comment'] || '') || undefined })
    }
    return null
  })

  on('PUT', '/pools/{poolid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/', 'Pool.Allocate')
    const poolid = str(input['poolid'])
    const p = mock.phase8.pools.find((x) => x.poolid === poolid)
    if (!p) throw new HttpError(500, `pool '${poolid}' does not exist`)
    if (input['comment'] !== undefined) p.comment = str(input['comment']) || undefined
    if (input['vms']) {
      for (const vmid of str(input['vms'])
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)) {
        const id = `qemu/${vmid}`
        if (!p.members.some((m) => m.id === id || String(m.vmid) === vmid)) {
          p.members.push({ type: 'qemu', vmid: Number(vmid), id, node: 'pve1' })
        }
      }
    }
    if (input['storage']) {
      for (const storage of str(input['storage'])
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)) {
        if (!p.members.some((m) => m.storage === storage)) {
          p.members.push({ type: 'storage', storage, id: `storage/${storage}`, node: 'pve1' })
        }
      }
    }
    return null
  })

  on('DELETE', '/pools/{poolid}', ({ input, mock, auth }) => {
    requirePriv(mock, auth.username, '/', 'Pool.Allocate')
    const poolid = str(input['poolid'])
    mock.phase8.pools = mock.phase8.pools.filter((p) => p.poolid !== poolid)
    mock.world.current.pools = mock.world.current.pools.filter((p) => p.poolid !== poolid)
    return null
  })
}

export function applyAccessHandlers(handlers: HandlerTable): void {
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[`${method} ${path}`] = handler
  }
  register(on)
}

/** Cap + quyền cho ticket login. */
export function ticketCapsFor(mock: MockContext, username: string): Record<string, Record<string, number>> {
  const privs = computeEffectivePrivs(
    mock.acls,
    mock.phase8.roles,
    username,
    '/',
    userGroups(mock, username),
  )
  return capsFromPrivs(privs)
}

export { requirePriv, userGroups }
