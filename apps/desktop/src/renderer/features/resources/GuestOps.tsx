import { useState } from 'react'
import { App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space } from 'antd'
import {
  ColumnWidthOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FileProtectOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { isUpid } from '@pve/api'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { useTasks } from '../../stores/tasks'
import { PveForm } from '../../components/PveForm'
import { TaskButton } from '../../components/TaskButton'

type Op = 'clone' | 'migrate' | 'resize' | 'move' | null

interface CloneValues {
  [key: string]: unknown
  newid: number
  name?: string
  hostname?: string
  target?: string
  snapname?: string
}

interface MigrateValues {
  [key: string]: unknown
  target: string
}

interface ResizeValues {
  [key: string]: unknown
  disk: string
  size: string
}

interface MoveValues {
  [key: string]: unknown
  disk: string
  storage: string
  delete?: boolean
}

/**
 * Thao tác clone / migrate / resize / move-disk / template trên overview guest.
 */
export function GuestOps({
  connectionId,
  node,
  type,
  vmid,
  nodes,
  diskKeys,
  nextId,
  isTemplate,
  snapshots,
}: {
  connectionId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number
  nodes: string[]
  diskKeys: string[]
  nextId?: number
  isTemplate?: boolean
  snapshots?: string[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const addTask = useTasks((s) => s.addTask)
  const [op, setOp] = useState<Op>(null)

  const storagesQuery = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/nodes/{node}/storage', { node }),
    queryFn: () =>
      pveRequest<{ storage: string; content?: string }[]>(connectionId, 'GET', '/nodes/{node}/storage', {
        node,
      }),
    enabled: op === 'move',
  })

  const run = async (method: 'POST' | 'PUT', path: string, params: Record<string, unknown>): Promise<void> => {
    const result = await pveRequest<unknown>(connectionId, method, path, params)
    if (typeof result === 'string' && isUpid(result)) {
      addTask(connectionId, result)
    }
    message.success(t('guest.opsSubmitted'))
    setOp(null)
  }

  const base = `/nodes/{node}/${type}/{vmid}`
  const storageOptions = (storagesQuery.data ?? [])
    .filter((s) => {
      const content = (s.content ?? '').split(',')
      return type === 'lxc' ? content.includes('rootdir') || content.includes('images') : content.includes('images')
    })
    .map((s) => ({ value: s.storage, label: s.storage }))

  return (
    <>
      <Space wrap>
        <Button size="small" icon={<CopyOutlined />} onClick={() => setOp('clone')}>
          {t('guest.opsClone')}
        </Button>
        <Button size="small" icon={<SwapOutlined />} onClick={() => setOp('migrate')} disabled={nodes.length < 2}>
          {t('guest.opsMigrate')}
        </Button>
        <Button
          size="small"
          icon={<ColumnWidthOutlined />}
          disabled={diskKeys.length === 0}
          onClick={() => setOp('resize')}
        >
          {t('guest.opsResize')}
        </Button>
        <Button
          size="small"
          icon={<DatabaseOutlined />}
          disabled={diskKeys.length === 0}
          onClick={() => setOp('move')}
        >
          {type === 'qemu' ? t('guest.opsMoveDisk') : t('guest.opsMoveVolume')}
        </Button>
        {isTemplate ? null : type === 'qemu' ? (
          <TaskButton
            connectionId={connectionId}
            method="POST"
            path={`${base}/template`}
            params={{ node, vmid }}
            label={t('guest.opsTemplate')}
            icon={<FileProtectOutlined />}
            size="small"
            confirmMessage={t('guest.opsTemplateConfirm')}
          />
        ) : (
          <Button
            size="small"
            icon={<FileProtectOutlined />}
            onClick={() => {
              void (async () => {
                try {
                  await pveRequest(connectionId, 'POST', `${base}/template`, { node, vmid })
                  message.success(t('guest.opsTemplateDone'))
                } catch (error) {
                  message.error(error instanceof Error ? error.message : t('guest.opsTemplate'))
                }
              })()
            }}
          >
            {t('guest.opsTemplate')}
          </Button>
        )}
      </Space>

      <Modal
        open={op === 'clone'}
        title={t('guest.opsClone')}
        footer={null}
        onCancel={() => setOp(null)}
        destroyOnHidden
      >
        <PveForm<CloneValues>
          initialValues={{
            newid: nextId ?? vmid + 1,
            target: node,
            snapname: undefined,
          }}
          submitText={t('guest.opsClone')}
          extra={<Button onClick={() => setOp(null)}>{t('common.cancel')}</Button>}
          onFinish={async (values) => {
            await run('POST', `${base}/clone`, {
              node,
              vmid,
              newid: values.newid,
              target: values.target,
              ...(type === 'qemu' && values.name ? { name: values.name } : {}),
              ...(type === 'lxc' && values.hostname ? { hostname: values.hostname } : {}),
              ...(values.snapname ? { snapname: values.snapname } : {}),
            })
          }}
        >
          <Form.Item name="newid" label={t('guest.opsNewId')} rules={[{ required: true, type: 'number', min: 100 }]}>
            <InputNumber min={100} style={{ width: '100%' }} />
          </Form.Item>
          {type === 'qemu' ? (
            <Form.Item name="name" label={t('wizard.name')}>
              <Input />
            </Form.Item>
          ) : (
            <Form.Item name="hostname" label={t('ctWizard.hostname')}>
              <Input />
            </Form.Item>
          )}
          <Form.Item name="target" label={t('guest.opsTargetNode')}>
            <Select options={nodes.map((n) => ({ value: n, label: n }))} />
          </Form.Item>
          {(snapshots?.length ?? 0) > 0 ? (
            <Form.Item name="snapname" label={t('guest.opsSnapname')} help={t('guest.opsSnapnameHelp')}>
              <Select
                allowClear
                options={(snapshots ?? []).map((s) => ({ value: s, label: s }))}
                placeholder={t('guest.opsSnapnameNone')}
              />
            </Form.Item>
          ) : null}
        </PveForm>
      </Modal>

      <Modal
        open={op === 'migrate'}
        title={t('guest.opsMigrate')}
        footer={null}
        onCancel={() => setOp(null)}
        destroyOnHidden
      >
        <PveForm<MigrateValues>
          initialValues={{ target: nodes.find((n) => n !== node) ?? node }}
          submitText={t('guest.opsMigrate')}
          extra={<Button onClick={() => setOp(null)}>{t('common.cancel')}</Button>}
          onFinish={async (values) => {
            await run('POST', `${base}/migrate`, { node, vmid, target: values.target })
          }}
        >
          <Form.Item name="target" label={t('guest.opsTargetNode')} rules={[{ required: true }]}>
            <Select options={nodes.filter((n) => n !== node).map((n) => ({ value: n, label: n }))} />
          </Form.Item>
        </PveForm>
      </Modal>

      <Modal
        open={op === 'resize'}
        title={t('guest.opsResize')}
        footer={null}
        onCancel={() => setOp(null)}
        destroyOnHidden
      >
        <PveForm<ResizeValues>
          initialValues={{ disk: diskKeys[0] ?? '', size: '+8G' }}
          submitText={t('guest.opsResize')}
          extra={<Button onClick={() => setOp(null)}>{t('common.cancel')}</Button>}
          onFinish={async (values) => {
            await run('PUT', `${base}/resize`, {
              node,
              vmid,
              disk: values.disk,
              size: values.size,
            })
          }}
        >
          <Form.Item name="disk" label={t('guest.opsDisk')} rules={[{ required: true }]}>
            <Select options={diskKeys.map((d) => ({ value: d, label: d }))} />
          </Form.Item>
          <Form.Item
            name="size"
            label={t('guest.opsSize')}
            rules={[{ required: true }]}
            help={t('guest.opsSizeHelp')}
          >
            <Input placeholder="+8G or 64G" />
          </Form.Item>
        </PveForm>
      </Modal>

      <Modal
        open={op === 'move'}
        title={type === 'qemu' ? t('guest.opsMoveDisk') : t('guest.opsMoveVolume')}
        footer={null}
        onCancel={() => setOp(null)}
        destroyOnHidden
      >
        <PveForm<MoveValues>
          initialValues={{
            disk: diskKeys[0] ?? '',
            storage: storageOptions[0]?.value ?? 'local-lvm',
            delete: true,
          }}
          submitText={type === 'qemu' ? t('guest.opsMoveDisk') : t('guest.opsMoveVolume')}
          extra={<Button onClick={() => setOp(null)}>{t('common.cancel')}</Button>}
          onFinish={async (values) => {
            if (type === 'qemu') {
              await run('POST', `${base}/move_disk`, {
                node,
                vmid,
                disk: values.disk,
                storage: values.storage,
                delete: values.delete ? 1 : 0,
              })
            } else {
              await run('POST', `${base}/move_volume`, {
                node,
                vmid,
                volume: values.disk,
                storage: values.storage,
                delete: values.delete ? 1 : 0,
              })
            }
          }}
        >
          <Form.Item
            name="disk"
            label={type === 'qemu' ? t('guest.opsDisk') : t('guest.opsVolume')}
            rules={[{ required: true }]}
          >
            <Select options={diskKeys.map((d) => ({ value: d, label: d }))} />
          </Form.Item>
          <Form.Item name="storage" label={t('guest.hardwareStorage')} rules={[{ required: true }]}>
            <Select options={storageOptions} loading={storagesQuery.isLoading} />
          </Form.Item>
          <Form.Item name="delete" valuePropName="checked">
            <Checkbox>{t('guest.opsMoveDelete')}</Checkbox>
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}
