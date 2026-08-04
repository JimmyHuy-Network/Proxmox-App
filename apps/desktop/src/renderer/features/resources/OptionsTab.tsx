import { Alert, App, Checkbox, Form, Input, Skeleton, Space } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PVE_PROPERTY_SCHEMAS, formatPropertyString, parsePropertyString, propBool } from '@pve/api'
import { PveForm } from '../../components/PveForm'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { putGuestConfig } from './hardware/put-config'

interface OptionsValues {
  [key: string]: unknown
  name?: string
  hostname?: string
  description?: string
  tags?: string
  onboot?: boolean
  protection?: boolean
  tablet?: boolean
  kvm?: boolean
  startupOrder?: string
  startupUp?: string
  startupDown?: string
  agentEnabled?: boolean
}

/**
 * Tab Options — các tùy chọn scalar của guest (onboot, startup, agent, …).
 * Lưu bằng một PUT config kèm digest.
 */
export function OptionsTab({
  connectionId,
  node,
  type,
  vmid,
}: {
  connectionId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const path = `/nodes/{node}/${type}/{vmid}/config`
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
  const startup = parseStartup(typeof config['startup'] === 'string' ? config['startup'] : undefined)
  const agent =
    type === 'qemu' && typeof config['agent'] === 'string'
      ? parsePropertyString(config['agent'], PVE_PROPERTY_SCHEMAS['agent'])
      : {}

  const initialValues: OptionsValues = {
    name: typeof config['name'] === 'string' ? config['name'] : undefined,
    hostname: typeof config['hostname'] === 'string' ? config['hostname'] : undefined,
    description: typeof config['description'] === 'string' ? config['description'] : undefined,
    tags: typeof config['tags'] === 'string' ? config['tags'] : undefined,
    onboot: config['onboot'] === 1 || config['onboot'] === '1',
    protection: config['protection'] === 1 || config['protection'] === '1',
    tablet: config['tablet'] !== 0 && config['tablet'] !== '0',
    kvm: config['kvm'] !== 0 && config['kvm'] !== '0',
    startupOrder: startup.order,
    startupUp: startup.up,
    startupDown: startup.down,
    agentEnabled: propBool(agent, 'enabled') ?? false,
  }

  return (
    <PveForm<OptionsValues>
      key={`${type}-${vmid}-${digest ?? ''}`}
      initialValues={initialValues}
      submitText={t('common.save')}
      onFinish={async (values) => {
        const patch: Record<string, unknown> = {
          onboot: values.onboot ? 1 : 0,
          protection: values.protection ? 1 : 0,
          description: values.description ?? '',
          tags: values.tags ?? '',
        }

        const startupStr = formatStartup(values.startupOrder, values.startupUp, values.startupDown)
        if (startupStr) patch['startup'] = startupStr
        else patch['delete'] = appendDelete(patch['delete'], 'startup')

        if (type === 'qemu') {
          patch['name'] = values.name ?? ''
          patch['tablet'] = values.tablet === false ? 0 : 1
          patch['kvm'] = values.kvm === false ? 0 : 1
          patch['agent'] = formatPropertyString(
            { enabled: values.agentEnabled ? 1 : 0 },
            PVE_PROPERTY_SCHEMAS['agent'],
          )
        } else {
          patch['hostname'] = values.hostname ?? ''
        }

        await putGuestConfig(connectionId, node, type, vmid, patch, digest)
        message.success(t('guest.optionsSaved'))
        void queryClient.invalidateQueries({ queryKey: pveQueryKey(connectionId, 'GET', path, params) })
      }}
    >
      {type === 'qemu' ? (
        <Form.Item name="name" label={t('wizard.name')}>
          <Input />
        </Form.Item>
      ) : (
        <Form.Item name="hostname" label={t('ctWizard.hostname')}>
          <Input />
        </Form.Item>
      )}
      <Form.Item name="description" label={t('guest.optionsDescription')}>
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item name="tags" label={t('guest.optionsTags')} help={t('guest.optionsTagsHelp')}>
        <Input />
      </Form.Item>
      <Form.Item name="onboot" valuePropName="checked">
        <Checkbox>{t('guest.optionsOnboot')}</Checkbox>
      </Form.Item>
      <Form.Item name="protection" valuePropName="checked">
        <Checkbox>{t('guest.optionsProtection')}</Checkbox>
      </Form.Item>
      {type === 'qemu' ? (
        <>
          <Form.Item name="tablet" valuePropName="checked">
            <Checkbox>{t('guest.optionsTablet')}</Checkbox>
          </Form.Item>
          <Form.Item name="kvm" valuePropName="checked">
            <Checkbox>{t('guest.optionsKvm')}</Checkbox>
          </Form.Item>
          <Form.Item name="agentEnabled" valuePropName="checked">
            <Checkbox>{t('wizard.agent')}</Checkbox>
          </Form.Item>
        </>
      ) : null}
      <Form.Item label={t('guest.optionsStartup')}>
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item name="startupOrder" noStyle>
            <Input style={{ width: '33%' }} placeholder="order" />
          </Form.Item>
          <Form.Item name="startupUp" noStyle>
            <Input style={{ width: '33%' }} placeholder="up (s)" />
          </Form.Item>
          <Form.Item name="startupDown" noStyle>
            <Input style={{ width: '34%' }} placeholder="down (s)" />
          </Form.Item>
        </Space.Compact>
      </Form.Item>
    </PveForm>
  )
}

function parseStartup(raw: string | undefined): { order?: string; up?: string; down?: string } {
  if (!raw) return {}
  const out: { order?: string; up?: string; down?: string } = {}
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=')
    if (k === 'order') out.order = v
    if (k === 'up') out.up = v
    if (k === 'down') out.down = v
  }
  return out
}

function formatStartup(order?: string, up?: string, down?: string): string {
  const parts: string[] = []
  if (order?.trim()) parts.push(`order=${order.trim()}`)
  if (up?.trim()) parts.push(`up=${up.trim()}`)
  if (down?.trim()) parts.push(`down=${down.trim()}`)
  return parts.join(',')
}

function appendDelete(existing: unknown, key: string): string {
  const prev = typeof existing === 'string' && existing.length > 0 ? existing.split(',') : []
  if (!prev.includes(key)) prev.push(key)
  return prev.join(',')
}
