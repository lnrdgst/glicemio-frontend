import type { BackupFile } from '../database/backup'

export function downloadBackup(backup: BackupFile, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  try {
    const link = document.createElement('a')
    link.href = url; link.download = filename; link.click()
  } finally { URL.revokeObjectURL(url) }
}
