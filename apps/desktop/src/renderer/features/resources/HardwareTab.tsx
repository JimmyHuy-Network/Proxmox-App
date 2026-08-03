import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Empty,
  Modal,
  Popconfirm,
  Skeleton,
  Space,
  Table,
  Typography,
} from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { pveQueryKey, pveRequest } from '../../lib/pve'
import { AdvancedDeviceForm, type AdvancedKind } from './hardware/AdvancedDeviceForm'
import { CpuMemoryForm, type CpuMemoryValues } from './hardware/CpuMemoryForm'
import { DiskForm } from './hardware/DiskForm'
import { NetworkForm } from './hardware/NetworkForm'
import {
  classifyConfigKeys,
  nextDiskKey,
  nextMpKey,
  nextNetKey,
  nextPciKey,
  nextSerialKey,
  nextUsbKey,
  summarizeHardwareValue,
  type HardwareGroup,
  type HardwareItem,
} from './hardware/config-keys'
import { putGuestConfig } from './hardware/put-config'

type EditorKind = 'cpu-memory' | 'net' | 'disk' | AdvancedKind | null

interface EditorState {
  kind: EditorKind
  mode: 'add' | 'edit'
  item?: HardwareItem
  deviceKey?: string
}

const ADVANCED: ReadonlySet<string> = new Set(['usb', 'audio', 'serial', 'pci', 'cdrom', 'efi'])

/**
 * Tab phần cứng guest: danh sách theo nhóm với thêm/sửa/xóa qua `PUT .../config`.
 * QEMU thêm USB/audio/serial/PCI/CD/EFI-TPM; LXC giữ đĩa/mạng/CPU/RAM.
 */
export function HardwareTab({
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

  const [editor, setEditor] = useState<EditorState>({ kind: null, mode: 'edit' })

  const q = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', path, params),
    queryFn: () => pveRequest<Record<string, unknown>>(connectionId, 'GET', path, params),
  })

  const config = useMemo(() => q.data ?? {}, [q.data])
  const digest = typeof config['digest'] === 'string' ? config['digest'] : undefined
  const items = useMemo(() => classifyConfigKeys(config, type), [config, type])

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: pveQueryKey(connectionId, 'GET', path, params) })
  }

  const closeEditor = (): void => setEditor({ kind: null, mode: 'edit' })

  const savePatch = async (patch: Record<string, unknown>): Promise<void> => {
    await putGuestConfig(connectionId, node, type, vmid, patch, digest)
    message.success(t('guest.hardwareSaved'))
    closeEditor()
    invalidate()
  }

  const removeKey = async (key: string): Promise<void> => {
    await putGuestConfig(connectionId, node, type, vmid, { delete: key }, digest)
    message.success(t('guest.hardwareRemoved'))
    invalidate()
  }

  if (q.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />
  if (q.isError) {
    return <Alert type="error" showIcon title={q.error instanceof Error ? q.error.message : 'Lỗi'} />
  }

  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('guest.hardwareEmpty')} />
  }

  const groupDefs: { group: HardwareGroup; title: string; qemuOnly?: boolean }[] = [
    { group: 'cpu', title: t('guest.hardwareGroupCpu') },
    { group: 'memory', title: t('guest.hardwareGroupMemory') },
    { group: 'disk', title: t('guest.hardwareGroupDisk') },
    { group: 'cdrom', title: t('guest.hardwareGroupCdrom'), qemuOnly: true },
    { group: 'net', title: t('guest.hardwareGroupNet') },
    { group: 'usb', title: t('guest.hardwareGroupUsb'), qemuOnly: true },
    { group: 'audio', title: t('guest.hardwareGroupAudio'), qemuOnly: true },
    { group: 'serial', title: t('guest.hardwareGroupSerial'), qemuOnly: true },
    { group: 'pci', title: t('guest.hardwareGroupPci'), qemuOnly: true },
    { group: 'efi', title: t('guest.hardwareGroupEfi'), qemuOnly: true },
    { group: 'other', title: t('guest.hardwareGroupOther') },
  ]

  const groups = groupDefs
    .filter((g) => !g.qemuOnly || type === 'qemu')
    .map((g) => ({ ...g, rows: items.filter((i) => i.group === g.group) }))
    .filter((g) => g.rows.length > 0 || g.group === 'disk' || g.group === 'net')

  const cpuMemoryInitial = (): CpuMemoryValues => ({
    cores: num(config['cores']) ?? 1,
    sockets: num(config['sockets']) ?? 1,
    memory: num(config['memory']) ?? 512,
    swap: num(config['swap']),
  })

  const editorKindForGroup = (group: HardwareGroup): EditorKind => {
    if (group === 'net') return 'net'
    if (group === 'disk') return 'disk'
    if (ADVANCED.has(group)) return group as AdvancedKind
    return 'cpu-memory'
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Button size="small" onClick={() => setEditor({ kind: 'cpu-memory', mode: 'edit' })}>
          {t('guest.hardwareEditCpuMemory')}
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={() =>
            setEditor({
              kind: 'disk',
              mode: 'add',
              deviceKey: type === 'lxc' ? nextMpKey(config) : nextDiskKey(config, 'scsi'),
            })
          }
        >
          {t('guest.hardwareAddDisk')}
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={() => setEditor({ kind: 'net', mode: 'add', deviceKey: nextNetKey(config) })}
        >
          {t('guest.hardwareAddNet')}
        </Button>
        {type === 'qemu' ? (
          <>
            <Button
              size="small"
              onClick={() =>
                setEditor({ kind: 'cdrom', mode: 'add', deviceKey: nextDiskKey(config, 'ide') })
              }
            >
              {t('guest.hardwareAddCdrom')}
            </Button>
            <Button
              size="small"
              onClick={() => setEditor({ kind: 'usb', mode: 'add', deviceKey: nextUsbKey(config) })}
            >
              {t('guest.hardwareAddUsb')}
            </Button>
            <Button
              size="small"
              onClick={() => setEditor({ kind: 'audio', mode: 'add', deviceKey: 'audio0' })}
            >
              {t('guest.hardwareAddAudio')}
            </Button>
            <Button
              size="small"
              onClick={() =>
                setEditor({ kind: 'serial', mode: 'add', deviceKey: nextSerialKey(config) })
              }
            >
              {t('guest.hardwareAddSerial')}
            </Button>
            <Button
              size="small"
              onClick={() => setEditor({ kind: 'pci', mode: 'add', deviceKey: nextPciKey(config) })}
            >
              {t('guest.hardwareAddPci')}
            </Button>
            <Button
              size="small"
              onClick={() => setEditor({ kind: 'efi', mode: 'add', deviceKey: 'efidisk0' })}
            >
              {t('guest.hardwareAddEfi')}
            </Button>
          </>
        ) : null}
      </Space>

      {groups.map(({ group, title, rows }) => (
        <div key={group}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            {title}
          </Typography.Text>
          {rows.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('guest.hardwareEmpty')} />
          ) : (
            <Table<HardwareItem>
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={rows}
              columns={[
                { title: t('guest.hardwareKey'), dataIndex: 'key', width: 120 },
                {
                  title: t('guest.hardwareValue'),
                  key: 'summary',
                  render: (_, row) => summarizeHardwareValue(row, type),
                },
                {
                  title: '',
                  key: 'actions',
                  width: 160,
                  render: (_, row) => {
                    if (group === 'other') return null
                    if (group === 'cpu' || group === 'memory') {
                      return (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => setEditor({ kind: 'cpu-memory', mode: 'edit' })}
                        >
                          {t('guest.hardwareEdit')}
                        </Button>
                      )
                    }
                    return (
                      <Space>
                        <Button
                          type="link"
                          size="small"
                          onClick={() =>
                            setEditor({
                              kind: editorKindForGroup(group),
                              mode: 'edit',
                              item: row,
                              deviceKey: row.key,
                            })
                          }
                        >
                          {t('guest.hardwareEdit')}
                        </Button>
                        {row.removable ? (
                          <Popconfirm
                            title={t('guest.hardwareDeleteConfirm')}
                            onConfirm={() => void removeKey(row.key)}
                          >
                            <Button type="link" size="small" danger>
                              {t('common.delete')}
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </Space>
                    )
                  },
                },
              ]}
            />
          )}
        </div>
      ))}

      <Modal
        open={editor.kind === 'cpu-memory'}
        title={t('guest.hardwareEditCpuMemory')}
        footer={null}
        onCancel={closeEditor}
        destroyOnHidden
      >
        <CpuMemoryForm
          guestType={type}
          initialValues={cpuMemoryInitial()}
          submitText={t('common.save')}
          extra={<Button onClick={closeEditor}>{t('common.cancel')}</Button>}
          onFinish={async (values) => {
            const patch: Record<string, unknown> = {
              cores: values.cores,
              memory: type === 'qemu' ? String(values.memory) : values.memory,
            }
            if (type === 'qemu') patch['sockets'] = values.sockets
            if (type === 'lxc' && values.swap !== undefined) patch['swap'] = values.swap
            await savePatch(patch)
          }}
        />
      </Modal>

      <Modal
        open={editor.kind === 'net'}
        title={editor.mode === 'add' ? t('guest.hardwareAddNet') : t('guest.hardwareEditNet')}
        footer={null}
        onCancel={closeEditor}
        destroyOnHidden
        width={480}
      >
        {editor.kind === 'net' && editor.deviceKey ? (
          <NetworkForm
            guestType={type}
            mode={editor.mode}
            deviceKey={editor.deviceKey}
            rawValue={editor.item?.value}
            submitText={t('common.save')}
            extra={<Button onClick={closeEditor}>{t('common.cancel')}</Button>}
            onFinish={async (deviceKey, encoded) => {
              await savePatch({ [deviceKey]: encoded })
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={editor.kind === 'disk'}
        title={editor.mode === 'add' ? t('guest.hardwareAddDisk') : t('guest.hardwareEditDisk')}
        footer={null}
        onCancel={closeEditor}
        destroyOnHidden
        width={480}
      >
        {editor.kind === 'disk' && editor.deviceKey ? (
          <DiskForm
            guestType={type}
            mode={editor.mode}
            deviceKey={editor.deviceKey}
            rawValue={editor.item?.value}
            config={config}
            submitText={t('common.save')}
            extra={<Button onClick={closeEditor}>{t('common.cancel')}</Button>}
            onFinish={async (deviceKey, encoded) => {
              await savePatch({ [deviceKey]: encoded })
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={editor.kind !== null && ADVANCED.has(editor.kind)}
        title={t('guest.hardwareAdvancedTitle')}
        footer={null}
        onCancel={closeEditor}
        destroyOnHidden
        width={480}
      >
        {editor.kind && ADVANCED.has(editor.kind) && editor.deviceKey ? (
          <AdvancedDeviceForm
            kind={editor.kind as AdvancedKind}
            mode={editor.mode}
            deviceKey={editor.deviceKey}
            rawValue={editor.item?.value}
            submitText={t('common.save')}
            extra={<Button onClick={closeEditor}>{t('common.cancel')}</Button>}
            onFinish={async (deviceKey, encoded) => {
              await savePatch({ [deviceKey]: encoded })
            }}
          />
        ) : null}
      </Modal>
    </Space>
  )
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
