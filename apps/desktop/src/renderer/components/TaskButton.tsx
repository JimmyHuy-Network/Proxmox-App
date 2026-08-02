import { useEffect, useRef, useState } from 'react'
import { App, Button, Popconfirm, Tooltip, type ButtonProps } from 'antd'
import { isUpid } from '@pve/api'
import type { PveHttpMethod } from '@pve/ipc'
import { pveRequest } from '../lib/pve'
import { useTasks } from '../stores/tasks'
import { useTask } from '../hooks/useTask'

/**
 * Nút gọi một endpoint hành động (start/stop/snapshot/…) và theo dõi tác vụ trả về
 * cho tới khi xong, không cần bên gọi tự viết logic polling.
 *
 * Main đã tự động theo dõi mọi UPID (xem `task-tracker.ts`); component này chỉ cần
 * ghi lạc quan vào store ngay khi có UPID để nút chuyển sang "đang chạy" tức khắc,
 * rồi để `useTask` phản ánh tiến trình thật khi sự kiện tới.
 */
export function TaskButton({
  connectionId,
  method,
  path,
  params,
  label,
  icon,
  confirmMessage,
  danger,
  type = 'default',
  size,
  disabled,
  allowed = true,
  denyReason,
  onDone,
}: {
  connectionId: string
  method: PveHttpMethod
  path: string
  params: Record<string, unknown>
  label: string
  icon?: React.ReactNode
  /** Có giá trị thì hỏi xác nhận trước khi gửi — dùng cho hành động phá hủy. */
  confirmMessage?: string
  danger?: boolean
  type?: ButtonProps['type']
  size?: ButtonProps['size']
  disabled?: boolean
  /** GĐ 8: thiếu quyền → disabled + tooltip thay vì bấm rồi 403. */
  allowed?: boolean
  denyReason?: string
  onDone?: (ok: boolean) => void
}): React.JSX.Element {
  const { message } = App.useApp()
  const [upid, setUpid] = useState<string | null>(null)
  const task = useTask(upid)

  const running = upid !== null && task !== undefined && task.phase !== 'done'
  const sending = upid !== null && task === undefined
  const blocked = !allowed

  // Báo kết quả đúng một lần mỗi UPID, khi tác vụ chuyển sang 'done'. Dùng ref
  // thay vì state để đánh dấu "đã báo" — nó không tự thân cần kích hoạt render
  // nào, chỉ để chặn effect chạy lại lần hai cho cùng một UPID.
  const reportedUpidRef = useRef<string | null>(null)
  useEffect(() => {
    if (!upid || task?.phase !== 'done' || reportedUpidRef.current === upid) return
    reportedUpidRef.current = upid

    const ok = task.exitstatus === 'OK'
    if (ok) message.success(label)
    else message.error(`${label}: ${task.exitstatus ?? 'lỗi không rõ'}`)
    onDone?.(ok)
  }, [upid, task?.phase, task?.exitstatus, label, message, onDone])

  const handleClick = async (): Promise<void> => {
    try {
      const result = await pveRequest<unknown>(connectionId, method, path, params)
      if (typeof result === 'string' && isUpid(result)) {
        useTasks.getState().addTask(connectionId, result)
        setUpid(result)
      } else {
        // Endpoint không trả UPID (hiếm với TaskButton, nhưng không nên vỡ giao diện).
        message.success(label)
        onDone?.(true)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Thao tác thất bại')
      onDone?.(false)
    }
  }

  const button = (
    <Button
      type={type}
      danger={danger}
      size={size}
      icon={icon}
      loading={sending || running}
      disabled={disabled || blocked}
      onClick={confirmMessage || blocked ? undefined : () => void handleClick()}
    >
      {label}
    </Button>
  )

  const maybeTooltip =
    blocked && denyReason ? (
      <Tooltip title={denyReason}>
        <span style={{ display: 'inline-block' }}>{button}</span>
      </Tooltip>
    ) : (
      button
    )

  if (!confirmMessage || blocked) return maybeTooltip

  return (
    <Popconfirm title={confirmMessage} onConfirm={() => void handleClick()} okText="Đồng ý" cancelText="Huỷ">
      {button}
    </Popconfirm>
  )
}
