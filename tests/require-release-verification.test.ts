import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { requireReleaseVerification } from '../scripts/require-release-verification.mjs'

const releaseSha = 'a'.repeat(40)
const repository = 'alexdubaev/OurMemoriesDevBot'
const workflowId = 321

function mockFetch({ runs, jobs, workflow, status = 200 } = {}) {
  const requests = []
  const fetchImpl = async (input, init) => {
    const url = new URL(input)
    requests.push({ url, init })
    if (url.pathname.endsWith('/actions/workflows/verify.yml')) {
      return response(workflow ?? { id: workflowId, path: '.github/workflows/verify.yml', state: 'active' }, status)
    }
    if (url.pathname.endsWith(`/actions/workflows/${workflowId}/runs`)) {
      return response({ workflow_runs: runs ?? [successfulRun()] }, status)
    }
    if (/\/actions\/runs\/\d+\/attempts\/\d+\/jobs$/.test(url.pathname)) {
      return response({ jobs: jobs ?? [successfulJob()] }, status)
    }
    throw new Error(`Unexpected API request: ${url.pathname}`)
  }
  return { fetchImpl, requests }
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function successfulRun(overrides = {}) {
  return {
    id: 900,
    run_number: 20,
    run_attempt: 1,
    workflow_id: workflowId,
    path: '.github/workflows/verify.yml',
    head_sha: releaseSha,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-08T10:00:00Z',
    ...overrides,
  }
}

function successfulJob(overrides = {}) {
  return { name: 'verify-required', status: 'completed', conclusion: 'success', ...overrides }
}

test('accepts the latest successful verify-required job for the exact main SHA', async () => {
  const { fetchImpl, requests } = mockFetch({
    runs: [
      successfulRun(),
      successfulRun({ id: 899, run_number: 19, conclusion: 'failure' }),
    ],
  })

  await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl }))
    .resolves.toMatchObject({ runId: 900, runAttempt: 1, job: 'verify-required' })
  expect(requests.map(({ url }) => url.pathname)).toEqual([
    `/repos/${repository}/actions/workflows/verify.yml`,
    `/repos/${repository}/actions/workflows/${workflowId}/runs`,
    `/repos/${repository}/actions/runs/900/attempts/1/jobs`,
  ])
  expect(requests.every(({ init }) => new Headers(init.headers).get('authorization') === 'Bearer test-token')).toBe(true)
})

test('rejects a newer failed run even when an older exact-SHA run passed', async () => {
  const { fetchImpl } = mockFetch({ runs: [
    successfulRun({ id: 901, run_number: 21, conclusion: 'failure' }),
    successfulRun(),
  ] })
  await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl }))
    .rejects.toThrow(/latest.*run.*success/i)
})

test('rejects a newer pending run even when an older run passed', async () => {
  const { fetchImpl } = mockFetch({ runs: [
    successfulRun({ id: 901, run_number: 21, status: 'in_progress', conclusion: null }),
    successfulRun(),
  ] })
  await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl }))
    .rejects.toThrow(/latest.*run.*completed/i)
})

test('rejects a canceled latest run even when an older run passed', async () => {
  const { fetchImpl } = mockFetch({ runs: [
    successfulRun({ id: 901, run_number: 21, conclusion: 'cancelled' }),
    successfulRun(),
  ] })
  await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl }))
    .rejects.toThrow(/latest.*run.*successful/i)
})

test('rejects a disabled Verify workflow', async () => {
  const { fetchImpl } = mockFetch({ workflow: {
    id: workflowId,
    path: '.github/workflows/verify.yml',
    state: 'disabled_manually',
  } })
  await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl }))
    .rejects.toThrow(/workflow identity/i)
})

test('rejects a completed run whose verify-required job is missing or unsuccessful', async () => {
  for (const jobs of [[], [successfulJob({ status: 'in_progress', conclusion: null })], [successfulJob({ conclusion: 'skipped' })]]) {
    const { fetchImpl } = mockFetch({ jobs })
    await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl }))
      .rejects.toThrow(/verify-required/i)
  }
})

test('ignores workflow runs for another SHA, workflow file, or branch', async () => {
  for (const run of [
    successfulRun({ head_sha: 'b'.repeat(40), run_number: 21 }),
    successfulRun({ workflow_id: workflowId + 1, run_number: 21 }),
    successfulRun({ path: '.github/workflows/other.yml', run_number: 21 }),
    successfulRun({ head_branch: 'feature/x', run_number: 21 }),
    successfulRun({ event: 'pull_request', run_number: 21 }),
  ]) {
    const { fetchImpl } = mockFetch({ runs: [run] })
    await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl }))
      .rejects.toThrow(/no matching verify workflow run/i)
  }
})

test('rejects HTTP failures without disclosing the token', async () => {
  const { fetchImpl } = mockFetch({ status: 403 })
  await expect(requireReleaseVerification({ repository, releaseSha, token: 'never-print-this', fetchImpl }))
    .rejects.toThrow(/GitHub API request failed.*403/i)
  await expect(requireReleaseVerification({ repository, releaseSha, token: 'never-print-this', fetchImpl }))
    .rejects.not.toThrow('never-print-this')
})

test('bounds a stalled GitHub API request and fails closed', async () => {
  const fetchImpl = (_input, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  await expect(requireReleaseVerification({
    repository,
    releaseSha,
    token: 'test-token',
    fetchImpl,
    timeoutMs: 5,
  })).rejects.toThrow(/request timed out/i)
})

test('validates repository, SHA, and token before making requests', async () => {
  const { fetchImpl, requests } = mockFetch()
  for (const options of [
    { repository: 'someone/else' },
    { releaseSha: 'A'.repeat(40) },
    { releaseSha: 'bad' },
    { token: '' },
  ]) {
    await expect(requireReleaseVerification({ repository, releaseSha, token: 'test-token', fetchImpl, ...options }))
      .rejects.toThrow()
  }
  expect(requests).toHaveLength(0)
})

test('Node CLI exits nonzero for missing token and rejected SHA input', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/require-release-verification.mjs', import.meta.url))
  const missingTokenEnv = {
    ...process.env,
    GITHUB_REPOSITORY: repository,
    RELEASE_SHA: releaseSha,
  }
  delete missingTokenEnv.GH_TOKEN
  delete missingTokenEnv.GITHUB_TOKEN

  const missingToken = spawnSync('node', [scriptPath], { env: missingTokenEnv, encoding: 'utf8' })
  expect(missingToken.error).toBeUndefined()
  expect(missingToken.status).toBe(1)
  expect(missingToken.stderr).toMatch(/GitHub API token is required/)

  const rejectedInput = spawnSync('node', [scriptPath], {
    env: { ...missingTokenEnv, RELEASE_SHA: 'not-a-sha', GITHUB_TOKEN: 'synthetic-token' },
    encoding: 'utf8',
  })
  expect(rejectedInput.error).toBeUndefined()
  expect(rejectedInput.status).toBe(1)
  expect(rejectedInput.stderr).toMatch(/RELEASE_SHA must be a 40-character lowercase SHA/)
})

test('runs the exact-SHA gate before the deploy job receives the production environment', () => {
  const workflow = readFileSync('.github/workflows/selectel-release.yml', 'utf8')
  const gateIndex = workflow.indexOf('require-release-verification.mjs')
  const environmentIndex = workflow.indexOf('environment:')
  const keyIndex = workflow.indexOf('secrets.SELECTEL_DEPLOY_SSH_PRIVATE_KEY')
  const sshIndex = workflow.match(/^\s+ssh\s*\\/m)?.index ?? -1

  expect(gateIndex).toBeGreaterThanOrEqual(0)
  expect(environmentIndex).toBeGreaterThan(gateIndex)
  expect(keyIndex).toBeGreaterThan(gateIndex)
  expect(sshIndex).toBeGreaterThan(gateIndex)
  expect(workflow).toMatch(/actions:\s*read/)
})

test('documents the exact-SHA verification prerequisite for owner-operated releases', () => {
  const deployment = readFileSync('docs/DEPLOYMENT.md', 'utf8')
  const runbook = readFileSync('deploy/selectel/README.md', 'utf8')
  expect(deployment).toMatch(/verify-required[\s\S]*exact SHA|exact SHA[\s\S]*verify-required/i)
  expect(runbook).toMatch(/verify-required[\s\S]*exact SHA|exact SHA[\s\S]*verify-required/i)
  expect(runbook).toMatch(/manual[\s\S]*bypass|owner[\s\S]*bypass/i)
})
