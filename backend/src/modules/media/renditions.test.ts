import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { assertFfmpegCapabilities, createFfmpegRunner } from './infrastructure/ffmpeg-runner'
import { prepareMedia } from './infrastructure/media-processor'

describe('FFmpeg rendition runtime', () => {
  test('uses configured executable paths and refuses a binary without the HTML5 preparation capabilities', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const run = async (file: string, args: string[]) => {
      calls.push({ file, args })
      if (args.includes('-encoders')) return { stdout: ' A..... aac\n V....D libx264\n', stderr: '', exitCode: 0 }
      if (args.includes('-filters')) return { stdout: ' ... astats\n ... ametadata\n', stderr: '', exitCode: 0 }
      if (args.includes('-formats')) return { stdout: ' DE mp4\n', stderr: '', exitCode: 0 }
      return { stdout: 'ffmpeg version synthetic\n', stderr: '', exitCode: 0 }
    }

    const runner = createFfmpegRunner({ ffmpegPath: 'custom-ffmpeg', ffprobePath: 'custom-ffprobe' }, run)
    await expect(assertFfmpegCapabilities(runner)).resolves.toBeUndefined()
    expect(calls.map(({ file }) => file)).toContain('custom-ffmpeg')
    expect(calls.map(({ file }) => file)).toContain('custom-ffprobe')

    const incapable = createFfmpegRunner({}, async (_file, args) => ({
      stdout: args.includes('-encoders') ? ' A..... mp3\n' : 'ffmpeg version synthetic\n', stderr: '', exitCode: 0,
    }))
    await expect(assertFfmpegCapabilities(incapable)).rejects.toThrow('AAC')
  })

  test('prepares a real OGG/Opus fixture as HTML5 M4A/AAC and measures 48 waveform peaks', async () => {
    const root = await mkdtemp(join(tmpdir(), 't05-voice-'))
    const runner = createFfmpegRunner({})
    try {
      await assertFfmpegCapabilities(runner)
      const source = join(root, 'source.ogg')
      const output = join(root, 'playback.m4a')
      const fixture = await runner.run(runner.ffmpegPath, [
        '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-y', source,
      ])
      expect(fixture.exitCode).toBe(0)

      const prepared = await prepareMedia({ inputPath: source, outputPath: output, kind: 'voice' }, runner)
      expect(prepared).toMatchObject({ mime: 'audio/mp4', durationMs: expect.any(Number) })
      expect(prepared.waveform).toHaveLength(48)
      expect(prepared.waveform?.every((peak) => peak >= 0 && peak <= 1)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  test('prepares a real HEVC MOV fixture as H.264/AAC MP4 for HTML5 playback', async () => {
    const root = await mkdtemp(join(tmpdir(), 't05-video-'))
    const runner = createFfmpegRunner({})
    try {
      await assertFfmpegCapabilities(runner)
      const source = join(root, 'source.mov')
      const output = join(root, 'playback.mp4')
      const fixture = await runner.run(runner.ffmpegPath, [
        '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx265', '-c:a', 'aac', '-y', source,
      ])
      expect(fixture.exitCode).toBe(0)

      const prepared = await prepareMedia({ inputPath: source, outputPath: output, kind: 'video' }, runner)
      expect(prepared).toMatchObject({ mime: 'video/mp4', width: 320, height: 240, durationMs: expect.any(Number), waveform: null })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30_000)
})
