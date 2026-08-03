import { Button, Card, Dropdown, Empty, Flex, Input, Space, Statistic, Table, Tag, Typography } from 'antd'
import { ApiOutlined, DownOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConnections } from '../stores/connections'
import { useClusterResources } from '../hooks/useClusterResources'
import { useSelection } from '../stores/selection'
import { CreateCtWizard } from '../features/resources/create-ct/CreateCtWizard'
import { CreateVmWizard } from '../features/resources/create-vm/CreateVmWizard'
import { isGuest, type ClusterResource } from '../features/resources/types'

/** Định dạng byte sang đơn vị đọc được. */
function fmtBytes(n: number | undefined): string {
  if (!n) return '0'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export function Dashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { activeId, phases } = useConnections()
  const select = useSelection((s) => s.select)
  const [query, setQuery] = useState('')
  const [createVmOpen, setCreateVmOpen] = useState(false)
  const [createCtOpen, setCreateCtOpen] = useState(false)
  /** Tăng mỗi lần mở wizard để remount và reset state nháp. */
  const [vmWizardKey, setVmWizardKey] = useState(0)
  const [ctWizardKey, setCtWizardKey] = useState(0)

  const connected = activeId !== null && phases[activeId] === 'authenticated'

  // Không tự poll ở đây — `ResourcePoller` trong main đã poll `/cluster/resources`
  // và đẩy sự kiện; đọc thẳng từ store dùng chung với cây tài nguyên tránh tạo
  // thêm một nguồn dữ liệu lệch pha (xem stores/resources.ts).
  const { resources, at } = useClusterResources(connected ? activeId : null)
  const isLoading = connected && at === null

  const rows = resources as ClusterResource[]
  const nodes = useMemo(() => rows.filter((r) => r.type === 'node'), [rows])
  const nodeNames = useMemo(
    () =>
      nodes
        .map((n) => n.node)
        .filter((n): n is string => Boolean(n))
        .sort(),
    [nodes],
  )
  const guests = useMemo(() => rows.filter(isGuest), [rows])
  const running = guests.filter((r) => r.status === 'running').length

  const q = query.trim().toLowerCase()
  const filteredGuests =
    q === ''
      ? guests
      : guests.filter(
          (r) =>
            (r.name?.toLowerCase().includes(q) ?? false) ||
            String(r.vmid ?? '').includes(q) ||
            (r.node?.toLowerCase().includes(q) ?? false),
        )

  if (!connected) {
    return (
      <Flex vertical gap={16}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('dashboard.title')}
        </Typography.Title>
        <Card>
          <Empty
            description={
              <Flex vertical gap={8} align="center">
                <Typography.Text strong>{t('dashboard.noConnection')}</Typography.Text>
                <Typography.Text type="secondary" style={{ maxWidth: 520 }}>
                  {t('dashboard.noConnectionHint')}
                </Typography.Text>
              </Flex>
            }
          >
            <Button
              type="primary"
              icon={<ApiOutlined />}
              onClick={() => void navigate({ to: '/connections' })}
            >
              {t('nav.connections')}
            </Button>
          </Empty>
        </Card>
      </Flex>
    )
  }

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('dashboard.title')}
      </Typography.Title>

      <Flex gap={16} wrap>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <Statistic title="Node" value={nodes.length} loading={isLoading} />
        </Card>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <Statistic title="VM (QEMU)" value={guests.filter((r) => r.type === 'qemu').length} loading={isLoading} />
        </Card>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <Statistic title="Container (LXC)" value={guests.filter((r) => r.type === 'lxc').length} loading={isLoading} />
        </Card>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <Statistic
            title={t('status.running')}
            value={running}
            loading={isLoading}
            valueStyle={{ color: '#52c41a' }}
          />
        </Card>
      </Flex>

      <Card
        title={t('dashboard.guestsTitle')}
        size="small"
        extra={
          <Space>
            <Dropdown
              disabled={nodeNames.length === 0}
              menu={{
                items: [
                  {
                    key: 'vm',
                    label: t('wizard.createVm'),
                    onClick: () => {
                      setVmWizardKey((k) => k + 1)
                      setCreateVmOpen(true)
                    },
                  },
                  {
                    key: 'ct',
                    label: t('ctWizard.createCt'),
                    onClick: () => {
                      setCtWizardKey((k) => k + 1)
                      setCreateCtOpen(true)
                    },
                  },
                ],
              }}
            >
              <Button type="primary" size="small" icon={<PlusOutlined />} disabled={nodeNames.length === 0}>
                {t('dashboard.create')} <DownOutlined />
              </Button>
            </Dropdown>
            <Input
              allowClear
              size="small"
              style={{ width: 220 }}
              prefix={<SearchOutlined />}
              placeholder={t('common.search') ?? 'Tìm kiếm'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Space>
        }
      >
        <Table<ClusterResource>
          size="small"
          loading={isLoading}
          rowKey="id"
          pagination={filteredGuests.length > 20 ? { pageSize: 20, size: 'small' } : false}
          dataSource={filteredGuests}
          onRow={(r) => ({ onClick: () => select(r), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'VMID', dataIndex: 'vmid', width: 80, sorter: (a, b) => (a.vmid ?? 0) - (b.vmid ?? 0) },
            { title: t('dashboard.colName'), dataIndex: 'name', sorter: (a, b) => (a.name ?? '').localeCompare(b.name ?? '') },
            {
              title: t('dashboard.colType'),
              dataIndex: 'type',
              width: 90,
              filters: [
                { text: 'VM', value: 'qemu' },
                { text: 'CT', value: 'lxc' },
              ],
              onFilter: (value, r) => r.type === value,
              render: (v: string) => <Tag>{v === 'qemu' ? 'VM' : 'CT'}</Tag>,
            },
            {
              title: t('dashboard.colNode'),
              dataIndex: 'node',
              width: 100,
              sorter: (a, b) => (a.node ?? '').localeCompare(b.node ?? ''),
            },
            {
              title: t('dashboard.colStatus'),
              dataIndex: 'status',
              width: 110,
              filters: [
                { text: t('status.running'), value: 'running' },
                { text: t('status.stopped'), value: 'stopped' },
              ],
              onFilter: (value, r) => r.status === value,
              render: (s: string) => (
                <Tag color={s === 'running' ? 'green' : 'default'}>
                  {s === 'running' ? t('status.running') : t('status.stopped')}
                </Tag>
              ),
            },
            {
              title: 'RAM',
              dataIndex: 'mem',
              width: 140,
              render: (mem: number, r) => `${fmtBytes(mem)} / ${fmtBytes(r.maxmem)}`,
            },
          ]}
        />
      </Card>

      {activeId ? (
        <>
          <CreateVmWizard
            key={vmWizardKey}
            open={createVmOpen}
            connectionId={activeId}
            nodes={nodeNames}
            onClose={() => setCreateVmOpen(false)}
          />
          <CreateCtWizard
            key={ctWizardKey}
            open={createCtOpen}
            connectionId={activeId}
            nodes={nodeNames}
            onClose={() => setCreateCtOpen(false)}
          />
        </>
      ) : null}
    </Flex>
  )
}
