import { useState } from 'react'
import { Alert, App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Steps, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isUpid } from '@pve/api'
import { pveQueryKey, pveRequest } from '../../../lib/pve'
import { useTasks } from '../../../stores/tasks'
import {
  CREATE_VM_STEP_COUNT,
  OSTYPE_OPTIONS,
  SCSIHW_OPTIONS,
  defaultCreateVmDraft,
  draftToCreateParams,
  type CreateVmDraft,
} from './wizard-state'

const STEP_KEYS = [
  'wizardStepGeneral',
  'wizardStepOs',
  'wizardStepSystem',
  'wizardStepDisks',
  'wizardStepCpu',
  'wizardStepMemory',
  'wizardStepNetwork',
  'wizardStepConfirm',
] as const

/**
 * Wizard tạo VM 8 bước (General → … → Confirm), modal rộng.
 * Mở từ Dashboard; submit qua `POST /nodes/{node}/qemu` và theo dõi UPID.
 *
 * Parent nên đặt `key` khi mở lại để reset state (tránh setState trong effect).
 */
export function CreateVmWizard({
  open,
  connectionId,
  nodes,
  onClose,
}: {
  open: boolean
  connectionId: string
  nodes: string[]
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const addTask = useTasks((s) => s.addTask)
  const [draft, setDraft] = useState<CreateVmDraft>(() => defaultCreateVmDraft(nodes[0] ?? ''))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** true sau khi người dùng tự sửa VMID — không ghi đè bằng nextid. */
  const [vmidTouched, setVmidTouched] = useState(false)

  const nextIdQuery = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/cluster/nextid', {}),
    queryFn: () => pveRequest<string | number>(connectionId, 'GET', '/cluster/nextid', {}),
    enabled: open,
  })

  const suggestedVmid =
    nextIdQuery.data !== undefined && Number.isFinite(Number(nextIdQuery.data))
      ? Number(nextIdQuery.data)
      : undefined
  const effectiveVmid = vmidTouched ? draft.vmid : (draft.vmid ?? suggestedVmid)

  const patch = (partial: Partial<CreateVmDraft>): void => setDraft((d) => ({ ...d, ...partial }))

  const validateStep = (step: number): string | null => {
    if (step === 0) {
      if (!draft.node) return t('wizard.errNode')
      if (effectiveVmid === undefined || effectiveVmid < 100) return t('wizard.errVmid')
      if (!draft.name.trim()) return t('wizard.errName')
    }
    if (step === 3) {
      if (!draft.diskStorage.trim()) return t('wizard.errStorage')
      if (draft.diskSizeGb < 1) return t('wizard.errDiskSize')
    }
    if (step === 5 && draft.memoryMiB < 16) return t('wizard.errMemory')
    if (step === 6 && !draft.netBridge.trim()) return t('wizard.errBridge')
    return null
  }

  const goNext = (): void => {
    const err = validateStep(draft.step)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    // Chốt VMID gợi ý vào draft khi rời bước General để Confirm/submit ổn định.
    if (draft.step === 0 && draft.vmid === undefined && effectiveVmid !== undefined) {
      patch({ vmid: effectiveVmid, step: 1 })
      return
    }
    patch({ step: Math.min(draft.step + 1, CREATE_VM_STEP_COUNT - 1) })
  }

  const goBack = (): void => {
    setError(null)
    patch({ step: Math.max(draft.step - 1, 0) })
  }

  const submit = async (): Promise<void> => {
    const err = validateStep(0) ?? validateStep(3) ?? validateStep(5) ?? validateStep(6)
    if (err) {
      setError(err)
      return
    }
    const vmid = effectiveVmid
    if (vmid === undefined) {
      setError(t('wizard.errVmid'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const params = draftToCreateParams({ ...draft, vmid })
      const result = await pveRequest<unknown>(connectionId, 'POST', '/nodes/{node}/qemu', params)
      if (typeof result === 'string' && isUpid(result)) {
        addTask(connectionId, result)
      }
      message.success(t('wizard.submitted'))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const stepItems = STEP_KEYS.map((key) => ({ title: t(`wizard.${key}`) }))

  return (
    <Modal
      open={open}
      title={t('wizard.title')}
      width={720}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={draft.step === 0 || submitting} onClick={goBack}>
            {t('wizard.back')}
          </Button>
          {draft.step < CREATE_VM_STEP_COUNT - 1 ? (
            <Button type="primary" onClick={goNext}>
              {t('wizard.next')}
            </Button>
          ) : (
            <Button type="primary" loading={submitting} onClick={() => void submit()}>
              {t('wizard.create')}
            </Button>
          )}
        </Space>
      }
    >
      <Steps size="small" current={draft.step} items={stepItems} style={{ marginBottom: 24 }} />
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      {draft.step === 0 ? (
        <GeneralStep
          draft={draft}
          vmid={effectiveVmid}
          nodes={nodes}
          loadingNextId={nextIdQuery.isLoading}
          onChange={patch}
          onVmidChange={(vmid) => {
            setVmidTouched(true)
            patch({ vmid })
          }}
        />
      ) : null}
      {draft.step === 1 ? (
        <OsStep draft={draft} connectionId={connectionId} onChange={patch} />
      ) : null}
      {draft.step === 2 ? <SystemStep draft={draft} onChange={patch} /> : null}
      {draft.step === 3 ? <DisksStep draft={draft} onChange={patch} /> : null}
      {draft.step === 4 ? <CpuStep draft={draft} onChange={patch} /> : null}
      {draft.step === 5 ? <MemoryStep draft={draft} onChange={patch} /> : null}
      {draft.step === 6 ? <NetworkStep draft={draft} onChange={patch} /> : null}
      {draft.step === 7 ? (
        <ConfirmStep draft={{ ...draft, vmid: effectiveVmid }} onChange={patch} />
      ) : null}
    </Modal>
  )
}

function GeneralStep({
  draft,
  vmid,
  nodes,
  loadingNextId,
  onChange,
  onVmidChange,
}: {
  draft: CreateVmDraft
  vmid: number | undefined
  nodes: string[]
  loadingNextId: boolean
  onChange: (p: Partial<CreateVmDraft>) => void
  onVmidChange: (vmid: number | undefined) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Form layout="vertical">
      <Form.Item label={t('guest.node')} required>
        <Select
          value={draft.node || undefined}
          options={nodes.map((n) => ({ value: n, label: n }))}
          onChange={(node) => onChange({ node })}
        />
      </Form.Item>
      <Form.Item label={t('wizard.vmid')} required help={loadingNextId ? t('common.loading') : undefined}>
        <InputNumber
          min={100}
          max={999_999_999}
          style={{ width: '100%' }}
          value={vmid}
          onChange={(v) => onVmidChange(typeof v === 'number' ? v : undefined)}
        />
      </Form.Item>
      <Form.Item label={t('wizard.name')} required>
        <Input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Form.Item>
    </Form>
  )
}

function OsStep({
  draft,
  connectionId,
  onChange,
}: {
  draft: CreateVmDraft
  connectionId: string
  onChange: (p: Partial<CreateVmDraft>) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const isoQuery = useQuery({
    queryKey: ['vm-isos', connectionId, draft.node],
    queryFn: async () => {
      const storages = await pveRequest<{ storage: string; content?: string }[]>(
        connectionId,
        'GET',
        '/nodes/{node}/storage',
        { node: draft.node },
      )
      const isoStorages = storages.filter((s) => (s.content ?? '').split(',').includes('iso'))
      const vols: { volid: string }[] = []
      for (const s of isoStorages) {
        const rows = await pveRequest<{ volid: string }[]>(
          connectionId,
          'GET',
          '/nodes/{node}/storage/{storage}/content',
          { node: draft.node, storage: s.storage, content: 'iso' },
        )
        vols.push(...rows)
      }
      return vols
    },
    enabled: Boolean(draft.node),
  })

  return (
    <Form layout="vertical">
      <Form.Item label={t('wizard.ostype')} required>
        <Select
          value={draft.ostype}
          options={OSTYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(ostype) => onChange({ ostype })}
        />
      </Form.Item>
      <Form.Item label={t('wizard.iso')} help={t('wizard.isoHelp')}>
        <Select
          showSearch
          allowClear
          loading={isoQuery.isLoading}
          placeholder={t('wizard.isoPlaceholder')}
          value={draft.iso || undefined}
          options={(isoQuery.data ?? []).map((v) => ({ value: v.volid, label: v.volid }))}
          onChange={(iso) => onChange({ iso: iso ?? '' })}
          notFoundContent={isoQuery.isLoading ? t('common.loading') : t('wizard.isoEmpty')}
        />
      </Form.Item>
      <Form.Item label={t('wizard.isoManual')}>
        <Input
          placeholder="local:iso/debian-13.iso"
          value={draft.iso}
          onChange={(e) => onChange({ iso: e.target.value })}
        />
      </Form.Item>
    </Form>
  )
}

function SystemStep({
  draft,
  onChange,
}: {
  draft: CreateVmDraft
  onChange: (p: Partial<CreateVmDraft>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Form layout="vertical">
      <Form.Item label={t('wizard.scsihw')}>
        <Select
          value={draft.scsihw}
          options={SCSIHW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(scsihw) => onChange({ scsihw })}
        />
      </Form.Item>
      <Form.Item label={t('wizard.bios')}>
        <Select
          value={draft.bios}
          options={[
            { value: 'seabios', label: 'SeaBIOS' },
            { value: 'ovmf', label: 'OVMF (UEFI)' },
          ]}
          onChange={(bios: 'seabios' | 'ovmf') => onChange({ bios })}
        />
      </Form.Item>
      <Form.Item>
        <Checkbox checked={draft.agent} onChange={(e) => onChange({ agent: e.target.checked })}>
          {t('wizard.agent')}
        </Checkbox>
      </Form.Item>
    </Form>
  )
}

function DisksStep({
  draft,
  onChange,
}: {
  draft: CreateVmDraft
  onChange: (p: Partial<CreateVmDraft>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Form layout="vertical">
      <Form.Item label={t('guest.hardwareDiskBus')}>
        <Select
          value={draft.diskBus}
          options={[
            { value: 'scsi', label: 'SCSI' },
            { value: 'virtio', label: 'VirtIO Block' },
            { value: 'sata', label: 'SATA' },
            { value: 'ide', label: 'IDE' },
          ]}
          onChange={(diskBus: CreateVmDraft['diskBus']) => onChange({ diskBus })}
        />
      </Form.Item>
      <Form.Item label={t('guest.hardwareStorage')} required>
        <Input value={draft.diskStorage} onChange={(e) => onChange({ diskStorage: e.target.value })} />
      </Form.Item>
      <Form.Item label={t('guest.hardwareDiskSizeGb')} required>
        <InputNumber
          min={1}
          style={{ width: '100%' }}
          value={draft.diskSizeGb}
          onChange={(v) => onChange({ diskSizeGb: typeof v === 'number' ? v : 1 })}
        />
      </Form.Item>
      {(draft.diskBus === 'scsi' || draft.diskBus === 'virtio') && (
        <Form.Item>
          <Checkbox
            checked={draft.diskIoThread}
            onChange={(e) => onChange({ diskIoThread: e.target.checked })}
          >
            {t('guest.hardwareIoThread')}
          </Checkbox>
        </Form.Item>
      )}
    </Form>
  )
}

function CpuStep({
  draft,
  onChange,
}: {
  draft: CreateVmDraft
  onChange: (p: Partial<CreateVmDraft>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Form layout="vertical">
      <Form.Item label={t('guest.hardwareCores')} required>
        <InputNumber
          min={1}
          max={512}
          style={{ width: '100%' }}
          value={draft.cores}
          onChange={(v) => onChange({ cores: typeof v === 'number' ? v : 1 })}
        />
      </Form.Item>
      <Form.Item label={t('guest.hardwareSockets')} required>
        <InputNumber
          min={1}
          max={16}
          style={{ width: '100%' }}
          value={draft.sockets}
          onChange={(v) => onChange({ sockets: typeof v === 'number' ? v : 1 })}
        />
      </Form.Item>
    </Form>
  )
}

function MemoryStep({
  draft,
  onChange,
}: {
  draft: CreateVmDraft
  onChange: (p: Partial<CreateVmDraft>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Form layout="vertical">
      <Form.Item label={t('guest.hardwareMemoryMiB')} required>
        <InputNumber
          min={16}
          step={128}
          style={{ width: '100%' }}
          value={draft.memoryMiB}
          onChange={(v) => onChange({ memoryMiB: typeof v === 'number' ? v : 512 })}
        />
      </Form.Item>
    </Form>
  )
}

function NetworkStep({
  draft,
  onChange,
}: {
  draft: CreateVmDraft
  onChange: (p: Partial<CreateVmDraft>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Form layout="vertical">
      <Form.Item label={t('guest.hardwareNetModel')} required>
        <Select
          value={draft.netModel}
          options={['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3'].map((m) => ({
            value: m,
            label: m,
          }))}
          onChange={(netModel) => onChange({ netModel })}
        />
      </Form.Item>
      <Form.Item label={t('guest.hardwareBridge')} required>
        <Input value={draft.netBridge} onChange={(e) => onChange({ netBridge: e.target.value })} />
      </Form.Item>
      <Form.Item label={t('guest.hardwareMac')}>
        <Input
          placeholder="AA:BB:CC:DD:EE:FF"
          value={draft.netMac}
          onChange={(e) => onChange({ netMac: e.target.value })}
        />
      </Form.Item>
      <Form.Item>
        <Checkbox
          checked={draft.netFirewall}
          onChange={(e) => onChange({ netFirewall: e.target.checked })}
        >
          {t('guest.hardwareFirewall')}
        </Checkbox>
      </Form.Item>
    </Form>
  )
}

function ConfirmStep({
  draft,
  onChange,
}: {
  draft: CreateVmDraft
  onChange: (p: Partial<CreateVmDraft>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const lines = [
    `${t('guest.node')}: ${draft.node}`,
    `VMID: ${draft.vmid ?? '—'}`,
    `${t('wizard.name')}: ${draft.name || `vm-${draft.vmid}`}`,
    `${t('wizard.ostype')}: ${draft.ostype}`,
    `${t('guest.hardwareGroupCpu')}: ${draft.cores} × ${draft.sockets}`,
    `${t('guest.memory')}: ${draft.memoryMiB} MiB`,
    `${t('guest.hardwareGroupDisk')}: ${draft.diskBus}0 → ${draft.diskStorage}:${draft.diskSizeGb}`,
    `${t('guest.hardwareGroupNet')}: ${draft.netModel}, ${draft.netBridge}`,
  ]
  if (draft.iso.trim()) lines.push(`ISO: ${draft.iso}`)

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t('wizard.confirmIntro')}
      </Typography.Paragraph>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {lines.map((line) => (
          <li key={line}>
            <Typography.Text>{line}</Typography.Text>
          </li>
        ))}
      </ul>
      <Checkbox
        checked={draft.startAfterCreate}
        onChange={(e) => onChange({ startAfterCreate: e.target.checked })}
      >
        {t('wizard.startAfterCreate')}
      </Checkbox>
    </Space>
  )
}
