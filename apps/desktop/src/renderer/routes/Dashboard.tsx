import { Button, Card, Empty, Flex, Statistic, Table, Tag, Typography } from 'antd'
import { ApiOutlined } from '@ant-design/icons'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConnections } from '../stores/connections'
import { pveQueryKey, pveRequest } from '../lib/pve'

interface ClusterResource {
  id: string
  type: string
  node?: string
  name?: string
  status?: string
  vmid?: number
  maxcpu?: number
  cpu?: number
  mem?: number
  maxmem?: number
}

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

  const connected = activeId !== null && phases[activeId] === 'authenticated'

  const { data, isLoading, error } = useQuery({
    queryKey: activeId ? pveQueryKey(activeId, 'GET', '/cluster/resources') : ['pve', 'none'],
    queryFn: () => pveRequest<ClusterResource[]>(activeId!, 'GET', '/cluster/resources'),
    enabled: connected,
    // Trang tổng quan của Proxmox poll liên tục; làm mới mỗi 5 giây.
    refetchInterval: 5000,
  })

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

  const rows = data ?? []
  const nodes = rows.filter((r) => r.type === 'node')
  const vms = rows.filter((r) => r.type === 'qemu')
  const cts = rows.filter((r) => r.type === 'lxc')
  const running = [...vms, ...cts].filter((r) => r.status === 'running').length

  const guests = [...vms, ...cts]

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('dashboard.title')}
      </Typography.Title>

      {error ? (
        <Card>
          <Typography.Text type="danger">{(error as Error).message}</Typography.Text>
        </Card>
      ) : (
        <>
          <Flex gap={16} wrap>
            <Card style={{ flex: 1, minWidth: 140 }}>
              <Statistic title="Node" value={nodes.length} loading={isLoading} />
            </Card>
            <Card style={{ flex: 1, minWidth: 140 }}>
              <Statistic title="VM (QEMU)" value={vms.length} loading={isLoading} />
            </Card>
            <Card style={{ flex: 1, minWidth: 140 }}>
              <Statistic title="Container (LXC)" value={cts.length} loading={isLoading} />
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

          <Card title="Máy ảo và container" size="small">
            <Table<ClusterResource>
              size="small"
              loading={isLoading}
              rowKey="id"
              pagination={false}
              dataSource={guests}
              columns={[
                { title: 'VMID', dataIndex: 'vmid', width: 80 },
                { title: 'Tên', dataIndex: 'name' },
                {
                  title: 'Loại',
                  dataIndex: 'type',
                  width: 90,
                  render: (v: string) => <Tag>{v === 'qemu' ? 'VM' : 'CT'}</Tag>,
                },
                { title: 'Node', dataIndex: 'node', width: 100 },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  width: 110,
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
        </>
      )}
    </Flex>
  )
}
