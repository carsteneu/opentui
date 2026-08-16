import { test, expect, afterEach } from "bun:test"
import { createCliRenderer, CliRenderer } from "../renderer.js"
import { NativeSpanFeed } from "../NativeSpanFeed.js"
import { createTestStdin, TestWriteStream } from "../testing/test-streams.js"
import type { ManualClock } from "../testing/manual-clock.js"

// Controllable Writable used as a mock stdout. It drives the renderer's
// feed→Writable bridge (the feed data handler calls stdout.write and settles
// the pinned chunk when the write callback fires). Modes let a test simulate
// a misbehaving/unreliable custom sink.
type WriteMode = "normal" | "never-callback" | "late-callback" | "sync-throw" | "error" | "close" | "finish"

class ControlledWritable extends TestWriteStream {
  public mode: WriteMode = "normal"
  public readonly pushes: Buffer[] = []
  public callbackDelayMs = 0
  private callbackIndex = 0

  override _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    // Keep a private copy so reads after teardown are safe and don't alias the
    // renderer's owned copy (must remain valid even after the renderer frees
    // its native chunk).
    const buf = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk.slice())
    this.pushes.push(buf)

    switch (this.mode) {
      case "sync-throw":
        throw new Error(`simulated sync write failure: ${buf.toString("binary").slice(0, 16)}`)
      case "never-callback":
        // Never invoke the callback: chunk stays pinned forever unless the
        // renderer bounds the write through a terminal event or destroy.
        return
      case "late-callback": {
        const idx = this.callbackIndex++
        if (this.callbackDelayMs > 0) {
          setTimeout(() => callback(), this.callbackDelayMs)
        } else {
          queueMicrotask(() => callback())
        }
        if (idx === 0) return
        return
      }
      case "error":
        // Emit the terminal event directly without invoking the write callback
        // — an unreliable sink that reports failure but never settles the write.
        this.emit("error", new Error("simulated sink error"))
        return
      case "close":
        this.emit("close")
        return
      case "finish":
        this.emit("finish")
        return
      case "normal":
      default:
        if (this.callbackDelayMs > 0) {
          setTimeout(callback, this.callbackDelayMs)
        } else {
          queueMicrotask(callback)
        }
        return
    }
  }
}

function createControlledStdout(columns = 80, rows = 24): ControlledWritable {
  return new ControlledWritable(columns, rows)
}

let destroyFns: Array<() => void> = []

function registerRenderer(renderer: CliRenderer): void {
  destroyFns.push(() => {
    try {
      renderer.destroy()
    } catch {
      /* teardown */
    }
  })
}

afterEach(() => {
  for (const fn of destroyFns) {
    try {
      fn()
    } catch {
      /* cleanup */
    }
  }
  destroyFns = []
})

async function createRenderer(stdout: ControlledWritable): Promise<{ renderer: CliRenderer; feed: NativeSpanFeed }> {
  const renderer = await createCliRenderer({
    stdin: createTestStdin(),
    stdout,
    consoleMode: "disabled",
  } as any)
  registerRenderer(renderer)
  const feed = (renderer as any)._feed as NativeSpanFeed
  expect(feed).not.toBeNull()
  await feed.idle()
  stdout.pushes.length = 0
  return { renderer, feed }
}

// Pump the event loop a few macrotask turns without depending on wall-clock.
async function settleTurns(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

// ---- Writable-fake lifecycle cases (plan 5.2) ----

test("never-called write callback still lets destroy bound the feed (no pending close)", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  // Switch the sink to a misbehaving mode AFTER construction so the renderer's
  // own init writes settle and the harness's feed.idle() can complete.
  stdout.mode = "never-callback"

  renderer.setTerminalTitle("pin-forever")
  await settleTurns()

  // A never-settling write must pin the chunk (backpressure) but must NOT stop
  // destroy from reaching the feed's terminal state.
  expect((feed as any).destroyed).toBe(false)

  renderer.destroy()
  await settleTurns()

  expect((feed as any).destroyed).toBe(true)
  expect(feed.isBackpressured()).toBe(false)
})

test("write callback firing after close/destroy is harmless (idempotent settlement)", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  stdout.mode = "late-callback"
  stdout.callbackDelayMs = 1

  renderer.setTerminalTitle("late")
  await settleTurns()

  renderer.destroy()
  await settleTurns()

  // Terminal state reached despite the still-in-flight (or never-firing) write.
  expect((feed as any).destroyed).toBe(true)
})

test("sync _write throw does not skip the refcount/close path", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  stdout.mode = "sync-throw"

  renderer.setTerminalTitle("boom")
  await settleTurns()

  renderer.destroy()
  await settleTurns()

  expect((feed as any).destroyed).toBe(true)
  expect(feed.isBackpressured()).toBe(false)
})

test("sink error settles the pinned write and bounds teardown", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  stdout.mode = "error"
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => errors.push(args)

  try {
    renderer.setTerminalTitle("err")
    await settleTurns()

    renderer.destroy()
    await settleTurns()
  } finally {
    console.error = originalError
  }

  expect((feed as any).destroyed).toBe(true)
  expect(feed.isBackpressured()).toBe(false)
  expect(errors.flat().join(" ")).toContain("simulated sink error")
})

test("sink close during a pinned write bounds teardown", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  stdout.mode = "close"

  renderer.setTerminalTitle("close-during-pin")
  await settleTurns()

  renderer.destroy()
  await settleTurns()

  expect((feed as any).destroyed).toBe(true)
  expect(feed.isBackpressured()).toBe(false)
})

test("sink finish during a pinned write bounds teardown", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  stdout.mode = "finish"

  renderer.setTerminalTitle("finish-during-pin")
  await settleTurns()

  renderer.destroy()
  await settleTurns()

  expect((feed as any).destroyed).toBe(true)
  expect(feed.isBackpressured()).toBe(false)
})

test("error + later write callback on the same open write settles exactly once", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)

  renderer.setTerminalTitle("once")
  // Both a terminal event and a later callback target the same open write.
  stdout.emit("error", new Error("terminal plus late callback"))
  await settleTurns()

  renderer.destroy()
  await settleTurns()

  expect((feed as any).destroyed).toBe(true)
  expect(feed.isBackpressured()).toBe(false)
})

test("repeated close/destroy stays idempotent", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)

  renderer.destroy()
  await settleTurns()
  renderer.destroy()
  await settleTurns()

  expect((feed as any).destroyed).toBe(true)
  expect((renderer as any)._isDestroyed).toBe(true)
})

test("renderer destroy during a pinned chunk completes teardown", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  stdout.mode = "never-callback"

  renderer.setTerminalTitle("pin-during-destroy")
  await settleTurns()
  expect((feed as any).destroyed).toBe(false)

  renderer.destroy()
  await settleTurns()

  expect((feed as any).destroyed).toBe(true)
  expect(feed.isBackpressured()).toBe(false)
})

test("new writes are not scheduled after the sink reaches a terminal state", async () => {
  const stdout = createControlledStdout()
  const { renderer, feed } = await createRenderer(stdout)
  stdout.mode = "never-callback"

  renderer.setTerminalTitle("first")
  await settleTurns()
  const pushesAfterFirst = stdout.pushes.length

  renderer.destroy()
  await settleTurns()

  // No additional sink writes after the renderer teardown began.
  expect(stdout.pushes.length).toBe(pushesAfterFirst)
  expect((feed as any).destroyed).toBe(true)
})

// ---- Feed-level idempotency ----

test("feed.close is idempotent under repeated close", () => {
  const feed = NativeSpanFeed.create({ chunkSize: 64, initialChunks: 1 })
  feed.close()
  feed.close()
  expect((feed as any).destroyed).toBe(true)
})
