const apiCommand = /src[\\/]+index\.ts/i
const schedulerCommand = /src[\\/]+scheduler\.ts/i

export function inspectDevRuntimeProcesses({ processes, apiListenerProcessIds, viteProcessCount = 1 }) {
  const byId = new Map(processes.map((process) => [process.processId, process]))
  const apiProcesses = processes.filter((process) => apiCommand.test(process.commandLine ?? ''))
  const schedulerProcesses = processes.filter((process) => schedulerCommand.test(process.commandLine ?? ''))
  const apiRootProcessIds = logicalRootProcessIds(apiProcesses, byId, apiCommand)
  const schedulerRootProcessIds = logicalRootProcessIds(schedulerProcesses, byId, schedulerCommand)
  const apiTreeProcessIds = descendantsOf(apiRootProcessIds, byId)

  return {
    apiListenerBelongsToApiTree: apiListenerProcessIds.length === 1 && apiTreeProcessIds.has(apiListenerProcessIds[0]),
    apiListenerProcessIds,
    apiRootProcessIds,
    schedulerRootProcessIds,
    viteProcessCount,
  }
}

export function assertDevRuntimeProcesses(snapshot) {
  const report = inspectDevRuntimeProcesses(snapshot)
  if (report.apiListenerProcessIds.length !== 1) {
    throw new Error(`API port 3000 listener count is ${report.apiListenerProcessIds.length}, expected 1`)
  }
  if (report.apiRootProcessIds.length !== 1) {
    throw new Error(`API logical process tree count is ${report.apiRootProcessIds.length}, expected 1`)
  }
  if (!report.apiListenerBelongsToApiTree) {
    throw new Error('API port 3000 listener does not belong to the expected API process tree')
  }
  if (report.schedulerRootProcessIds.length !== 1) {
    throw new Error(`scheduler logical process tree count is ${report.schedulerRootProcessIds.length}, expected 1`)
  }
  if (report.viteProcessCount !== 1) {
    throw new Error(`Vite process count is ${report.viteProcessCount}, expected 1`)
  }
  return report
}

function logicalRootProcessIds(serviceProcesses, byId, matchesService) {
  const serviceIds = new Set(serviceProcesses.map((process) => process.processId))
  return serviceProcesses
    .filter((process) => {
      const parent = byId.get(process.parentProcessId)
      return !parent || !serviceIds.has(parent.processId) || !matchesService.test(parent.commandLine ?? '')
    })
    .map((process) => process.processId)
    .sort((left, right) => left - right)
}

function descendantsOf(rootProcessIds, byId) {
  const childrenByParent = new Map()
  for (const process of byId.values()) {
    const children = childrenByParent.get(process.parentProcessId) ?? []
    children.push(process.processId)
    childrenByParent.set(process.parentProcessId, children)
  }

  const descendants = new Set(rootProcessIds)
  const pending = [...rootProcessIds]
  while (pending.length > 0) {
    const processId = pending.pop()
    for (const childId of childrenByParent.get(processId) ?? []) {
      if (descendants.has(childId)) continue
      descendants.add(childId)
      pending.push(childId)
    }
  }
  return descendants
}
