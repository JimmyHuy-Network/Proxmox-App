import { App, Button, Checkbox, Form, Input, Modal, Select, Space } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PveForm } from '../../components/PveForm'
import { PveGrid } from '../../components/PveGrid'
import { pveQueryKey, pveRequest } from '../../lib/pve'

interface AclRow {
  [key: string]: unknown
  path: string
  ugid: string
  type: string
  roleid: string
  propagate?: number | boolean
}

interface AclValues {
  [key: string]: unknown
  ugid: string
  roleid: string
  propagate?: boolean
}

const COMMON_ROLES = [
  'Administrator',
  'PVEAdmin',
  'PVEVMAdmin',
  'PVEVMUser',
  'PVEAuditor',
  'NoAccess',
]

/**
 * Quyền/ACL theo guest — lọc `/access/acl` theo path `/vms/{vmid}`.
 * Quản trị Access đầy đủ: trang `/access` (GĐ 8).
 */
export function PermissionsTab({
  connectionId,
  vmid,
}: {
  connectionId: string
  vmid: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const guestPath = `/vms/${vmid}`
  const listKey = pveQueryKey(connectionId, 'GET', '/access/acl', {})

  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: listKey })

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PveGrid<AclRow>
        connectionId={connectionId}
        method="GET"
        path="/access/acl"
        params={{}}
        rowKey={(row) => `${row.path}:${row.type}:${row.ugid}:${row.roleid}`}
        emptyText={t('guest.aclEmpty')}
        transform={(rows) => rows.filter((r) => r.path === guestPath || r.path === '/')}
        toolbar={
          <Button type="primary" size="small" onClick={() => setOpen(true)}>
            {t('guest.aclAdd')}
          </Button>
        }
        columns={[
          { title: t('guest.aclPath'), dataIndex: 'path', width: 140 },
          { title: t('guest.aclUgid'), dataIndex: 'ugid' },
          { title: t('guest.aclType'), dataIndex: 'type', width: 80 },
          { title: t('guest.aclRole'), dataIndex: 'roleid', width: 140 },
          {
            title: '',
            key: 'actions',
            width: 100,
            render: (_, row) =>
              row.path === guestPath ? (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    void (async () => {
                      try {
                        await pveRequest(connectionId, 'PUT', '/access/acl', {
                          path: row.path,
                          users: row.type === 'user' ? row.ugid : undefined,
                          groups: row.type === 'group' ? row.ugid : undefined,
                          tokens: row.type === 'token' ? row.ugid : undefined,
                          roles: row.roleid,
                          delete: 1,
                        })
                        message.success(t('guest.aclRemoved'))
                        invalidate()
                      } catch (error) {
                        message.error(error instanceof Error ? error.message : 'Error')
                      }
                    })()
                  }}
                >
                  {t('common.delete')}
                </Button>
              ) : null,
          },
        ]}
      />

      <Modal open={open} title={t('guest.aclAdd')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<AclValues>
          initialValues={{ ugid: '', roleid: 'PVEVMUser', propagate: true }}
          submitText={t('guest.aclAdd')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (values) => {
            await pveRequest(connectionId, 'PUT', '/access/acl', {
              path: guestPath,
              users: values.ugid,
              roles: values.roleid,
              propagate: values.propagate ? 1 : 0,
            })
            message.success(t('guest.aclAdded'))
            setOpen(false)
            invalidate()
          }}
        >
          <Form.Item name="ugid" label={t('guest.aclUgid')} rules={[{ required: true }]} help="user@realm">
            <Input placeholder="user@pam" />
          </Form.Item>
          <Form.Item name="roleid" label={t('guest.aclRole')} rules={[{ required: true }]}>
            <Select options={COMMON_ROLES.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
          <Form.Item name="propagate" valuePropName="checked">
            <Checkbox>{t('guest.aclPropagate')}</Checkbox>
          </Form.Item>
        </PveForm>
      </Modal>
    </Space>
  )
}
