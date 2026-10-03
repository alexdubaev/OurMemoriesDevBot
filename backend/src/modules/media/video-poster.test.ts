import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

import { createFfmpegRunner } from './infrastructure/ffmpeg-runner'
import { extractVideoPoster } from './infrastructure/video-poster'

const runner = createFfmpegRunner({})

describe('private video poster extraction with the installed media tools', () => {
  test('extracts portrait and landscape JPEGs without changing their orientation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-poster-orientation-'))
    try {
      for (const [name, size] of [['portrait', '360x640'], ['landscape', '640x360']]) {
        const source = join(root, `${name}.mp4`)
        const output = join(root, `${name}.jpg`)
        await makeVideo(source, `testsrc2=size=${size}:rate=10:duration=1`)
        const result = await extractVideoPoster({ inputPath: source, outputPath: output }, runner)
        const metadata = await sharp(output).metadata()
        expect(result).toMatchObject({ mime: 'image/jpeg', durationMs: 1_000 })
        expect(metadata).toMatchObject(name === 'portrait'
          ? { width: 360, height: 640 }
          : { width: 640, height: 360 })
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  test('applies MOV display rotation before sizing the JPEG', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-poster-rotation-'))
    try {
      const source = join(root, 'rotated.mov')
      const output = join(root, 'poster.jpg')
      const base = join(root, 'base.mp4')
      const created = await runner.run(runner.ffmpegPath, [
        '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1',
        '-f', 'lavfi', '-i', 'testsrc2=size=320x160:rate=10:duration=1',
        '-c:v', 'libx264', '-y', base,
      ])
      expect(created.exitCode).toBe(0)
      const rotated = await runner.run(runner.ffmpegPath, [
        '-nostdin', '-v', 'error', '-i', base, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', '-y', source,
      ])
      expect(rotated.exitCode).toBe(0)
      const probe = await runner.run(runner.ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', source])
      if (!hasQuarterTurnSideData(probe.stdout)) {
        const modernFixture = await runner.run(runner.ffmpegPath, [
          '-nostdin', '-v', 'error', '-display_rotation:v:0', '90', '-i', base, '-c', 'copy', '-y', source,
        ])
        expect(modernFixture.exitCode).toBe(0)
      }
      const withRotation = await runner.run(runner.ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', source])
      expect(hasQuarterTurnSideData(withRotation.stdout)).toBe(true)
      const result = await extractVideoPoster({ inputPath: source, outputPath: output }, runner)
      expect(result.width).toBe(160)
      expect(result.height).toBe(320)
      expect(await sharp(output).metadata()).toMatchObject({ width: 160, height: 320 })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  test('accepts subsecond clips and finds a representative frame after an initial black frame', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-poster-short-black-'))
    try {
      const source = join(root, 'short.mp4')
      const output = join(root, 'poster.jpg')
      const created = await runner.run(runner.ffmpegPath, [
        '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=10:d=0.2',
        '-f', 'lavfi', '-i', 'color=c=white:s=320x240:r=10:d=0.8',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
        '-t', '0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source,
      ])
      expect(created.exitCode).toBe(0)
      const result = await extractVideoPoster({ inputPath: source, outputPath: output }, runner)
      const { data: grayscale } = await sharp(output).greyscale().raw().toBuffer({ resolveWithObject: true })
      expect(result.durationMs).toBeGreaterThan(0)
      expect(grayscale.reduce((sum, value) => sum + value, 0) / grayscale.byteLength).toBeGreaterThan(100)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  test('bounds large landscape and portrait outputs to a 1280-pixel long edge without upscaling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-poster-4k-'))
    try {
      for (const [name, size] of [['landscape', '3840x2160'], ['portrait', '2160x3840']]) {
        const source = join(root, `${name}.mp4`)
        const output = join(root, `${name}.jpg`)
        await makeVideo(source, `color=c=red:s=${size}:r=10:d=1`)
        const result = await extractVideoPoster({ inputPath: source, outputPath: output }, runner)
        expect(Math.max(result.width, result.height)).toBe(1280)
        expect(Math.min(result.width, result.height)).toBe(720)
      }
      const smallSource = join(root, 'small.mp4')
      const smallOutput = join(root, 'small.jpg')
      await makeVideo(smallSource, 'color=c=blue:s=320x180:r=1:d=0.25')
      const small = await extractVideoPoster({ inputPath: smallSource, outputPath: smallOutput }, runner)
      expect(small).toMatchObject({ width: 320, height: 180 })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 60_000)

  test('rejects corrupt input without leaving a poster', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-poster-corrupt-'))
    try {
      const source = join(root, 'corrupt.mp4')
      const output = join(root, 'poster.jpg')
      await Bun.write(source, 'not a video')
      await expect(extractVideoPoster({ inputPath: source, outputPath: output }, runner)).rejects.toThrow()
      expect(await Bun.file(output).exists()).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  test('does not apply an ingestion duration ceiling to an already-stored video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-poster-legacy-duration-'))
    try {
      const source = join(root, 'long.mp4')
      const output = join(root, 'poster.jpg')
      await makeVideo(source, 'color=c=green:s=320x180:r=1:d=181')
      const result = await extractVideoPoster({ inputPath: source, outputPath: output }, runner)
      expect(result.durationMs).toBeGreaterThan(180_000)
      expect(await sharp(output).metadata()).toMatchObject({ width: 320, height: 180 })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 60_000)

  test('does not spawn a child for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const customRunner = createFfmpegRunner({ ffmpegPath: 'video-poster-abort-test-command-does-not-exist' })
    await expect(customRunner.run(customRunner.ffmpegPath, [], { signal: controller.signal })).rejects.toThrow('aborted')
  })
})

async function makeVideo(path: string, source: string) {
  const created = await runner.run(runner.ffmpegPath, [
    '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1',
    '-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path,
  ])
  expect(created.exitCode).toBe(0)
}

function hasQuarterTurnSideData(stdout: string) {
  const report = JSON.parse(stdout) as {
    streams?: Array<{ side_data_list?: Array<{ rotation?: number }> }>
  }
  return report.streams?.some((stream) =>
    stream.side_data_list?.some((sideData) => Math.abs(sideData.rotation ?? 0) === 90),
  ) ?? false
}
