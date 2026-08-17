import { expect, test } from "bun:test"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { CliRenderEvents } from "../renderer.js"
import { createRendererReady, RendererReadyDestroyedError, RendererReadyError } from "../renderer-ready.js"
import { createTestRenderer } from "../testing.js"
import type { RenderContext } from "../types.js"
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

class ThrowingRenderable extends Renderable {
  public shouldThrow = false

  constructor(ctx: RenderContext, options: RenderableOptions, private readonly error: unknown = new Error("render failed")) {
    super(ctx, options)
  }

  protected renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {
    if (this.shouldThrow) throw this.error
  }
}

function baselineListenerCount(renderer: { listenerCount: (e: string) => number }) {
  return {
    frame: renderer.listenerCount(CliRenderEvents.FRAME),
    renderError: renderer.listenerCount(CliRenderEvents.RENDER_ERROR),
    destroy: renderer.listenerCount(CliRenderEvents.DESTROY),
  }
}

test("first-frame waiter resolves only after a real successful native commit", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})
  const ready = createRendererReady(renderer)

  try {
    let resolved = false
    ready.firstFrameCommitted.then(() => (resolved = true))
    await flushMicrotasks()
    expect(ready.state.firstFrameCommitted).toBe(false)
    expect(resolved).toBe(false)

    await renderOnce()

    await ready.firstFrameCommitted
    expect(resolved).toBe(true)
    expect(ready.state.firstFrameCommitted).toBe(true)
  } finally {
    ready.destroy()
    renderer.destroy()
  }
})

test("multiple first-frame waiters resolve exactly once in stable order", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})
  const ready = createRendererReady(renderer)

  try {
    const order: string[] = []
    let a = 0
    let b = 0
    ready.firstFrameCommitted.then(() => {
      a++
      order.push("a")
    })
    ready.firstFrameCommitted.then(() => {
      b++
      order.push("b")
    })

    await renderOnce()
    await flushMicrotasks()

    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(order).toEqual(["a", "b"])
  } finally {
    ready.destroy()
    renderer.destroy()
  }
})

test("early render error rejects waiters with a defined error; no promise hangs open", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ openConsoleOnError: false })
  const ready = createRendererReady(renderer)

  try {
    const target = new ThrowingRenderable(renderer, { width: 1, height: 1 }, new Error("boom"))
    target.shouldThrow = true
    renderer.root.add(target)

    const rejection = ready.firstFrameCommitted.catch((e: unknown) => e)
    await renderOnce()
    const caught = await rejection

    expect(caught).toBeInstanceOf(RendererReadyError)
    expect((caught as Error).message).toBe("boom")
    expect(ready.state.firstFrameCommitted).toBe(false)
    expect(ready.state.failed).toBe(true)
  } finally {
    ready.destroy()
    renderer.destroy()
  }
})

test("destroy before first frame ends waiters defined: rejects, no hang, no listener leak", async () => {
  const { renderer } = await createTestRenderer({})
  const before = baselineListenerCount(renderer)
  const ready = createRendererReady(renderer)
  expect(baselineListenerCount(renderer).frame).toBe(before.frame + 1)

  const rejection = ready.firstFrameCommitted.catch((e: unknown) => e)
  renderer.destroy()
  const caught = await rejection

  expect(caught).toBeInstanceOf(RendererReadyDestroyedError)
  expect(ready.state.destroyed).toBe(true)
  // The helper's own FRAME/RENDER_ERROR hooks are gone (no churn on these).
  const after = baselineListenerCount(renderer)
  expect(after.frame).toBe(before.frame)
  expect(after.renderError).toBe(before.renderError)
  // DESTROY: the helper added and removed one; the test harness may also have
  // consumed its own one-shot DESTROY listener, so only assert no extra is left.
  expect(after.destroy).toBeLessThanOrEqual(before.destroy)
})

test("enhanced work can only begin after the base frame is committed", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})
  const ready = createRendererReady(renderer)

  try {
    ready.markEnhancedReady()
    let settled = false
    ready.enhancedSettled.then(() => (settled = true))
    await flushMicrotasks()

    // Even though marked, enhanced is gated on the base frame.
    expect(settled).toBe(false)
    expect(ready.state.enhanced).toBe("pending")

    await renderOnce()
    await ready.enhancedSettled

    expect(settled).toBe(true)
    expect(ready.state.enhanced).toBe("ok")
  } finally {
    ready.destroy()
    renderer.destroy()
  }
})

test("an optional-extension error does not undo a visible base frame", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})
  const ready = createRendererReady(renderer)

  try {
    await renderOnce()
    await ready.firstFrameCommitted

    const boom = new Error("optional failed")
    ready.markEnhancedFailed(boom)
    const outcome = await ready.enhancedSettled

    expect(outcome).toEqual({ ok: false, error: boom })
    expect(ready.state.firstFrameCommitted).toBe(true)
    expect(ready.state.enhanced).toBe("failed")
  } finally {
    renderer.destroy()
  }
})

test("application ready is consumer-marked and resolves after the base frame", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})
  const ready = createRendererReady(renderer)

  try {
    ready.markApplicationReady()
    let resolved = false
    ready.applicationReady.then(() => (resolved = true))
    await flushMicrotasks()
    expect(resolved).toBe(false)

    await renderOnce()
    await ready.applicationReady
    expect(resolved).toBe(true)
    expect(ready.state.applicationReady).toBe(true)
  } finally {
    ready.destroy()
    renderer.destroy()
  }
})

test("first frame is not blocked by pending optional/capability work", async () => {
  const { renderer, renderOnce } = await createTestRenderer({})
  const ready = createRendererReady(renderer)

  try {
    // Parallel optional/capability work with a long (or infinite) timeout is
    // started but not yet marked complete. It must not gate the first-frame path.
    const slowOptional = new Promise<void>(() => {})
    const slow = slowOptional.catch(() => {})

    await renderOnce()
    await Promise.race([ready.firstFrameCommitted, slow])

    expect(ready.state.firstFrameCommitted).toBe(true)
    // Enhanced is still pending (consumer has not finished) and first frame is done.
    expect(ready.state.enhanced).toBe("pending")
  } finally {
    ready.destroy()
    renderer.destroy()
  }
})

test("a render error after the base frame does not undo readiness or consumer milestones", async () => {
  const { renderer, renderOnce } = await createTestRenderer({ openConsoleOnError: false })
  const ready = createRendererReady(renderer)

  try {
    const target = new ThrowingRenderable(renderer, { width: 1, height: 1 }, new Error("later"))
    target.shouldThrow = false
    renderer.root.add(target)

    await renderOnce()
    await ready.firstFrameCommitted

    // A later render error (after the base surface is committed) is the app's
    // concern, not readiness: firstFrame stays resolved and an unmarked
    // enhanced waiter is not rejected.
    const settled = { enhanced: false }
    ready.enhancedSettled
      .then(() => (settled.enhanced = true))
      .catch(() => (settled.enhanced = true))
    // Test-owned listener keeps the render error "handled" (the helper's own
    // RENDER_ERROR hook is gone after the base frame).
    renderer.on(CliRenderEvents.RENDER_ERROR, () => {})
    target.shouldThrow = true
    await renderOnce()

    expect(ready.state.firstFrameCommitted).toBe(true)
    expect(ready.state.enhanced).toBe("pending")
    await flushMicrotasks()
    expect(settled.enhanced).toBe(false)

    // The consumer can still complete enhanced afterwards.
    ready.markEnhancedReady()
    await ready.enhancedSettled
    expect(ready.state.enhanced).toBe("ok")
  } finally {
    ready.destroy()
    renderer.destroy()
  }
})

test("destroy() is idempotent and safe to call more than once", async () => {
  const { renderer } = await createTestRenderer({})
  const ready = createRendererReady(renderer)

  const rejection = ready.firstFrameCommitted.catch((e: unknown) => e)
  ready.destroy()
  ready.destroy()
  ready.destroy()

  expect(ready.state.destroyed).toBe(true)
  expect(await rejection).toBeInstanceOf(RendererReadyDestroyedError)
  renderer.destroy()
})
