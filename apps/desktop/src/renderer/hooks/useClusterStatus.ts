import { useQuery } from '@tanstack/react-query'
import { pveQueryKey, pveRequest } from '../lib/pve'

export interface ClusterStatusRow {
  type?: string
  id?: string
  name?: string
  nodes?: number
  quorate?: number | boolean
  online?: number
  nodeid?: number
  local?: number
  ip?: string
}

/**
 * GET /cluster/status — tên cluster + quorate (dùng chung header chips + dashboard).
 */
export function useClusterStatus(connectionId: string | null, refetchInterval = 30_000) {
  return useQuery({
    queryKey: connectionId
      ? pveQueryKey(connectionId, 'GET', '/cluster/status', {})
      : ['cluster-status', 'idle'],
    queryFn: () => pveRequest<ClusterStatusRow[]>(connectionId!, 'GET', '/cluster/status', {}),
    enabled: Boolean(connectionId),
    staleTime: 15_000,
    refetchInterval,
  })
}

export function clusterFromStatus(rows: ClusterStatusRow[] | undefined): ClusterStatusRow | undefined {
  return rows?.find((r) => r.type === 'cluster')
}

export function isQuorate(cluster: ClusterStatusRow | undefined): boolean {
  if (!cluster) return false
  return cluster.quorate === 1 || cluster.quorate === true
}
