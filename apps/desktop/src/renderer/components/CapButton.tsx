import { Button, Tooltip, type ButtonProps } from 'antd'

/**
 * Nút tôn trọng capability: thiếu quyền → disabled + tooltip (không để bấm rồi 403).
 */
export function CapButton({
  allowed,
  denyReason,
  disabled,
  title,
  children,
  'aria-label': ariaLabel,
  ...rest
}: ButtonProps & {
  allowed: boolean
  denyReason: string
  children?: React.ReactNode
}): React.JSX.Element {
  const blocked = !allowed
  const btn = (
    <Button
      {...rest}
      disabled={disabled || blocked}
      title={blocked ? undefined : title}
      aria-disabled={disabled || blocked}
      aria-label={typeof children === 'string' ? children : ariaLabel}
    >
      {children}
    </Button>
  )
  if (!blocked) return btn
  // antd Tooltip không hiện trên button disabled — bọc span.
  return (
    <Tooltip title={denyReason}>
      <span style={{ display: 'inline-block' }}>{btn}</span>
    </Tooltip>
  )
}
