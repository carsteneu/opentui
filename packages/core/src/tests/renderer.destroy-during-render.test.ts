import { test, expect } from "bun:test"
import { Readable } from "node:stream"
import { Renderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

class DestroyingRenderable extends Renderable {
  protected renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {}
}

test("destroying renderer during frame callback should synchronously clean up terminal state", async () => {
  const rawModeCalls: boolean[] = []
  const stdin = new Readable({ read() {} }) as NodeJS.ReadStream & {
    setRawMode: (enabled: boolean) => NodeJS.ReadStream
  }
  stdin.setRawMode = (enabled) => {
    rawModeCalls.push(enabled)
    return stdin
  }

  const { renderer } = await createTestRenderer({ stdin })
  const lib = (renderer as any).lib as { suspendRenderer: (rendererPtr: unknown) => void }
  const originalSuspendRenderer = lib.suspendRenderer.bind(lib)
  let suspendCalls = 0
  let cleanupObserved = false

  lib.suspendRenderer = (rendererPtr: unknown) => {
    suspendCalls++
    originalSuspendRenderer(rendererPtr)
  }

  renderer.setFrameCallback(async () => {
    renderer.destroy()
    cleanupObserved = true

    expect(rawModeCalls.at(-1)).toBe(false)
    expect(suspendCalls).toBe(1)
  })

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(cleanupObserved).toBe(true)
})

test("destroying renderer during frame callback should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringRender = false

  renderer.setFrameCallback(async () => {
    destroyedDuringRender = true
    renderer.destroy()
  })

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringRender).toBe(true)

  // If we got here without a segfault, the test passes
})

test("destroying renderer during post-process should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringPostProcess = false

  renderer.addPostProcessFn(() => {
    destroyedDuringPostProcess = true
    renderer.destroy()
  })

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringPostProcess).toBe(true)

  // If we got here without a segfault, the test passes
})

test("destroying renderer during root render should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringRender = false

  // Override the root's render method to destroy the renderer
  const originalRender = renderer.root.render.bind(renderer.root)
  renderer.root.render = (buffer, deltaTime) => {
    originalRender(buffer, deltaTime)
    if (!destroyedDuringRender) {
      destroyedDuringRender = true
      renderer.destroy()
    }
  }

  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringRender).toBe(true)

  // If we got here without a segfault, the test passes
})

test("destroying renderer during requestAnimationFrame should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringAnimationFrame = false

  requestAnimationFrame(() => {
    destroyedDuringAnimationFrame = true
    renderer.destroy()
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringAnimationFrame).toBe(true)
})

test("destroying renderer during renderBefore should not crash", async () => {
  const { renderer } = await createTestRenderer({})

  let destroyedDuringRenderBefore = false

  const renderable = new DestroyingRenderable(renderer, {
    id: "destroy-render-before",
    width: 10,
    height: 1,
    renderBefore() {
      if (!destroyedDuringRenderBefore) {
        destroyedDuringRenderBefore = true
        renderer.destroy()
      }
    },
  })

  renderer.root.add(renderable)
  renderer.start()

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(destroyedDuringRenderBefore).toBe(true)
})

interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function silenceConsoleError<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  return fn().finally(() => {
    console.error = original
  })
}

// Loop A – G1: a frame callback that never resolves must not block destroy(),
// and late settlement must not commit native output or schedule follow-ups.

test("destroy() completes the lifecycle even when a frame callback never resolves", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})

  renderer.setFrameCallback(() => new Promise<void>(() => {})) // never settles

  const frame = renderOnce() // loop suspends on the hanging callback
  await Promise.resolve()

  renderer.destroy()

  await frame
  await renderer.idle()

  expect(renderer.isDestroyed).toBe(true)
  expect(renderer.isRunning).toBe(false)
  expect(renderer.getNativeStats().nativeFrameCount).toBe(0)
})

test("a frame callback that throws synchronously does not hang the loop", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})

  renderer.setFrameCallback(() => {
    throw new Error("sync boom")
  })

  await silenceConsoleError(() => renderOnce())

  expect(renderer.isDestroyed).toBe(false)
})

test("a frame callback that rejects asynchronously does not hang the loop", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})

  renderer.setFrameCallback(async () => {
    throw new Error("async boom")
  })

  await silenceConsoleError(() => renderOnce())

  expect(renderer.isDestroyed).toBe(false)
})

test("destroy() during a running frame callback completes the lifecycle", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})

  const gate = deferred<void>()
  renderer.setFrameCallback(async () => {
    renderer.destroy()
    gate.resolve()
  })

  const frame = renderOnce()
  await gate.promise
  await frame
  await renderer.idle()

  expect(renderer.isDestroyed).toBe(true)
  expect(renderer.isRunning).toBe(false)
})

test("removing a frame callback during iteration does not skip or double-run later callbacks", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})

  const calls: string[] = []
  const first = async () => {
    calls.push("a")
    renderer.removeFrameCallback(first)
  }
  const second = async () => {
    calls.push("b")
  }

  renderer.setFrameCallback(first)
  renderer.setFrameCallback(second)

  await renderOnce()

  expect(calls).toEqual(["a", "b"])
})

test("a frame callback settling after destroy triggers no native render or follow-up timer", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})

  const gate = deferred<void>()
  renderer.setFrameCallback(() => gate.promise)

  const frame = renderOnce()
  await Promise.resolve()

  renderer.destroy()
  const framesBeforeLateSettle = renderer.getNativeStats().nativeFrameCount

  gate.resolve() // settle well after destroy

  await frame
  await renderer.idle()

  expect(renderer.getNativeStats().nativeFrameCount).toBe(framesBeforeLateSettle)
  expect(renderer.getSchedulerState().hasScheduledRender).toBe(false)
  expect(renderer.isDestroyed).toBe(true)
})

test("two normal frame callbacks run strictly serially in registration order", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})

  const order: string[] = []
  const gate = deferred<void>()

  renderer.setFrameCallback(async () => {
    order.push("a:start")
    await gate.promise
    order.push("a:end")
  })
  renderer.setFrameCallback(async () => {
    order.push("b")
  })

  const frame = renderOnce()
  await Promise.resolve()

  expect(order).toEqual(["a:start"]) // second callback must wait for the first

  gate.resolve()
  await frame

  expect(order).toEqual(["a:start", "a:end", "b"])
})
