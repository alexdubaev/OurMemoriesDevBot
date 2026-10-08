import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiBase = 'https://api.github.com'
const expectedRepository = 'alexdubaev/OurMemoriesDevBot'
const expectedWorkflowPath = '.github/workflows/verify.yml'
const allowedEvents = new Set(['push', 'workflow_dispatch'])
const defaultTimeoutMs = 15_000

/**
 * Require the newest Verify workflow run for this exact release SHA to have
 * completed successfully, including its required aggregate job.
 */
export async function requireReleaseVerification({
  repository,
  releaseSha,
  token,
  fetchImpl = fetch,
  timeoutMs = defaultTimeoutMs,
}) {
  if (repository !== expectedRepository) throw new Error('GITHUB_REPOSITORY is not the canonical repository')
  if (typeof releaseSha !== 'string' || !/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error('RELEASE_SHA must be a 40-character lowercase SHA')
  }
  if (typeof token !== 'string' || token.trim() === '') throw new Error('GitHub API token is required')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('API timeout must be a positive integer')

  const workflow = await getJson(
    fetchImpl,
    `${apiBase}/repos/${repository}/actions/workflows/verify.yml`,
    token,
    timeoutMs,
  )
  if (!Number.isSafeInteger(workflow.id) || workflow.id <= 0 ||
      workflow.path !== expectedWorkflowPath || workflow.state !== 'active') {
    throw new Error('GitHub Verify workflow identity did not match verify.yml')
  }

  const runsUrl = new URL(`${apiBase}/repos/${repository}/actions/workflows/${workflow.id}/runs`)
  runsUrl.searchParams.set('head_sha', releaseSha)
  runsUrl.searchParams.set('branch', 'main')
  runsUrl.searchParams.set('per_page', '100')
  const runResponse = await getJson(fetchImpl, runsUrl.toString(), token, timeoutMs)
  if (!Array.isArray(runResponse.workflow_runs)) throw new Error('GitHub Verify workflow runs response was invalid')

  const matchingRuns = runResponse.workflow_runs
    .filter((run) => runMatches(run, { workflowId: workflow.id, releaseSha }))
    .sort(compareRunRecency)
  const run = matchingRuns[0]
  if (!run) throw new Error('No matching Verify workflow run was found for the exact SHA on main')
  if (run.status !== 'completed') {
    throw new Error(`The latest Verify workflow run is not completed (status: ${safeValue(run.status)})`)
  }
  if (run.conclusion !== 'success') {
    throw new Error(`The latest Verify workflow run is not successful (conclusion: ${safeValue(run.conclusion)})`)
  }

  const jobsUrl = `${apiBase}/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
  const jobResponse = await getJson(fetchImpl, jobsUrl, token, timeoutMs)
  if (!Array.isArray(jobResponse.jobs)) throw new Error('GitHub Verify jobs response was invalid')
  const requiredJobs = jobResponse.jobs.filter((job) => job.name === 'verify-required')
  if (requiredJobs.length !== 1) throw new Error('The latest Verify run is missing exactly one verify-required job')
  const job = requiredJobs[0]
  if (job.status !== 'completed' || job.conclusion !== 'success') {
    throw new Error('The verify-required job did not complete successfully')
  }

  return { runId: run.id, runAttempt: run.run_attempt, job: 'verify-required' }
}

function runMatches(run, { workflowId, releaseSha }) {
  return run &&
    run.workflow_id === workflowId &&
    run.path === expectedWorkflowPath &&
    run.head_sha === releaseSha &&
    run.head_branch === 'main' &&
    allowedEvents.has(run.event) &&
    Number.isSafeInteger(run.id) && run.id > 0 &&
    Number.isSafeInteger(run.run_number) && run.run_number > 0 &&
    Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0
}

function compareRunRecency(left, right) {
  return right.run_number - left.run_number ||
    right.run_attempt - left.run_attempt ||
    String(right.created_at ?? '').localeCompare(String(left.created_at ?? ''))
}

async function getJson(fetchImpl, url, token, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response || !response.ok) {
      const status = Number.isInteger(response?.status) ? response.status : 'unknown'
      throw new Error(`GitHub API request failed (HTTP ${status})`)
    }
    return await response.json()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('GitHub API request timed out')
    if (error instanceof Error && /^GitHub API request failed \(HTTP /.test(error.message)) throw error
    if (error instanceof SyntaxError) throw new Error('GitHub API returned invalid JSON')
    throw new Error('GitHub API request failed (network error)')
  } finally {
    clearTimeout(timeout)
  }
}

function safeValue(value) {
  return typeof value === 'string' && /^[a-z_]+$/.test(value) ? value : 'unknown'
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await requireReleaseVerification({
      repository: process.env.GITHUB_REPOSITORY,
      releaseSha: process.env.RELEASE_SHA,
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    })
    process.stdout.write(`Verified ${result.job} for run ${result.runId} attempt ${result.runAttempt}.\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Release verification failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
