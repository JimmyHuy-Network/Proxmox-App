import { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Steps,
  Typography,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isUpid } from '@pve/api'
import { pveQueryKey, pveRequest } from '../../../lib/pve'
import { useTasks } from '../../../stores/tasks'
import {
  CREATE_CT_STEP_COUNT,
  CT_OSTYPE_OPTIONS,
  defaultCreateCtDraft,
  draftToCreateCtParams,
  type CreateCtDraft,
} from './wizard-state'

const STEP_KEYS = [
  'ctStepGeneral',
  'ctStepTemplate',
  'ctStepDisk',
  'ctStepCpu',
  'ctStepMemory',
  'ctStepNetwork',
  'ctStepConfirm',
] as const

interface StorageRow {
  storage: string
  content?: string
}

interface ContentRow {
  volid: string
  content?: string
  format?: string
  size?: number
}

/**
 * Wizard tạo CT 7 bước. Parent remount bằng `key` khi mở lại để reset nháp.
 */
export function CreateCtWizard({
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
  const [draft, setDraft] = useState<CreateCtDraft>(() => defaultCreateCtDraft(nodes[0] ?? ''))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vmidTouched, setVmidTouched] = useState(false)

  const nextIdQuery = useQuery({
    queryKey: pveQueryKey(connectionId, 'GET', '/cluster/nextid', {}),
    queryFn: () => pveRequest<string | number>(connectionId, 'GET', '/cluster/nextid', {}),
    enabled: open,
  })

  const templatesQuery = useQuery({
    queryKey: ['ct-templates', connectionId, draft.node],
    queryFn: async () => {
      const storages = await pveRequest<StorageRow[]>(connectionId, 'GET', '/nodes/{node}/storage', {
        node: draft.node,
      })
      const tmplStorages = storages.filter((s) => (s.content ?? '').split(',').includes('vztmpl'))
      const vols: ContentRow[] = []
      for (const s of tmplStorages) {
        const rows = await pveRequest<ContentRow[]>(
          connectionId,
          'GET',
          '/nodes/{node}/storage/{storage}/content',
          { node: draft.node, storage: s.storage, content: 'vztmpl' },
        )
        vols.push(...rows)
      }
      return vols
    },
    enabled: open && Boolean(draft.node) && draft.step >= 1,
  })

  const suggestedVmid =
    nextIdQuery.data !== undefined && Number.isFinite(Number(nextIdQuery.data))
      ? Number(nextIdQuery.data)
      : undefined
  const effectiveVmid = vmidTouched ? draft.vmid : (draft.vmid ?? suggestedVmid)

  const patch = (partial: Partial<CreateCtDraft>): void => setDraft((d) => ({ ...d, ...partial }))

  const validateStep = (step: number): string | null => {
    if (step === 0) {
      if (!draft.node) return t('wizard.errNode')
      if (effectiveVmid === undefined || effectiveVmid < 100) return t('wizard.errVmid')
      if (!draft.hostname.trim()) return t('ctWizard.errHostname')
    }
    if (step === 1 && !draft.ostemplate.trim()) return t('ctWizard.errTemplate')
    if (step === 2) {
      if (!draft.rootStorage.trim()) return t('wizard.errStorage')
      if (draft.rootSizeGb < 1) return t('wizard.errDiskSize')
    }
    if (step === 4 && draft.memoryMiB < 16) return t('wizard.errMemory')
    if (step === 5 && !draft.netBridge.trim()) return t('wizard.errBridge')
    return null
  }

  const goNext = (): void => {
    const err = validateStep(draft.step)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    if (draft.step === 0 && draft.vmid === undefined && effectiveVmid !== undefined) {
      patch({ vmid: effectiveVmid, step: 1 })
      return
    }
    patch({ step: Math.min(draft.step + 1, CREATE_CT_STEP_COUNT - 1) })
  }

  const goBack = (): void => {
    setError(null)
    patch({ step: Math.max(draft.step - 1, 0) })
  }

  const submit = async (): Promise<void> => {
    const err =
      validateStep(0) ?? validateStep(1) ?? validateStep(2) ?? validateStep(4) ?? validateStep(5)
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
      const params = draftToCreateCtParams({ ...draft, vmid })
      const result = await pveRequest<unknown>(connectionId, 'POST', '/nodes/{node}/lxc', params)
      if (typeof result === 'string' && isUpid(result)) {
        addTask(connectionId, result)
      }
      message.success(t('ctWizard.submitted'))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const stepItems = STEP_KEYS.map((key) => ({ title: t(`ctWizard.${key}`) }))

  return (
    <Modal
      open={open}
      title={t('ctWizard.title')}
      width={720}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={draft.step === 0 || submitting} onClick={goBack}>
            {t('wizard.back')}
          </Button>
          {draft.step < CREATE_CT_STEP_COUNT - 1 ? (
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
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

      {draft.step === 0 ? (
        <Form layout="vertical">
          <Form.Item label={t('guest.node')} required>
            <Select
              value={draft.node || undefined}
              options={nodes.map((n) => ({ value: n, label: n }))}
              onChange={(node) => patch({ node })}
            />
          </Form.Item>
          <Form.Item label={t('wizard.vmid')} required help={nextIdQuery.isLoading ? t('common.loading') : undefined}>
            <InputNumber
              min={100}
              max={999_999_999}
              style={{ width: '100%' }}
              value={effectiveVmid}
              onChange={(v) => {
                setVmidTouched(true)
                patch({ vmid: typeof v === 'number' ? v : undefined })
              }}
            />
          </Form.Item>
          <Form.Item label={t('ctWizard.hostname')} required>
            <Input value={draft.hostname} onChange={(e) => patch({ hostname: e.target.value })} />
          </Form.Item>
          <Form.Item label={t('ctWizard.password')} help={t('ctWizard.passwordHelp')}>
            <Input.Password value={draft.password} onChange={(e) => patch({ password: e.target.value })} />
          </Form.Item>
        </Form>
      ) : null}

      {draft.step === 1 ? (
        <Form layout="vertical">
          <Form.Item label={t('ctWizard.ostemplate')} required>
            <Select
              showSearch
              allowClear
              loading={templatesQuery.isLoading}
              placeholder={t('ctWizard.ostemplatePlaceholder')}
              value={draft.ostemplate || undefined}
              options={(templatesQuery.data ?? []).map((v) => ({
                value: v.volid,
                label: v.volid,
              }))}
              onChange={(ostemplate: string) => patch({ ostemplate: ostemplate ?? '' })}
              notFoundContent={templatesQuery.isLoading ? t('common.loading') : t('ctWizard.noTemplates')}
            />
          </Form.Item>
          <Form.Item label={t('ctWizard.ostemplateManual')} help={t('ctWizard.ostemplateManualHelp')}>
            <Input
              value={draft.ostemplate}
              onChange={(e) => patch({ ostemplate: e.target.value })}
              placeholder="local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst"
            />
          </Form.Item>
          <Form.Item label={t('wizard.ostype')}>
            <Select
              value={draft.ostype}
              options={CT_OSTYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(ostype) => patch({ ostype })}
            />
          </Form.Item>
          <Form.Item>
            <Checkbox
              checked={draft.unprivileged}
              onChange={(e) => patch({ unprivileged: e.target.checked })}
            >
              {t('ctWizard.unprivileged')}
            </Checkbox>
          </Form.Item>
        </Form>
      ) : null}

      {draft.step === 2 ? (
        <Form layout="vertical">
          <Form.Item label={t('guest.hardwareStorage')} required>
            <Input value={draft.rootStorage} onChange={(e) => patch({ rootStorage: e.target.value })} />
          </Form.Item>
          <Form.Item label={t('guest.hardwareDiskSizeGb')} required>
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              value={draft.rootSizeGb}
              onChange={(v) => patch({ rootSizeGb: typeof v === 'number' ? v : 1 })}
            />
          </Form.Item>
        </Form>
      ) : null}

      {draft.step === 3 ? (
        <Form layout="vertical">
          <Form.Item label={t('guest.hardwareCores')} required>
            <InputNumber
              min={1}
              max={512}
              style={{ width: '100%' }}
              value={draft.cores}
              onChange={(v) => patch({ cores: typeof v === 'number' ? v : 1 })}
            />
          </Form.Item>
        </Form>
      ) : null}

      {draft.step === 4 ? (
        <Form layout="vertical">
          <Form.Item label={t('guest.hardwareMemoryMiB')} required>
            <InputNumber
              min={16}
              step={128}
              style={{ width: '100%' }}
              value={draft.memoryMiB}
              onChange={(v) => patch({ memoryMiB: typeof v === 'number' ? v : 512 })}
            />
          </Form.Item>
          <Form.Item label={t('guest.hardwareSwapMiB')}>
            <InputNumber
              min={0}
              step={128}
              style={{ width: '100%' }}
              value={draft.swapMiB}
              onChange={(v) => patch({ swapMiB: typeof v === 'number' ? v : 0 })}
            />
          </Form.Item>
        </Form>
      ) : null}

      {draft.step === 5 ? (
        <Form layout="vertical">
          <Form.Item label={t('guest.hardwareNetName')} required>
            <Input value={draft.netName} onChange={(e) => patch({ netName: e.target.value })} />
          </Form.Item>
          <Form.Item label={t('guest.hardwareBridge')} required>
            <Input value={draft.netBridge} onChange={(e) => patch({ netBridge: e.target.value })} />
          </Form.Item>
          <Form.Item label={t('guest.hardwareNetIp')}>
            <Input value={draft.netIp} onChange={(e) => patch({ netIp: e.target.value })} placeholder="dhcp" />
          </Form.Item>
          <Form.Item>
            <Checkbox
              checked={draft.netFirewall}
              onChange={(e) => patch({ netFirewall: e.target.checked })}
            >
              {t('guest.hardwareFirewall')}
            </Checkbox>
          </Form.Item>
        </Form>
      ) : null}

      {draft.step === 6 ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t('wizard.confirmIntro')}
          </Typography.Paragraph>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {[
              `${t('guest.node')}: ${draft.node}`,
              `VMID: ${effectiveVmid ?? '—'}`,
              `${t('ctWizard.hostname')}: ${draft.hostname || `ct-${effectiveVmid}`}`,
              `${t('ctWizard.ostemplate')}: ${draft.ostemplate}`,
              `${t('guest.hardwareGroupCpu')}: ${draft.cores}`,
              `${t('guest.memory')}: ${draft.memoryMiB} MiB / swap ${draft.swapMiB}`,
              `rootfs: ${draft.rootStorage}:${draft.rootSizeGb}`,
              `${t('guest.hardwareGroupNet')}: ${draft.netName} → ${draft.netBridge} (${draft.netIp})`,
            ].map((line) => (
              <li key={line}>
                <Typography.Text>{line}</Typography.Text>
              </li>
            ))}
          </ul>
          <Checkbox
            checked={draft.startAfterCreate}
            onChange={(e) => patch({ startAfterCreate: e.target.checked })}
          >
            {t('wizard.startAfterCreate')}
          </Checkbox>
        </Space>
      ) : null}
    </Modal>
  )
}
