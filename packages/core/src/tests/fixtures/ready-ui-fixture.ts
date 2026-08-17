import type { CliRenderer } from "../../renderer.js"
import { createRendererReady, type RendererReadyHandle } from "../../renderer-ready.js"
import { TextRenderable } from "../../renderables/Text.js"
import { createTestRenderer, type TestRendererSetup } from "../../testing.js"

/**
 * A controlled stand-in for a lazily loaded optional subsystem (a fake dynamic
 * `import()`). It models the OpenTUI seam only: a promise the consumer resolves
 * or rejects with its own optional tooling. No real network or OpenCode
 * dependency.
 */
export interface FakeDynamicLoader<T = unknown> {
  readonly started: boolean
  /** Returns the (still pending) optional load promise. */
  start(): Promise<T>
  settleOk(value: T): void
  settleFail(error: unknown): void
}

export function createFakeDynamicLoader<T = unknown>(): FakeDynamicLoader<T> {
  let started = false
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Unobserved rejections must not surface as unhandled when a fixture settles
  // the optional load as failed without anyone awaiting the raw promise.
  promise.catch(() => {})
  return {
    get started() {
      return started
    },
    start() {
      started = true
      return promise
    },
    settleOk(value) {
      resolve(value)
    },
    settleFail(error) {
      reject(error)
    },
  }
}

/** Reference fixture: commit a functional base surface, then load optional work. */
export interface ReadyUiFixture {
  renderer: CliRenderer
  ready: RendererReadyHandle
  loader: FakeDynamicLoader<string>
  renderOnce: () => Promise<void>
  renderText: (text: string) => TextRenderable
  mockInput: TestRendererSetup["mockInput"]
  mockMouse: TestRendererSetup["mockMouse"]
}

export async function createReadyUiFixture(): Promise<ReadyUiFixture> {
  const setup = await createTestRenderer({})
  const ready = createRendererReady(setup.renderer)
  const loader = createFakeDynamicLoader<string>()

  return {
    renderer: setup.renderer,
    ready,
    loader,
    renderOnce: setup.renderOnce,
    renderText(text) {
      const item = new TextRenderable(setup.renderer, { id: `base-${text}` })
      item.add(text)
      setup.renderer.root.add(item)
      return item
    },
    mockInput: setup.mockInput,
    mockMouse: setup.mockMouse,
  }
}
