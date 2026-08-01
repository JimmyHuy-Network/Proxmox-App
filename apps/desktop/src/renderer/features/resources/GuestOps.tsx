import { useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd'
import { CopyOutlined, ColumnWidthOutlined, SwapOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { isUpid } from '@pve/api'
import { App } from 'antd'
import { pveRequest } from '../../lib/pve'
import { useTasks } from '../../stores/tasks'
import { PveForm } from '../../components/PveForm'

type Op = 'clone' | 'migrate' | 'resize' | null

interface CloneValues {
  [key: string]: unknown
  newid: number
  name?: string
  hostname?: string
  target?: string
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

/**
 * Thao tác clone / migrate / resize trên overview guest — gọi API trả UPID
 * và ghi vào TaskDock.
 */
export function GuestOps({
  connectionId,
  node,
  type,
  vmid,
  nodes,
  diskKeys,
  nextId,
}: {
  connectionId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number
  nodes: string[]
  diskKeys: string[]
  nextId?: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const addTask = useTasks((s) => s.addTask)
  const [op, setOp] = useState<Op>(null)

  const run = async (method: 'POST' | 'PUT', path: string, params: Record<string, unknown>): Promise<void> => {
    const result = await pveRequest<unknown>(connectionId, method, path, params)
    if (typeof result === 'string' && isUpid(result)) {
      addTask(connectionId, result)
    }
    message.success(t('guest.opsSubmitted'))
    setOp(null)
  }

  const base = `/nodes/{node}/${type}/{vmid}`

  return (
    <>
      <Space wrap>
        <Button size="small" icon={<CopyOutlined />} onClick={() => setOp('clone')}>
          {t('guest.opsClone')}
        </Button>
        <Button size="small" icon={<SwapOutlined />} onClick={() => setOp('migrate')}>
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
            name: type === 'qemu' ? undefined : undefined,
            hostname: type === 'lxc' ? undefined : undefined,
            target: node,
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
    </>
  )
}
