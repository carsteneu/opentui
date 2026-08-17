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
}

const integrationState = singleton<RendererIntegrationState>("RendererOptionalIntegrations", () => ({
  console: null,
  lastDestroyCleanups: new Map(),
}))

export function getRendererConsoleIntegration(): RendererConsoleIntegration | null {
  return integrationState.console
}

export function registerRendererConsoleIntegration(integration: RendererConsoleIntegration): () => void {
  const previous = integrationState.console
  integrationState.console = integration

  return () => {
    if (integrationState.console === integration) integrationState.console = previous
  }
}

export function getRendererLastDestroyCleanups(): RendererLastDestroyCleanup[] {
  return [...integrationState.lastDestroyCleanups.values()]
}

export function registerRendererLastDestroyCleanup(cleanup: RendererLastDestroyCleanup): () => void {
  const previous = integrationState.lastDestroyCleanups.get(cleanup.id)
  integrationState.lastDestroyCleanups.set(cleanup.id, cleanup)

  return () => {
    if (integrationState.lastDestroyCleanups.get(cleanup.id) !== cleanup) return
    if (previous) integrationState.lastDestroyCleanups.set(cleanup.id, previous)
    else integrationState.lastDestroyCleanups.delete(cleanup.id)
  }
}
