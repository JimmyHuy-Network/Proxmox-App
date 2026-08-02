import { useMemo, useState } from 'react'
import { AutoComplete, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useClusterResources } from '../../hooks/useClusterResources'
import { useSelection } from '../../stores/selection'
import { isGuest, type ClusterResource } from './types'

function labelOf(r: ClusterResource): string {
  if (isGuest(r)) {
    const kind = r.type === 'qemu' ? 'VM' : 'CT'
    return `${r.vmid ?? ''} ${r.name ?? ''} (${kind}) · ${r.node ?? ''}`.trim()
  }
  if (r.type === 'storage') {
    return `${r.storage ?? r.id} (storage) · ${r.node ?? ''}`
  }
  return r.id
}

function matches(r: ClusterResource, q: string): boolean {
  const needle = q.toLowerCase()
  return (
    r.id.toLowerCase().includes(needle) ||
    (r.name?.toLowerCase().includes(needle) ?? false) ||
    String(r.vmid ?? '').includes(needle) ||
    (r.storage?.toLowerCase().includes(needle) ?? false) ||
    (r.node?.toLowerCase().includes(needle) ?? false) ||
    (r.tags?.toLowerCase().includes(needle) ?? false)
  )
}

/**
 * Tìm kiếm toàn cục trên header — nhảy tới guest/storage từ `/cluster/resources`.
 */
export function GlobalSearch({ connectionId }: { connectionId: string | null }): React.JSX.Element {
  const { t } = useTranslation()
  const { resources } = useClusterResources(connectionId)
  const select = useSelection((s) => s.select)
  const [value, setValue] = useState('')

  const options = useMemo(() => {
    const q = value.trim()
    if (!q) return []
    return (resources as ClusterResource[])
      .filter((r) => isGuest(r) || r.type === 'storage')
      .filter((r) => matches(r, q))
      .slice(0, 24)
      .map((r) => ({
        value: r.id,
        label: labelOf(r),
      }))
  }, [resources, value])

  return (
    <AutoComplete
      style={{ width: 280, maxWidth: '36vw' }}
      options={options}
      value={value}
      disabled={!connectionId}
      onChange={setValue}
      onSelect={(id) => {
        const hit = (resources as ClusterResource[]).find((r) => r.id === id)
        if (hit) select(hit)
        setValue('')
      }}
      allowClear
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={t('nav.globalSearch')}
        aria-label={t('nav.globalSearch')}
      />
    </AutoComplete>
  )
}
