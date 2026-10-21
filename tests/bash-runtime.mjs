import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const gitBash = 'C:/Program Files/Git/bin/bash.exe'
export const bashExecutable = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash'

const windowsBashFamily = process.platform === 'win32'
  ? spawnSync(bashExecutable, ['-lc', 'uname -s'], { encoding: 'utf8' }).stdout.trim()
  : ''

export function bashPath(path) {
  if (process.platform !== 'win32') return path
  const match = path.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!match) return path.replaceAll('\\', '/')
  const mount = /^(MINGW|MSYS|CYGWIN)/i.test(windowsBashFamily) ? '' : '/mnt'
  return `${mount}/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`
}

export function linuxPath(path) {
  if (process.platform !== 'win32') return path
  const match = path.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!match) return path.replaceAll('\\', '/')
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`
}

export function gitBashPath(path) {
  return bashPath(path)
}

export function runLinuxRoot(script, options = {}) {
  const command = process.platform === 'win32'
    ? ['wsl.exe', ['--user', 'root', '--exec', 'bash', '-s']]
    : ['bash', ['-s']]
  const result = spawnSync(command[0], command[1], { ...options, input: script, encoding: 'utf8' })
  if (process.platform === 'win32' && result.error?.code === 'ENOENT') {
    throw new Error('WSL with a root user is required for Linux file ownership and mode assertions')
  }
  return result
}
