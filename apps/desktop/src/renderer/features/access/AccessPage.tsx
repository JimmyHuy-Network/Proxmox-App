import { useState } from 'react'
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Tabs, Typography } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PveGrid } from '../../components/PveGrid'
import { PveForm } from '../../components/PveForm'
import { CapButton } from '../../components/CapButton'
import { useConnections } from '../../stores/connections'
import { usePermissions } from '../../hooks/usePermissions'
import { pveQueryKey, pveRequest } from '../../lib/pve'

type Row = Record<string, unknown> & { [k: string]: unknown }

/**
 * Trang Access (GĐ 8): users, groups, roles, ACL, pools, realms, tokens, TFA.
 */
export function AccessPage(): React.JSX.Element {
  const { t } = useTranslation()
  const activeId = useConnections((s) => s.activeId)
  const phase = useConnections((s) => (s.activeId ? s.phases[s.activeId] : undefined))
  const connected = activeId !== null && phase === 'authenticated'
  const { can } = usePermissions(activeId)
  const canModifyUser = can('User.Modify', '/access')
  const canModifyGroup = can('Group.Allocate', '/access')
  const canModifyAcl = can('Permissions.Modify', '/access')
  const canModifySys = can('Sys.Modify', '/access')
  const canPool = can('Pool.Allocate', '/')

  if (!connected || !activeId) {
    return <div>{t('dashboard.noConnection')}</div>
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('nav.access')}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        {t('access.hint')}
      </Typography.Paragraph>
      <Tabs
        items={[
          {
            key: 'users',
            label: t('access.tabUsers'),
            children: <UsersTab connectionId={activeId} canModify={canModifyUser} />,
          },
          {
            key: 'groups',
            label: t('access.tabGroups'),
            children: <GroupsTab connectionId={activeId} canModify={canModifyGroup} />,
          },
          {
            key: 'roles',
            label: t('access.tabRoles'),
            children: <RolesTab connectionId={activeId} canModify={canModifySys} />,
          },
          {
            key: 'acl',
            label: t('access.tabAcl'),
            children: <AclTab connectionId={activeId} canModify={canModifyAcl} />,
          },
          {
            key: 'pools',
            label: t('access.tabPools'),
            children: <PoolsTab connectionId={activeId} canModify={canPool} />,
          },
          {
            key: 'realms',
            label: t('access.tabRealms'),
            children: <RealmsTab connectionId={activeId} canModify={canModifySys} />,
          },
          {
            key: 'tokens',
            label: t('access.tabTokens'),
            children: <TokensTab connectionId={activeId} canModify={canModifyUser} />,
          },
          {
            key: 'tfa',
            label: t('access.tabTfa'),
            children: <TfaTab connectionId={activeId} />,
          },
        ]}
      />
    </Space>
  )
}

function UsersTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/access/users', {})
  const deny = t('access.denied')

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/access/users"
        params={{}}
        rowKey="userid"
        emptyText={t('access.usersEmpty')}
        search={(r, q) => String(r.userid).toLowerCase().includes(q.toLowerCase())}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={deny}
            onClick={() => setOpen(true)}
          >
            {t('access.addUser')}
          </CapButton>
        }
        columns={[
          { title: t('access.userid'), dataIndex: 'userid' },
          { title: t('access.enable'), dataIndex: 'enable', width: 80 },
          { title: t('access.groups'), dataIndex: 'groups', width: 160 },
          { title: t('access.comment'), dataIndex: 'comment' },
          {
            title: '',
            key: 'del',
            width: 90,
            render: (_, row) =>
              row.userid === 'root@pam' ? null : (
                <CapButton
                  size="small"
                  danger
                  allowed={canModify}
                  denyReason={deny}
                  onClick={() => {
                    void (async () => {
                      try {
                        await pveRequest(connectionId, 'DELETE', '/access/users/{userid}', {
                          userid: row.userid,
                        })
                        message.success(t('common.delete'))
                        void qc.invalidateQueries({ queryKey: listKey })
                      } catch (e) {
                        message.error(e instanceof Error ? e.message : 'Error')
                      }
                    })()
                  }}
                >
                  {t('common.delete')}
                </CapButton>
              ),
          },
        ]}
      />
      <Modal open={open} title={t('access.addUser')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ userid: string; comment?: string; groups?: string }>
          initialValues={{ userid: '', comment: '', groups: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/access/users', {
              userid: v.userid,
              comment: v.comment || undefined,
              groups: v.groups || undefined,
            })
            message.success(t('access.userAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="userid" label={t('access.userid')} rules={[{ required: true }]}>
            <Input placeholder="user@pve" />
          </Form.Item>
          <Form.Item name="groups" label={t('access.groups')}>
            <Input placeholder="operators" />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function GroupsTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/access/groups', {})
  const deny = t('access.denied')

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/access/groups"
        params={{}}
        rowKey="groupid"
        emptyText={t('access.groupsEmpty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={deny}
            onClick={() => setOpen(true)}
          >
            {t('access.addGroup')}
          </CapButton>
        }
        columns={[
          { title: t('access.groupid'), dataIndex: 'groupid', width: 160 },
          { title: t('access.users'), dataIndex: 'users' },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
      <Modal open={open} title={t('access.addGroup')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ groupid: string; comment?: string }>
          initialValues={{ groupid: '', comment: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/access/groups', v)
            message.success(t('access.groupAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="groupid" label={t('access.groupid')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function RolesTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/access/roles', {})

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/access/roles"
        params={{}}
        rowKey="roleid"
        emptyText={t('access.rolesEmpty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('access.addRole')}
          </CapButton>
        }
        columns={[
          { title: t('access.roleid'), dataIndex: 'roleid', width: 160 },
          { title: t('access.privs'), dataIndex: 'privs', ellipsis: true },
          { title: t('access.special'), dataIndex: 'special', width: 80 },
        ]}
      />
      <Modal open={open} title={t('access.addRole')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ roleid: string; privs?: string }>
          initialValues={{ roleid: '', privs: 'VM.Audit' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/access/roles', v)
            message.success(t('access.roleAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="roleid" label={t('access.roleid')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="privs" label={t('access.privs')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function AclTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/access/acl', {})
  const deny = t('access.denied')

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/access/acl"
        params={{}}
        rowKey={(r) => `${r.path}:${r.type}:${r.ugid}:${r.roleid}`}
        emptyText={t('access.aclEmpty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={deny}
            onClick={() => setOpen(true)}
          >
            {t('access.addAcl')}
          </CapButton>
        }
        columns={[
          { title: t('guest.aclPath'), dataIndex: 'path', width: 140 },
          { title: t('guest.aclUgid'), dataIndex: 'ugid' },
          { title: t('guest.aclType'), dataIndex: 'type', width: 80 },
          { title: t('guest.aclRole'), dataIndex: 'roleid', width: 140 },
          {
            title: '',
            key: 'del',
            width: 90,
            render: (_, row) => (
              <CapButton
                size="small"
                danger
                allowed={canModify}
                denyReason={deny}
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
                      void qc.invalidateQueries({ queryKey: listKey })
                    } catch (e) {
                      message.error(e instanceof Error ? e.message : 'Error')
                    }
                  })()
                }}
              >
                {t('common.delete')}
              </CapButton>
            ),
          },
        ]}
      />
      <Modal open={open} title={t('access.addAcl')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ path: string; ugid: string; roleid: string; propagate?: boolean }>
          initialValues={{ path: '/', ugid: '', roleid: 'PVEAuditor', propagate: true }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'PUT', '/access/acl', {
              path: v.path,
              users: v.ugid,
              roles: v.roleid,
              propagate: v.propagate ? 1 : 0,
            })
            message.success(t('guest.aclAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="path" label={t('guest.aclPath')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="ugid" label={t('guest.aclUgid')} rules={[{ required: true }]}>
            <Input placeholder="user@realm" />
          </Form.Item>
          <Form.Item name="roleid" label={t('guest.aclRole')} rules={[{ required: true }]}>
            <Select
              options={['Administrator', 'PVEAdmin', 'PVEVMAdmin', 'PVEVMUser', 'PVEAuditor', 'NoAccess'].map(
                (r) => ({ value: r, label: r }),
              )}
            />
          </Form.Item>
          <Form.Item name="propagate" valuePropName="checked">
            <Checkbox>{t('guest.aclPropagate')}</Checkbox>
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function PoolsTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/pools', {})

  return (
    <>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/pools"
        params={{}}
        rowKey="poolid"
        emptyText={t('access.poolsEmpty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={canModify}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('access.addPool')}
          </CapButton>
        }
        columns={[
          { title: t('access.poolid'), dataIndex: 'poolid', width: 160 },
          { title: t('access.comment'), dataIndex: 'comment' },
        ]}
      />
      <Modal open={open} title={t('access.addPool')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ poolid: string; comment?: string }>
          initialValues={{ poolid: '', comment: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            await pveRequest(connectionId, 'POST', '/pools', v)
            message.success(t('access.poolAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="poolid" label={t('access.poolid')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function RealmsTab({
  connectionId,
  canModify,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <PveGrid<Row>
      connectionId={connectionId}
      method="GET"
      path="/access/domains"
      params={{}}
      rowKey="realm"
      emptyText={t('access.realmsEmpty')}
      columns={[
        { title: t('access.realm'), dataIndex: 'realm', width: 120 },
        { title: t('access.realmType'), dataIndex: 'type', width: 100 },
        { title: t('access.comment'), dataIndex: 'comment' },
        {
          title: '',
          key: 'sync',
          width: 100,
          render: (_, row) =>
            row.type === 'ldap' || row.type === 'ad' ? (
              <CapButton
                size="small"
                allowed={canModify}
                denyReason={t('access.denied')}
                onClick={() => {
                  void pveRequest(connectionId, 'POST', '/access/domains/{realm}/sync', {
                    realm: row.realm,
                  })
                }}
              >
                {t('access.sync')}
              </CapButton>
            ) : null,
        },
      ]}
    />
  )
}

function TokensTab({
  connectionId,
}: {
  connectionId: string
  canModify: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const username = useConnections((s) => s.connections.find((c) => c.id === connectionId)?.username) ?? 'root@pam'
  const { message } = App.useApp()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const listKey = pveQueryKey(connectionId, 'GET', '/access/users/{userid}/token', { userid: username })

  return (
    <>
      <Typography.Text type="secondary">{username}</Typography.Text>
      <PveGrid<Row>
        connectionId={connectionId}
        method="GET"
        path="/access/users/{userid}/token"
        params={{ userid: username }}
        rowKey="tokenid"
        emptyText={t('access.tokensEmpty')}
        toolbar={
          <CapButton
            type="primary"
            size="small"
            allowed={true}
            denyReason={t('access.denied')}
            onClick={() => setOpen(true)}
          >
            {t('access.addToken')}
          </CapButton>
        }
        columns={[
          { title: t('access.tokenid'), dataIndex: 'tokenid', width: 160 },
          { title: t('access.comment'), dataIndex: 'comment' },
          { title: 'privsep', dataIndex: 'privsep', width: 80 },
        ]}
      />
      <Modal open={open} title={t('access.addToken')} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
        <PveForm<{ tokenid: string; comment?: string }>
          initialValues={{ tokenid: '', comment: '' }}
          submitText={t('common.save')}
          extra={<Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>}
          onFinish={async (v) => {
            const res = await pveRequest<{ value?: string }>(
              connectionId,
              'POST',
              '/access/users/{userid}/token/{tokenid}',
              { userid: username, tokenid: v.tokenid, comment: v.comment || undefined },
            )
            message.success(res.value ? `${t('access.tokenSecret')}: ${res.value}` : t('access.tokenAdded'))
            setOpen(false)
            void qc.invalidateQueries({ queryKey: listKey })
          }}
        >
          <Form.Item name="tokenid" label={t('access.tokenid')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="comment" label={t('access.comment')}>
            <Input />
          </Form.Item>
        </PveForm>
      </Modal>
    </>
  )
}

function TfaTab({ connectionId }: { connectionId: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <PveGrid<Row>
      connectionId={connectionId}
      method="GET"
      path="/access/tfa"
      params={{}}
      rowKey="userid"
      emptyText={t('access.tfaEmpty')}
      columns={[
        { title: t('access.userid'), dataIndex: 'userid', width: 180 },
        {
          title: t('access.tfaEntries'),
          dataIndex: 'entries',
          render: (entries: { type: string; id: string }[] | undefined) =>
            (entries ?? []).map((e) => `${e.type}:${e.id}`).join(', ') || '—',
        },
      ]}
    />
  )
}
