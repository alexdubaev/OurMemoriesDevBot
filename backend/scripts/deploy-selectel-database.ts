import 'dotenv/config'

import { DatabaseDeploymentError, deployDatabase } from './deploy-database'

try {
  await deployDatabase(process.env, undefined, 'selectel-max-existing')
} catch (error) {
  const message = error instanceof DatabaseDeploymentError
    ? error.message
    : 'Selectel database preflight failed; inspect protected diagnostics before retrying.'
  console.error(message)
  process.exitCode = 1
}
