import { Alert, App, Button, Form, Input, Select, Skeleton, Space } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../components/PveForm'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { putGuestConfig } from './hardware/put-config'

interface CloudInitValues {
  [key: string]: unknown
  ciuser?: string
  cipassword?: string
  citype?: string
  nameserver?: string
  searchdomain?: string
  sshkeys?: string
  ip?: string
  gw?: string
  ip6?: string
  gw6?: string
}

/**
 * Tab Cloud-Init cho QEMU — chỉnh các khóa config ci* / ipconfig0, tùy chọn
 * regenerate drive qua PUT .../cloudinit.
 */
export function CloudInitTab({
  connectionId,
  node,
  vmid,
}: {
  connectionId: string
  node: string
  vmid: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const path = '/nodes/{node}/qemu/{vmid}/config'
  const params = { node, vmid }

  const q = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', path, params),
    queryFn: () => pveRequest<Record<string, unknown>>(connectionId, 'GET', path, params),
  })

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />
  if (q.isError) {
    return <Alert type="error" showIcon title={q.error instanceof Error ? q.error.message : 'Lỗi'} />
  }

  const config = q.data ?? {}
  const digest = typeof config['digest'] === 'string' ? config['digest'] : undefined
  const ipconfig = parseIpconfig(typeof config['ipconfig0'] === 'string' ? config['ipconfig0'] : undefined)

  const initialValues: CloudInitValues = {
    ciuser: typeof config['ciuser'] === 'string' ? config['ciuser'] : undefined,
    cipassword: typeof config['cipassword'] === 'string' ? config['cipassword'] : undefined,
    citype: typeof config['citype'] === 'string' ? config['citype'] : 'nocloud',
    nameserver: typeof config['nameserver'] === 'string' ? config['nameserver'] : undefined,
    searchdomain: typeof config['searchdomain'] === 'string' ? config['searchdomain'] : undefined,
    sshkeys: decodeSshkeys(typeof config['sshkeys'] === 'string' ? config['sshkeys'] : undefined),
    ip: ipconfig.ip,
    gw: ipconfig.gw,
    ip6: ipconfig.ip6,
    gw6: ipconfig.gw6,
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PveForm<CloudInitValues>
        key={`ci-${vmid}-${digest ?? ''}`}
        initialValues={initialValues}
        submitText={t('common.save')}
        onFinish={async (values) => {
          const patch: Record<string, unknown> = {
            ciuser: values.ciuser ?? '',
            citype: values.citype ?? 'nocloud',
            nameserver: values.nameserver ?? '',
            searchdomain: values.searchdomain ?? '',
          }
          if (values.cipassword) patch['cipassword'] = values.cipassword
          if (values.sshkeys?.trim()) {
            patch['sshkeys'] = encodeURIComponent(values.sshkeys.trim())
          } else {
            patch['delete'] = appendDelete(patch['delete'], 'sshkeys')
          }

          const ipconfig0 = formatIpconfig(values.ip, values.gw, values.ip6, values.gw6)
          if (ipconfig0) patch['ipconfig0'] = ipconfig0
          else patch['delete'] = appendDelete(patch['delete'], 'ipconfig0')

          await putGuestConfig(connectionId, node, 'qemu', vmid, patch, digest)
          message.success(t('guest.cloudInitSaved'))
          void queryClient.invalidateQueries({ queryKey: pveQueryKey(connectionId, 'GET', path, params) })
        }}
      >
        <Form.Item name="ciuser" label={t('guest.cloudInitUser')}>
          <Input />
        </Form.Item>
        <Form.Item name="cipassword" label={t('guest.cloudInitPassword')}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="citype" label={t('guest.cloudInitType')}>
          <Select
            options={[
              { value: 'nocloud', label: 'nocloud' },
              { value: 'configdrive2', label: 'configdrive2' },
              { value: 'opennebula', label: 'opennebula' },
            ]}
          />
        </Form.Item>
        <Form.Item name="nameserver" label={t('guest.cloudInitNameserver')}>
          <Input placeholder="1.1.1.1 8.8.8.8" />
        </Form.Item>
        <Form.Item name="searchdomain" label={t('guest.cloudInitSearchdomain')}>
          <Input />
        </Form.Item>
        <Form.Item name="sshkeys" label={t('guest.cloudInitSshkeys')} help={t('guest.cloudInitSshkeysHelp')}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item label={t('guest.cloudInitIpconfig')}>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="ip" noStyle>
              <Input style={{ width: '50%' }} placeholder="ip=dhcp or 10.0.0.5/24" />
            </Form.Item>
            <Form.Item name="gw" noStyle>
              <Input style={{ width: '50%' }} placeholder="gw" />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item label={t('guest.cloudInitIpconfig6')}>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="ip6" noStyle>
              <Input style={{ width: '50%' }} placeholder="ip6" />
            </Form.Item>
            <Form.Item name="gw6" noStyle>
              <Input style={{ width: '50%' }} placeholder="gw6" />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
      </PveForm>

      <Button
        onClick={() => {
          void (async () => {
            try {
              await pveRequest(connectionId, 'PUT', '/nodes/{node}/qemu/{vmid}/cloudinit', {
                node,
                vmid,
              })
              message.success(t('guest.cloudInitRegenerated'))
            } catch (error) {
              message.error(error instanceof Error ? error.message : 'Error')
            }
          })()
        }}
      >
        {t('guest.cloudInitRegenerate')}
      </Button>
    </Space>
  )
}

function parseIpconfig(raw: string | undefined): { ip?: string; gw?: string; ip6?: string; gw6?: string } {
  if (!raw) return {}
  const out: { ip?: string; gw?: string; ip6?: string; gw6?: string } = {}
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq)
    const v = part.slice(eq + 1)
    if (k === 'ip' || k === 'gw' || k === 'ip6' || k === 'gw6') out[k] = v
  }
  return out
}

function formatIpconfig(ip?: string, gw?: string, ip6?: string, gw6?: string): string {
  const parts: string[] = []
  if (ip?.trim()) parts.push(`ip=${ip.trim()}`)
  if (gw?.trim()) parts.push(`gw=${gw.trim()}`)
  if (ip6?.trim()) parts.push(`ip6=${ip6.trim()}`)
  if (gw6?.trim()) parts.push(`gw6=${gw6.trim()}`)
  return parts.join(',')
}

function decodeSshkeys(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function appendDelete(existing: unknown, key: string): string {
  const prev = typeof existing === 'string' && existing.length > 0 ? existing.split(',') : []
  if (!prev.includes(key)) prev.push(key)
  return prev.join(',')
}
