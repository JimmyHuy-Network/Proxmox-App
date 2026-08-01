import { describe, expect, it } from 'vitest'
import { sortSnapshotsForTree } from './SnapshotTab'

describe('sortSnapshotsForTree', () => {
  it('indent theo parent và đặt current sau lá', () => {
    const rows = sortSnapshotsForTree([
      { name: 'current', description: 'You are here!' },
      {
        name: 'sau',
        parent: 'truoc',
        snaptime: 2,
        description: '',
      },
      {
        name: 'truoc',
        snaptime: 1,
        description: '',
      },
    ])

    expect(rows.map((r) => r.name)).toEqual(['truoc', 'sau', 'current'])
    expect(rows[0]?.['__depth']).toBe(0)
    expect(rows[1]?.['__depth']).toBe(1)
    expect(rows[2]?.parent).toBe('sau')
  })
})
