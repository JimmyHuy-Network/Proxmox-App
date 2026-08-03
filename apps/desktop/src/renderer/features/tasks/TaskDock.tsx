import { useMemo, useState } from 'react'
import { Drawer, Empty, Flex, List, Tag, Typography, theme } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { parseUpid } from '@pve/api'
import { useConnections } from '../../stores/connections'
import { recentTasks, useTasks, type TaskEntry } from '../../stores/tasks'
import { LedDot } from '../../components/TechUi'

function ledOf(task: TaskEntry): 'info' | 'online' | 'error' {
  if (task.phase !== 'done') return 'info'
  return task.exitstatus === 'OK' ? 'online' : 'error'
}

function tagClassOf(task: TaskEntry): string {
  if (task.phase !== 'done') return 'tech-tag-running'
  return task.exitstatus === 'OK' ? 'tech-tag-ok' : 'tech-tag-fail'
}

function labelOf(task: TaskEntry): string {
  const parsed = parseUpid(task.upid)
  const kind = parsed?.type ?? task.upid
  const target = parsed?.id ? `#${parsed.id}` : ''
  return `${kind} ${target}`.trim()
}

function statusLabel(task: TaskEntry): string {
  if (task.phase !== 'done') return 'RUNNING'
  return task.exitstatus === 'OK' ? 'OK' : 'FAIL'
}

/**
 * Dock nhật ký tác vụ — phong cách terminal neon.
 */
export function TaskDock(): React.JSX.Element {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<TaskEntry | null>(null)
  const byUpid = useTasks((s) => s.byUpid)
  const connections = useConnections((s) => s.connections)

  const tasks = useMemo(() => recentTasks(byUpid, 20), [byUpid])
  const activeCount = tasks.filter((task) => task.phase !== 'done').length

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
          fontFamily: 'var(--pve-font-mono)',
        }}
      >
        {open ? <DownOutlined /> : <UpOutlined />}
        {t('tasks.dockTitle')}
        {activeCount > 0 && (
          <Tag className="tech-tag-running" style={{ marginInlineStart: 4 }}>
            {activeCount}
          </Tag>
        )}
      </button>

      {open && (
        <div
          style={{
            height: 168,
            overflow: 'auto',
            borderTop: '1px solid var(--pve-cyan-border)',
            background: 'rgba(11, 15, 25, 0.65)',
          }}
        >
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
                    <LedDot kind={ledOf(task)} />
                    <Typography.Text
                      className="tech-mono"
                      style={{ flex: 1, fontSize: 12 }}
                      ellipsis
                    >
                      {labelOf(task)}
                    </Typography.Text>
                    <Tag style={{ fontSize: 11 }}>{nameOf(task.connectionId)}</Tag>
                    <Tag className={tagClassOf(task)} style={{ marginInlineEnd: 0 }}>
                      {statusLabel(task)}
                    </Tag>
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
    <Drawer title={task ? labelOf(task) : ''} open={task !== null} onClose={onClose} width={520} destroyOnHidden>
      {task && (
        <pre
          className="tech-mono"
          style={{
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'rgba(11, 15, 25, 0.85)',
            border: '1px solid var(--pve-cyan-border)',
            borderRadius: 8,
            padding: 12,
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
