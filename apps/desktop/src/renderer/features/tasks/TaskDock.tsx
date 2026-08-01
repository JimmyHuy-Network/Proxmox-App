import { useMemo, useState } from 'react'
import { Badge, Drawer, Empty, Flex, List, Tag, Typography, theme } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { parseUpid } from '@pve/api'
import { useConnections } from '../../stores/connections'
import { recentTasks, useTasks, type TaskEntry } from '../../stores/tasks'

type BadgeStatus = 'processing' | 'success' | 'error' | 'default'

function badgeOf(task: TaskEntry): BadgeStatus {
  if (task.phase !== 'done') return 'processing'
  return task.exitstatus === 'OK' ? 'success' : 'error'
}

function labelOf(task: TaskEntry): string {
  const parsed = parseUpid(task.upid)
  const kind = parsed?.type ?? task.upid
  const target = parsed?.id ? `#${parsed.id}` : ''
  return `${kind} ${target}`.trim()
}

/**
 * Dock nhật ký tác vụ ở đáy cửa sổ, gập/mở được.
 *
 * Đọc trực tiếp từ store `tasks` — không tự gọi API nào. Tác vụ xuất hiện ở đây
 * ngay khi bất kỳ nơi nào trong app gọi một endpoint trả về UPID (qua `TaskButton`
 * hoặc `pveRequest` trực tiếp), vì `pve.handlers` ở main tự động theo dõi mọi UPID.
 */
export function TaskDock(): React.JSX.Element {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<TaskEntry | null>(null)
  const byUpid = useTasks((s) => s.byUpid)
  const connections = useConnections((s) => s.connections)

  const tasks = useMemo(() => recentTasks(byUpid, 20), [byUpid])
  const activeCount = tasks.filter((t) => t.phase !== 'done').length

  const nameOf = (connectionId: string): string =>
    connections.find((c) => c.id === connectionId)?.name ?? connectionId

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          background: 'transparent',
          border: 'none',
          color: token.colorTextSecondary,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 12,
        }}
      >
        {open ? <DownOutlined /> : <UpOutlined />}
        {t('tasks.dockTitle')}
        {activeCount > 0 && <Badge count={activeCount} size="small" style={{ marginInlineStart: 4 }} />}
      </button>

      {open && (
        <div style={{ height: 160, overflow: 'auto', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          {tasks.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('tasks.empty')}
              style={{ marginTop: 20 }}
            />
          ) : (
            <List
              size="small"
              dataSource={tasks}
              renderItem={(task) => (
                <List.Item
                  style={{ cursor: 'pointer', paddingInline: 16 }}
                  onClick={() => setViewing(task)}
                >
                  <Flex align="center" gap={8} style={{ width: '100%' }}>
                    <Badge status={badgeOf(task)} />
                    <Typography.Text style={{ flex: 1 }} ellipsis>
                      {labelOf(task)}
                    </Typography.Text>
                    <Tag>{nameOf(task.connectionId)}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {task.phase === 'done'
                        ? task.exitstatus === 'OK'
                          ? t('tasks.done')
                          : t('tasks.failed')
                        : t('tasks.running')}
                    </Typography.Text>
                  </Flex>
                </List.Item>
              )}
            />
          )}
        </div>
      )}

      <TaskLogDrawer task={viewing} onClose={() => setViewing(null)} />
    </>
  )
}

function TaskLogDrawer({ task, onClose }: { task: TaskEntry | null; onClose: () => void }): React.JSX.Element {
  return (
    <Drawer
      title={task ? labelOf(task) : ''}
      open={task !== null}
      onClose={onClose}
      width={520}
      destroyOnHidden
    >
      {task && (
        <pre
          style={{
            fontFamily: '"Cascadia Mono", "Consolas", monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {task.log.map((line) => line.t).join('\n')}
          {task.phase === 'done' && (
            <div style={{ marginTop: 8, opacity: 0.7 }}>
              TASK {task.exitstatus === 'OK' ? 'OK' : task.exitstatus}
            </div>
          )}
        </pre>
      )}
    </Drawer>
  )
}
