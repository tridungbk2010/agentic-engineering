// pnpm clean
// Removes raw output, traces and logs older than RETENTION_DAYS, and any leftover .playwright-cli/ folder.
import fs from 'node:fs'
import path from 'node:path'
import { RETENTION_DAYS, ROOT, logsDir, rawDir, tracesDir } from '../lib/settings.ts'

function removeOlderThan(dir: string, cutoff: number): number {
  if (!fs.existsSync(dir)) return 0
  let removed = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removed += removeOlderThan(full, cutoff)
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full)
    } else if (fs.statSync(full).mtimeMs < cutoff) {
      fs.rmSync(full)
      removed += 1
    }
  }
  return removed
}

const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
const removed = [rawDir(), tracesDir(), logsDir()].reduce((total, dir) => total + removeOlderThan(dir, cutoff), 0)

// Snapshots and responses from a probing session hold real page content.
const probeDir = path.join(ROOT, '.playwright-cli')
const hadProbeDir = fs.existsSync(probeDir)
fs.rmSync(probeDir, { recursive: true, force: true })

console.log(`clean OK removed=${removed} older-than=${RETENTION_DAYS}d playwright-cli=${hadProbeDir ? 'removed' : 'none'}`)
