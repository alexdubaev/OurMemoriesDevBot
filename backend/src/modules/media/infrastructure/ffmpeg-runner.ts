import { spawn } from 'node:child_process'

export type ProcessResult = { stdout: string; stderr: string; exitCode: number }
export type ProcessOptions = { signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number }
export type ProcessRunner = (file: string, args: string[], options?: ProcessOptions) => Promise<ProcessResult>

export type FfmpegRunner = {
  ffmpegPath: string
  ffprobePath: string
  run: ProcessRunner
}

/**
 * Infrastructure boundary for the system-provisioned media toolchain. Application services use
 * this capability, never a package-manager installer or an operating-system-specific path.
 */
export function createFfmpegRunner(
  config: { ffmpegPath?: string; ffprobePath?: string },
  run: ProcessRunner = runProcess,
): FfmpegRunner {
  return {
    ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
    ffprobePath: config.ffprobePath ?? 'ffprobe',
    run,
  }
}

/** Fails before a job is claimed if this runtime cannot produce the promised HTML5 derivatives. */
export async function assertFfmpegCapabilities(runner: FfmpegRunner): Promise<void> {
  await ensureSuccess(runner, runner.ffmpegPath, ['-version'], 'FFmpeg')
  await ensureSuccess(runner, runner.ffprobePath, ['-version'], 'FFprobe')
  const encoders = await ensureSuccess(runner, runner.ffmpegPath, ['-hide_banner', '-encoders'], 'FFmpeg encoders')
  const filters = await ensureSuccess(runner, runner.ffmpegPath, ['-hide_banner', '-filters'], 'FFmpeg filters')
  const formats = await ensureSuccess(runner, runner.ffmpegPath, ['-hide_banner', '-formats'], 'FFmpeg formats')

  requireCapability(encoders.stdout, /\baac\b/i, 'AAC encoder')
  requireCapability(encoders.stdout, /\blibx264\b/i, 'H.264 encoder (libx264)')
  requireCapability(filters.stdout, /\bastats\b/i, 'astats waveform filter')
  requireCapability(filters.stdout, /\bametadata\b/i, 'ametadata waveform filter')
  requireCapability(formats.stdout, /^\s*[D .]*E\s+.*\bmp4\b/im, 'MP4/M4A muxer')
}

async function ensureSuccess(runner: FfmpegRunner, file: string, args: string[], label: string) {
  let result: ProcessResult
  try {
    result = await runner.run(file, args, { timeoutMs: 15_000, maxOutputBytes: 2 * 1024 * 1024 })
  } catch {
    throw new Error(`${label} executable is unavailable`)
  }
  if (result.exitCode !== 0) throw new Error(`${label} capability check failed`)
  return result
}

function requireCapability(output: string, pattern: RegExp, capability: string) {
  if (!pattern.test(output)) throw new Error(`FFmpeg lacks required ${capability}`)
}

function runProcess(file: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 5 * 60_000
    const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024
    const child = spawn(file, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let failure: Error | null = null
    const terminate = (error: Error) => {
      failure ??= error
      child.kill('SIGKILL')
    }
    const timeout = setTimeout(() => terminate(new Error(`Media process exceeded ${timeoutMs}ms`)), timeoutMs)
    const abort = () => terminate(new Error('Media process aborted'))
    options.signal?.addEventListener('abort', abort, { once: true })
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > maxOutputBytes) return terminate(new Error('Media process exceeded output limit'))
      target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', (error) => { failure ??= error })
    child.on('close', (exitCode) => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      if (failure) return reject(failure)
      resolve({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      exitCode: exitCode ?? -1,
      })
    })
  })
}
