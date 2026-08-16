import { expect, test } from "bun:test"

import {
  createDebounce,
  clearDebounceScope,
  clearAllDebounces,
  DebounceController,
  DebounceSupersededError,
} from "./debounce.js"

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )

const expectSuperseded = <T>(result: Settled<T>): void => {
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBeInstanceOf(DebounceSupersededError)
}

test("second call with the same id settles the first promise as superseded", async () => {
  clearAllDebounces()
  const controller: DebounceController = createDebounce("supersede")
  const first = settle(controller.debounce("a", 50, async () => "first"))
  const second = settle(controller.debounce("a", 50, async () => "second"))

  expectSuperseded(await first)
  clearDebounceScope("supersede")
  expectSuperseded(await second)
})

test("clearDebounce settles the open promise", async () => {
  clearAllDebounces()
  const controller = createDebounce("clear-one")
  const pending = settle(controller.debounce("a", 50, async () => "value"))

  controller.clearDebounce("a")

  expectSuperseded(await pending)
  clearDebounceScope("clear-one")
})

test("clear settles all open promises in the scope", async () => {
  clearAllDebounces()
  const controller = createDebounce("clear-scope")
  const first = settle(controller.debounce("a", 50, async () => 1))
  const second = settle(controller.debounce("b", 50, async () => 2))

  controller.clear()

  expectSuperseded(await first)
  expectSuperseded(await second)
})

test("clearDebounceScope settles open promises for the scope", async () => {
  clearAllDebounces()
  const controller = createDebounce("clear-module-scope")
  const pending = settle(controller.debounce("a", 50, async () => "x"))

  clearDebounceScope("clear-module-scope")

  expectSuperseded(await pending)
})

test("clearAllDebounces settles open promises across all scopes", async () => {
  clearAllDebounces()
  const one = createDebounce("clear-global-1")
  const two = createDebounce("clear-global-2")
  const first = settle(one.debounce("a", 50, async () => 1))
  const second = settle(two.debounce("b", 50, async () => 2))

  clearAllDebounces()

  expectSuperseded(await first)
  expectSuperseded(await second)
})

test("callback success resolves the debounce promise exactly once", async () => {
  clearAllDebounces()
  const controller = createDebounce("resolve-once")
  const pending = settle(controller.debounce("a", 1, async () => 42))

  const result = await pending
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.value).toBe(42)
  }
  clearDebounceScope("resolve-once")
})

test("callback rejection rejects the debounce promise exactly once", async () => {
  clearAllDebounces()
  const controller = createDebounce("reject-once")
  const pending = settle(
    controller.debounce("a", 1, async () => {
      throw new Error("boom")
    }),
  )

  const result = await pending
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect((result.error as Error).message).toBe("boom")
  }
  clearDebounceScope("reject-once")
})
