import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { BackupError, buildBackupZip, readBackupZip, type BackupEntry } from './backup-format'

const bytes = (...n: number[]) => new Uint8Array(n)
const entry = (unitId: string, name: string): BackupEntry => ({
  unitId,
  name,
  photo: { bytes: bytes(1, 2, 3), ext: 'webp' },
  thumb: { bytes: bytes(4, 5), ext: 'jpg' },
})
const known = new Set(['marro-warriors', 'grimnak'])

describe('photo backup zip', () => {
  it('round-trips photos, thumbnails and names', () => {
    const zip = buildBackupZip([entry('marro-warriors', 'Marro Warriors'), entry('grimnak', 'Grimnak')], '2026-10-30T12:00:00.000Z')
    const back = readBackupZip(zip, known)
    expect(back.manifest.count).toBe(2)
    expect(back.manifest.createdAt).toBe('2026-10-30T12:00:00.000Z')
    expect(back.unknown).toEqual([])
    const marro = back.entries.find((e) => e.unitId === 'marro-warriors')!
    expect(marro.name).toBe('Marro Warriors')
    expect([...marro.photo.bytes]).toEqual([1, 2, 3])
    expect(marro.photo.ext).toBe('webp')
    expect([...marro.thumb.bytes]).toEqual([4, 5])
    expect(marro.thumb.ext).toBe('jpg')
  })

  it('skips units this app does not know', () => {
    const zip = buildBackupZip([entry('grimnak', 'Grimnak'), entry('retired-unit', 'Old Unit')], 'x')
    const back = readBackupZip(zip, known)
    expect(back.entries.map((e) => e.unitId)).toEqual(['grimnak'])
    expect(back.unknown).toEqual(['retired-unit'])
  })

  it('rejects files that are not backups', () => {
    expect(() => readBackupZip(bytes(1, 2, 3), known)).toThrow(BackupError)
    expect(() => readBackupZip(zipSync({ 'notes.txt': bytes(65) }), known)).toThrow(/no manifest/)
    const wrongFormat = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify({ format: 'other', version: 1, units: [] })) })
    expect(() => readBackupZip(wrongFormat, known)).toThrow(/isn't a HeroScape photo backup/)
  })

  it('rejects a backup with missing image files', () => {
    const manifest = { format: 'heroscape-photos', version: 1, createdAt: 'x', count: 1, units: [{ unitId: 'grimnak', name: 'Grimnak', photo: 'photos/grimnak.webp', thumb: 'thumbs/grimnak.webp' }] }
    const zip = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), 'photos/grimnak.webp': bytes(1) })
    expect(() => readBackupZip(zip, known)).toThrow(/missing files for Grimnak/)
  })
})
