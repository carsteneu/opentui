import type { ConsoleOptions, TerminalConsole } from "./console.js"
import type { Clock } from "./lib/clock.js"
import { singleton } from "./lib/singleton.js"
import type { CliRenderer } from "./renderer.js"

export interface RendererConsoleIntegration {
  create(renderer: CliRenderer, options: ConsoleOptions & { clock: Clock }): TerminalConsole
  claimCapturedOutput(): string
}

export interface RendererLastDestroyCleanup {
  id: string
  description: string
  run(): void | Promise<void>
}

interface RendererIntegrationState {
  console: RendererConsoleIntegration | null
  lastDestroyCleanups: Map<string, RendererLastDestroyCleanup>
  consoleOwners?: IntegrationOwner<RendererConsoleIntegration>[]
  lastDestroyCleanupOwners?: Map<string, IntegrationOwner<RendererLastDestroyCleanup>[]>
}

interface IntegrationOwner<T> {
  value: T
}

const integrationState = singleton<RendererIntegrationState>("RendererOptionalIntegrations", () => ({
  console: null,
  lastDestroyCleanups: new Map(),
}))

export function getRendererConsoleIntegration(): RendererConsoleIntegration | null {
  return integrationState.console
}

export function registerRendererConsoleIntegration(integration: RendererConsoleIntegration): () => void {
  const owners = (integrationState.consoleOwners ??= integrationState.console
    ? [{ value: integrationState.console }]
    : [])
  const owner = { value: integration }
  owners.push(owner)
  integrationState.console = integration

  return () => {
    const ownerIndex = owners.indexOf(owner)
    if (ownerIndex === -1) return

    owners.splice(ownerIndex, 1)
    integrationState.console = owners.at(-1)?.value ?? null
  }
}

export function getRendererLastDestroyCleanups(): RendererLastDestroyCleanup[] {
  return [...integrationState.lastDestroyCleanups.values()]
}

export function registerRendererLastDestroyCleanup(cleanup: RendererLastDestroyCleanup): () => void {
  const ownersById = (integrationState.lastDestroyCleanupOwners ??= new Map())
  let owners = ownersById.get(cleanup.id)
  if (!owners) {
    const current = integrationState.lastDestroyCleanups.get(cleanup.id)
    owners = current ? [{ value: current }] : []
    ownersById.set(cleanup.id, owners)
  }

  const owner = { value: cleanup }
  owners.push(owner)
  integrationState.lastDestroyCleanups.set(cleanup.id, cleanup)

  return () => {
    const ownerIndex = owners.indexOf(owner)
    if (ownerIndex === -1) return

    owners.splice(ownerIndex, 1)
    const activeOwner = owners.at(-1)
    if (activeOwner) integrationState.lastDestroyCleanups.set(cleanup.id, activeOwner.value)
    else {
      ownersById.delete(cleanup.id)
      integrationState.lastDestroyCleanups.delete(cleanup.id)
    }
  }
}
