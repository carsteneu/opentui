/**
 * A module-level map to store debounce entries for all debounced functions
 * Structure: Map<scopeId, Map<debounceId, DebounceEntry>>
 */
const TIMERS_MAP = new Map<string | number, Map<string | number, DebounceEntry>>()

/**
 * Rejection reason when a debounced call is superseded by a newer call or
 * cleared before its callback ran. Typed so consumers can recognize a normal
 * supersede without treating it as a real failure.
 */
export class DebounceSupersededError extends Error {
  readonly code = "DEBOUNCE_SUPERSEDED"

  constructor() {
    super("Debounced call was superseded or cleared before it ran")
    this.name = "DebounceSupersededError"
  }
}

interface DebounceEntry {
  timerId: ReturnType<typeof setTimeout>
  /** Rejects the pending call once with DebounceSupersededError and cleans up. */
  cancel(): void
}

/**
 * Debounce controller that manages debounce instances for a specific scope
 */
export class DebounceController {
  constructor(private scopeId: string | number) {
    // Initialize the scope map if it doesn't exist
    if (!TIMERS_MAP.has(this.scopeId)) {
      TIMERS_MAP.set(this.scopeId, new Map())
    }
  }

  /**
   * Debounces the provided function with the given ID
   *
   * @param id Unique identifier within this scope
   * @param ms Milliseconds to wait before executing
   * @param fn Function to execute
   */
  debounce<R>(id: string | number, ms: number, fn: () => Promise<R>): Promise<R> {
    const scopeMap = TIMERS_MAP.get(this.scopeId)!

    // A newer call with the same id supersedes the pending one: settle it.
    const previous = scopeMap.get(id)
    if (previous) {
      previous.cancel()
    }

    return new Promise<R>((resolve, reject) => {
      let done = false
      let entry!: DebounceEntry

      // Idempotent settlement for every exit path: once finished, the timer is
      // cleared and the map entry removed so a late callback is a no-op.
      const finish = (run: () => void): void => {
        if (done) return
        done = true
        if (scopeMap.get(id) === entry) {
          scopeMap.delete(id)
        }
        clearTimeout(entry.timerId)
        run()
      }

      entry = {
        timerId: setTimeout(() => {
          finish(() => {
            try {
              resolve(fn())
            } catch (error) {
              reject(error)
            }
          })
        }, ms),
        cancel: () => finish(() => reject(new DebounceSupersededError())),
      }

      // Store the new timeout ID
      scopeMap.set(id, entry)
    })
  }

  /**
   * Clear a specific debounce timer in this scope
   *
   * @param id The debounce ID to clear
   */
  clearDebounce(id: string | number): void {
    const entry = TIMERS_MAP.get(this.scopeId)?.get(id)
    entry?.cancel()
  }

  /**
   * Clear all debounce timers in this scope
   */
  clear(): void {
    const scopeMap = TIMERS_MAP.get(this.scopeId)
    if (!scopeMap) return
    const entries = Array.from(scopeMap.values())
    scopeMap.clear()
    for (const entry of entries) {
      entry.cancel()
    }
  }
}

/**
 * Creates a new debounce controller for a specific scope
 *
 * @param scopeId Unique identifier for this debounce scope
 * @returns A DebounceController for the specified scope
 */
export function createDebounce(scopeId: string | number): DebounceController {
  return new DebounceController(scopeId)
}

/**
 * Clears all debounce timers for a specific scope
 *
 * @param scopeId The scope identifier
 */
export function clearDebounceScope(scopeId: string | number): void {
  const scopeMap = TIMERS_MAP.get(scopeId)
  if (!scopeMap) return
  const entries = Array.from(scopeMap.values())
  scopeMap.clear()
  for (const entry of entries) {
    entry.cancel()
  }
}

/**
 * Clears all active debounce timers across all scopes
 */
export function clearAllDebounces(): void {
  TIMERS_MAP.forEach((scopeMap) => {
    const entries = Array.from(scopeMap.values())
    scopeMap.clear()
    for (const entry of entries) {
      entry.cancel()
    }
  })
  TIMERS_MAP.clear()
}
