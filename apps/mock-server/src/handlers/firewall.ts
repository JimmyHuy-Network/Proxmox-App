import { HttpError, type HandlerTable, type MockHandler } from '../router.ts'
import type { FwAlias, FwIpset, FwOptions, FwRule, FwSecurityGroup } from '../state/phase8.ts'
import type { MockContext } from '../context.ts'
import { requirePriv } from './access.ts'

/**
 * Firewall 3 cấp (cluster / node / guest) + security group + alias + IPSet + reorder.
 */

function str(value: unknown): string {
  return String(value ?? '')
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function guestKey(vmid: unknown): string {
  return String(vmid)
}

function ensureGuestFw(mock: MockContext, vmid: string): {
  rules: FwRule[]
  aliases: FwAlias[]
  ipsets: FwIpset[]
  options: FwOptions
} {
  let g = mock.phase8.firewall.guests[vmid]
  if (!g) {
    g = {
      rules: [],
      aliases: [],
      ipsets: [],
      options: { enable: 0, policy_in: 'DROP', policy_out: 'ACCEPT' },
    }
    mock.phase8.firewall.guests[vmid] = g
  }
  return g
}

function ensureNodeFw(mock: MockContext, node: string): { rules: FwRule[]; options: FwOptions } {
  let n = mock.phase8.firewall.nodes[node]
  if (!n) {
    n = { rules: [], options: { enable: 0, policy_in: 'DROP', policy_out: 'ACCEPT' } }
    mock.phase8.firewall.nodes[node] = n
  }
  return n
}

function ruleFromInput(input: Record<string, unknown>, pos: number): FwRule {
  return {
    pos,
    action: str(input['action'] || 'ACCEPT'),
    type: (str(input['type'] || 'in') as FwRule['type']) || 'in',
    enable: input['enable'] === 0 || input['enable'] === '0' ? 0 : 1,
    ...(input['comment'] !== undefined ? { comment: str(input['comment']) } : {}),
    ...(input['source'] !== undefined ? { source: str(input['source']) } : {}),
    ...(input['dest'] !== undefined ? { dest: str(input['dest']) } : {}),
    ...(input['proto'] !== undefined ? { proto: str(input['proto']) } : {}),
    ...(input['dport'] !== undefined ? { dport: str(input['dport']) } : {}),
    ...(input['sport'] !== undefined ? { sport: str(input['sport']) } : {}),
    ...(input['macro'] !== undefined ? { macro: str(input['macro']) } : {}),
    ...(input['iface'] !== undefined ? { iface: str(input['iface']) } : {}),
    ...(input['log'] !== undefined ? { log: str(input['log']) } : {}),
  }
}

function reindex(rules: FwRule[]): void {
  rules.forEach((r, i) => {
    r.pos = i
  })
}

function moveRule(rules: FwRule[], from: number, to: number): void {
  if (from < 0 || from >= rules.length) throw new HttpError(400, 'no such rule')
  const [item] = rules.splice(from, 1)
  if (!item) throw new HttpError(400, 'no such rule')
  const dest = Math.max(0, Math.min(to, rules.length))
  rules.splice(dest, 0, item)
  reindex(rules)
}

function registerRuleHandlers(
  on: (m: 'GET' | 'POST' | 'PUT' | 'DELETE', p: string, h: MockHandler) => void,
  basePath: string,
  getRules: (ctx: { mock: MockContext; input: Record<string, unknown> }) => FwRule[],
  privPath: string,
): void {
  on('GET', `${basePath}/rules`, ({ mock, input }) => getRules({ mock, input }).map((r) => ({ ...r })))

  on('POST', `${basePath}/rules`, ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, privPath, 'Sys.Modify')
    const rules = getRules({ mock, input })
    const pos = input['pos'] !== undefined ? num(input['pos']) : rules.length
    const rule = ruleFromInput(input, Math.min(pos, rules.length))
    rules.splice(rule.pos, 0, rule)
    reindex(rules)
    return rule.pos
  })

  on('GET', `${basePath}/rules/{pos}`, ({ mock, input }) => {
    const rules = getRules({ mock, input })
    const pos = num(input['pos'])
    const rule = rules[pos]
    if (!rule) throw new HttpError(400, 'no such rule')
    return { ...rule }
  })

  on('PUT', `${basePath}/rules/{pos}`, ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, privPath, 'Sys.Modify')
    const rules = getRules({ mock, input })
    const pos = num(input['pos'])
    const rule = rules[pos]
    if (!rule) throw new HttpError(400, 'no such rule')

    // Kéo thả / sắp xếp: moveto
    if (input['moveto'] !== undefined) {
      moveRule(rules, pos, num(input['moveto']))
      return null
    }

    for (const key of [
      'action',
      'type',
      'comment',
      'source',
      'dest',
      'proto',
      'dport',
      'sport',
      'macro',
      'iface',
      'log',
    ] as const) {
      if (input[key] !== undefined) {
        ;(rule as unknown as Record<string, unknown>)[key] = str(input[key])
      }
    }
    if (input['enable'] !== undefined) {
      rule.enable = input['enable'] === 0 || input['enable'] === '0' ? 0 : 1
    }
    return null
  })

  on('DELETE', `${basePath}/rules/{pos}`, ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, privPath, 'Sys.Modify')
    const rules = getRules({ mock, input })
    const pos = num(input['pos'])
    if (!rules[pos]) throw new HttpError(400, 'no such rule')
    rules.splice(pos, 1)
    reindex(rules)
    return null
  })
}

function register(on: (m: 'GET' | 'POST' | 'PUT' | 'DELETE', p: string, h: MockHandler) => void): void {
  on('GET', '/cluster/firewall', () => [
    { name: 'aliases' },
    { name: 'groups' },
    { name: 'ipset' },
    { name: 'macros' },
    { name: 'options' },
    { name: 'refs' },
    { name: 'rules' },
  ])

  // Cluster rules
  registerRuleHandlers(
    on,
    '/cluster/firewall',
    ({ mock }) => mock.phase8.firewall.cluster.rules,
    '/',
  )

  on('GET', '/cluster/firewall/options', ({ mock }) => ({ ...mock.phase8.firewall.cluster.options }))
  on('PUT', '/cluster/firewall/options', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    Object.assign(mock.phase8.firewall.cluster.options, input)
    return null
  })

  on('GET', '/cluster/firewall/macros', () => [
    { macro: 'HTTP', descr: 'Hypertext Transfer Protocol (WWW)' },
    { macro: 'HTTPS', descr: 'Secure Hypertext Transfer Protocol (WWW)' },
    { macro: 'SSH', descr: 'Secure shell' },
    { macro: 'Ping', descr: 'ICMP echo' },
  ])

  on('GET', '/cluster/firewall/refs', ({ mock }) => {
    const refs: { type: string; name: string; comment?: string; ref: string }[] = []
    for (const a of mock.phase8.firewall.cluster.aliases) {
      refs.push({ type: 'alias', name: a.name, comment: a.comment, ref: a.name })
    }
    for (const s of mock.phase8.firewall.cluster.ipsets) {
      refs.push({ type: 'ipset', name: s.name, comment: s.comment, ref: `+${s.name}` })
    }
    for (const g of mock.phase8.firewall.cluster.groups) {
      refs.push({ type: 'securitygroup', name: g.group, comment: g.comment, ref: g.group })
    }
    return refs
  })

  // Aliases
  on('GET', '/cluster/firewall/aliases', ({ mock }) =>
    mock.phase8.firewall.cluster.aliases.map((a) => ({ ...a })),
  )
  on('POST', '/cluster/firewall/aliases', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const name = str(input['name'])
    if (mock.phase8.firewall.cluster.aliases.some((a) => a.name === name)) {
      throw new HttpError(400, 'alias already exists')
    }
    mock.phase8.firewall.cluster.aliases.push({
      name,
      cidr: str(input['cidr']),
      comment: str(input['comment'] || '') || undefined,
    })
    return null
  })
  on('GET', '/cluster/firewall/aliases/{name}', ({ mock, input }) => {
    const a = mock.phase8.firewall.cluster.aliases.find((x) => x.name === str(input['name']))
    if (!a) throw new HttpError(400, 'no such alias')
    return { ...a }
  })
  on('PUT', '/cluster/firewall/aliases/{name}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const a = mock.phase8.firewall.cluster.aliases.find((x) => x.name === str(input['name']))
    if (!a) throw new HttpError(400, 'no such alias')
    if (input['cidr'] !== undefined) a.cidr = str(input['cidr'])
    if (input['comment'] !== undefined) a.comment = str(input['comment']) || undefined
    if (input['rename']) {
      const neu = str(input['rename'])
      if (mock.phase8.firewall.cluster.aliases.some((x) => x.name === neu)) {
        throw new HttpError(400, 'alias already exists')
      }
      a.name = neu
    }
    return null
  })
  on('DELETE', '/cluster/firewall/aliases/{name}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const name = str(input['name'])
    mock.phase8.firewall.cluster.aliases = mock.phase8.firewall.cluster.aliases.filter(
      (a) => a.name !== name,
    )
    return null
  })

  // IPSet
  on('GET', '/cluster/firewall/ipset', ({ mock }) =>
    mock.phase8.firewall.cluster.ipsets.map((s) => ({
      name: s.name,
      ...(s.comment ? { comment: s.comment } : {}),
    })),
  )
  on('POST', '/cluster/firewall/ipset', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const name = str(input['name'])
    if (mock.phase8.firewall.cluster.ipsets.some((s) => s.name === name)) {
      throw new HttpError(400, 'ipset already exists')
    }
    mock.phase8.firewall.cluster.ipsets.push({
      name,
      comment: str(input['comment'] || '') || undefined,
      entries: [],
    })
    return null
  })
  on('GET', '/cluster/firewall/ipset/{name}', ({ mock, input }) => {
    const s = mock.phase8.firewall.cluster.ipsets.find((x) => x.name === str(input['name']))
    if (!s) throw new HttpError(400, 'no such ipset')
    return s.entries.map((e) => ({ ...e }))
  })
  on('POST', '/cluster/firewall/ipset/{name}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const s = mock.phase8.firewall.cluster.ipsets.find((x) => x.name === str(input['name']))
    if (!s) throw new HttpError(400, 'no such ipset')
    const cidr = str(input['cidr'])
    if (s.entries.some((e) => e.cidr === cidr)) throw new HttpError(400, 'cidr already exists')
    s.entries.push({
      cidr,
      comment: str(input['comment'] || '') || undefined,
      nomatch: input['nomatch'] === 1 || input['nomatch'] === '1' ? 1 : undefined,
    })
    return null
  })
  on('DELETE', '/cluster/firewall/ipset/{name}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const name = str(input['name'])
    mock.phase8.firewall.cluster.ipsets = mock.phase8.firewall.cluster.ipsets.filter(
      (s) => s.name !== name,
    )
    return null
  })
  on('DELETE', '/cluster/firewall/ipset/{name}/{cidr}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const s = mock.phase8.firewall.cluster.ipsets.find((x) => x.name === str(input['name']))
    if (!s) throw new HttpError(400, 'no such ipset')
    const cidr = decodeURIComponent(str(input['cidr']))
    s.entries = s.entries.filter((e) => e.cidr !== cidr)
    return null
  })

  // Security groups
  on('GET', '/cluster/firewall/groups', ({ mock }) =>
    mock.phase8.firewall.cluster.groups.map((g) => ({
      group: g.group,
      ...(g.comment ? { comment: g.comment } : {}),
    })),
  )
  on('POST', '/cluster/firewall/groups', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const group = str(input['group'])
    if (mock.phase8.firewall.cluster.groups.some((g) => g.group === group)) {
      throw new HttpError(400, 'security group already exists')
    }
    const g: FwSecurityGroup = {
      group,
      comment: str(input['comment'] || '') || undefined,
      rules: [],
    }
    // optional first rule fields on create
    if (input['action']) {
      g.rules.push(ruleFromInput(input, 0))
    }
    mock.phase8.firewall.cluster.groups.push(g)
    return null
  })
  on('GET', '/cluster/firewall/groups/{group}', ({ mock, input }) => {
    const g = mock.phase8.firewall.cluster.groups.find((x) => x.group === str(input['group']))
    if (!g) throw new HttpError(400, 'no such security group')
    return g.rules.map((r) => ({ ...r }))
  })
  on('POST', '/cluster/firewall/groups/{group}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const g = mock.phase8.firewall.cluster.groups.find((x) => x.group === str(input['group']))
    if (!g) throw new HttpError(400, 'no such security group')
    const rule = ruleFromInput(input, g.rules.length)
    g.rules.push(rule)
    reindex(g.rules)
    return rule.pos
  })
  on('PUT', '/cluster/firewall/groups/{group}/{pos}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const g = mock.phase8.firewall.cluster.groups.find((x) => x.group === str(input['group']))
    if (!g) throw new HttpError(400, 'no such security group')
    const pos = num(input['pos'])
    if (input['moveto'] !== undefined) {
      moveRule(g.rules, pos, num(input['moveto']))
      return null
    }
    const rule = g.rules[pos]
    if (!rule) throw new HttpError(400, 'no such rule')
    if (input['action'] !== undefined) rule.action = str(input['action'])
    if (input['enable'] !== undefined) {
      rule.enable = input['enable'] === 0 || input['enable'] === '0' ? 0 : 1
    }
    if (input['comment'] !== undefined) rule.comment = str(input['comment'])
    return null
  })
  on('DELETE', '/cluster/firewall/groups/{group}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const group = str(input['group'])
    mock.phase8.firewall.cluster.groups = mock.phase8.firewall.cluster.groups.filter(
      (g) => g.group !== group,
    )
    return null
  })
  on('DELETE', '/cluster/firewall/groups/{group}/{pos}', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    const g = mock.phase8.firewall.cluster.groups.find((x) => x.group === str(input['group']))
    if (!g) throw new HttpError(400, 'no such security group')
    const pos = num(input['pos'])
    if (!g.rules[pos]) throw new HttpError(400, 'no such rule')
    g.rules.splice(pos, 1)
    reindex(g.rules)
    return null
  })

  // Node firewall
  on('GET', '/nodes/{node}/firewall', () => [
    { name: 'rules' },
    { name: 'options' },
    { name: 'log' },
  ])
  registerRuleHandlers(
    on,
    '/nodes/{node}/firewall',
    ({ mock, input }) => ensureNodeFw(mock, str(input['node'])).rules,
    '/',
  )
  on('GET', '/nodes/{node}/firewall/options', ({ mock, input }) => ({
    ...ensureNodeFw(mock, str(input['node'])).options,
  }))
  on('PUT', '/nodes/{node}/firewall/options', ({ mock, input, auth }) => {
    requirePriv(mock, auth.username, '/', 'Sys.Modify')
    Object.assign(ensureNodeFw(mock, str(input['node'])).options, input)
    delete ensureNodeFw(mock, str(input['node'])).options['node']
    return null
  })
  on('GET', '/nodes/{node}/firewall/log', () => [
    { n: 1, t: Math.floor(Date.now() / 1000) - 60, text: 'ACCEPT IN: SSH from 192.168.1.50' },
    { n: 2, t: Math.floor(Date.now() / 1000) - 30, text: 'DROP IN: TCP 445 from 203.0.113.10' },
  ])

  // Guest firewall (qemu + lxc)
  for (const kind of ['qemu', 'lxc'] as const) {
    const base = `/nodes/{node}/${kind}/{vmid}/firewall`
    on('GET', base, () => [
      { name: 'aliases' },
      { name: 'ipset' },
      { name: 'log' },
      { name: 'options' },
      { name: 'refs' },
      { name: 'rules' },
    ])
    registerRuleHandlers(
      on,
      base,
      ({ mock, input }) => ensureGuestFw(mock, guestKey(input['vmid'])).rules,
      '/',
    )
    on('GET', `${base}/options`, ({ mock, input }) => ({
      ...ensureGuestFw(mock, guestKey(input['vmid'])).options,
    }))
    on('PUT', `${base}/options`, ({ mock, input, auth }) => {
      requirePriv(mock, auth.username, '/', 'Sys.Modify')
      const g = ensureGuestFw(mock, guestKey(input['vmid']))
      Object.assign(g.options, input)
      delete g.options['node']
      delete g.options['vmid']
      return null
    })
    on('GET', `${base}/aliases`, ({ mock, input }) =>
      ensureGuestFw(mock, guestKey(input['vmid'])).aliases.map((a) => ({ ...a })),
    )
    on('POST', `${base}/aliases`, ({ mock, input, auth }) => {
      requirePriv(mock, auth.username, '/', 'Sys.Modify')
      const g = ensureGuestFw(mock, guestKey(input['vmid']))
      const name = str(input['name'])
      g.aliases.push({
        name,
        cidr: str(input['cidr']),
        comment: str(input['comment'] || '') || undefined,
      })
      return null
    })
    on('DELETE', `${base}/aliases/{name}`, ({ mock, input, auth }) => {
      requirePriv(mock, auth.username, '/', 'Sys.Modify')
      const g = ensureGuestFw(mock, guestKey(input['vmid']))
      g.aliases = g.aliases.filter((a) => a.name !== str(input['name']))
      return null
    })
    on('GET', `${base}/ipset`, ({ mock, input }) =>
      ensureGuestFw(mock, guestKey(input['vmid'])).ipsets.map((s) => ({
        name: s.name,
        ...(s.comment ? { comment: s.comment } : {}),
      })),
    )
    on('POST', `${base}/ipset`, ({ mock, input, auth }) => {
      requirePriv(mock, auth.username, '/', 'Sys.Modify')
      const g = ensureGuestFw(mock, guestKey(input['vmid']))
      g.ipsets.push({
        name: str(input['name']),
        comment: str(input['comment'] || '') || undefined,
        entries: [],
      })
      return null
    })
    on('GET', `${base}/log`, () => [
      { n: 1, t: Math.floor(Date.now() / 1000) - 20, text: 'ACCEPT IN tcp dpt:22' },
    ])
    on('GET', `${base}/refs`, ({ mock }) => {
      const refs: { type: string; name: string; ref: string }[] = []
      for (const a of mock.phase8.firewall.cluster.aliases) {
        refs.push({ type: 'alias', name: a.name, ref: a.name })
      }
      for (const s of mock.phase8.firewall.cluster.ipsets) {
        refs.push({ type: 'ipset', name: s.name, ref: `+${s.name}` })
      }
      return refs
    })
  }
}

export function applyFirewallHandlers(handlers: HandlerTable): void {
  const on = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: MockHandler): void => {
    handlers[`${method} ${path}`] = handler
  }
  register(on)
}
