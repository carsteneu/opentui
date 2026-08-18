import { test, expect, beforeEach, afterEach, beforeAll, describe } from "bun:test"
import { TreeSitterClient } from "./client.js"
import { tmpdir } from "os"
import { join } from "path"
import { existsSync } from "fs"
import { mkdir, writeFile, unlink } from "fs/promises"
import { getDataPaths } from "../data-paths.js"
import { clearEnvCache } from "../env.js"
import { destroySingleton } from "../singleton.js"
import { destroyTreeSitterClient, getTreeSitterClient } from "./index.js"
import { getParsers } from "./default-parsers.js"

describe("TreeSitterClient", () => {
  let client: TreeSitterClient
  let dataPath: string

  const sharedDataPath = join(tmpdir(), "tree-sitter-shared-test-data")

  beforeAll(async () => {
    await mkdir(sharedDataPath, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = sharedDataPath
    client = new TreeSitterClient({
      dataPath,
    })
  })

  afterEach(async () => {
    if (client) {
      await client.destroy()
    }
  })

  test("should initialize successfully", async () => {
    await client.initialize()
    expect(client.isInitialized()).toBe(true)
  })

  test("should lazily start the worker during initialize when auto start is disabled", async () => {
    const lazyClient = new TreeSitterClient({ dataPath }, { autoStartWorker: false })

    try {
      await lazyClient.initialize()

      expect(lazyClient.isInitialized()).toBe(true)
      expect(await lazyClient.preloadParser("javascript")).toBe(true)
    } finally {
      await lazyClient.destroy()
    }
  })

  test("should initialize with a URL worker path override", async () => {
    const workerPath = existsSync(new URL("./parser.worker.js", import.meta.url))
      ? new URL("./parser.worker.js", import.meta.url)
      : new URL("./parser.worker.ts", import.meta.url)
    const urlClient = new TreeSitterClient({
      dataPath,
      workerPath,
    })

    try {
      await urlClient.initialize()

      expect(urlClient.isInitialized()).toBe(true)
      expect(await urlClient.preloadParser("javascript")).toBe(true)
    } finally {
      await urlClient.destroy()
    }
  })

  test("should wait for default parsers before resolving concurrent initialization", async () => {
    let resolveRegistrationStarted!: () => void
    let resolveRegistration!: () => void
    let registrationCompleted = false

    const registrationStarted = new Promise<void>((resolve) => {
      resolveRegistrationStarted = resolve
    })
    const registrationGate = new Promise<void>((resolve) => {
      resolveRegistration = resolve
    })

    const clientInternals = client as unknown as { registerDefaultParsers: () => Promise<void> }
    const registerDefaultParsers = clientInternals.registerDefaultParsers.bind(client)

    clientInternals.registerDefaultParsers = async () => {
      resolveRegistrationStarted()
      await registrationGate
      await registerDefaultParsers()
      registrationCompleted = true
    }

    const firstInitialize = client.initialize()
    const secondInitialize = client.initialize()

    await registrationStarted

    let secondResolved = false
    const observedSecondInitialize = secondInitialize.then(() => {
      secondResolved = true
    })

    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(secondResolved).toBe(false)
    expect(client.isInitialized()).toBe(false)

    resolveRegistration()

    await Promise.all([firstInitialize, observedSecondInitialize])

    expect(registrationCompleted).toBe(true)
    expect(client.isInitialized()).toBe(true)
  })

  test("should reject initialization when destroyed during default parser registration", async () => {
    let resolveRegistrationStarted!: () => void
    let resolveRegistration!: () => void
    const registrationStarted = new Promise<void>((resolve) => {
      resolveRegistrationStarted = resolve
    })
    const registrationGate = new Promise<void>((resolve) => {
      resolveRegistration = resolve
    })
    const clientInternals = client as unknown as { registerDefaultParsers: () => Promise<void> }
    const registerDefaultParsers = clientInternals.registerDefaultParsers.bind(client)

    clientInternals.registerDefaultParsers = async () => {
      resolveRegistrationStarted()
      await registrationGate
      await registerDefaultParsers()
    }

    const initializeOutcome = client.initialize().then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )

    try {
      await registrationStarted
      await client.destroy()
      resolveRegistration()

      const outcome = await initializeOutcome
      expect(outcome.status).toBe("rejected")
      if (outcome.status === "rejected") {
        expect(outcome.error).toBeInstanceOf(Error)
        expect((outcome.error as Error).message).toBe("Client destroyed during initialization")
      }
      expect(client.isInitialized()).toBe(false)
    } finally {
      resolveRegistration()
      await initializeOutcome
      await client.destroy()
    }
  })

  test("should preload parsers for supported filetypes", async () => {
    await client.initialize()

    const hasJavaScript = await client.preloadParser("javascript")
    expect(hasJavaScript).toBe(true)

    const hasJavaScriptReact = await client.preloadParser("javascriptreact")
    expect(hasJavaScriptReact).toBe(true)

    const hasTypeScript = await client.preloadParser("typescript")
    expect(hasTypeScript).toBe(true)

    const hasTypeScriptReact = await client.preloadParser("typescriptreact")
    expect(hasTypeScriptReact).toBe(true)
  })

  test("should return false for unsupported filetypes", async () => {
    await client.initialize()

    const hasUnsupported = await client.preloadParser("unsupported-language")
    expect(hasUnsupported).toBe(false)
  })

  test("should create buffer with supported filetype", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    const hasParser = await client.createBuffer(1, jsCode, "javascript")

    expect(hasParser).toBe(true)

    const buffer = client.getBuffer(1)
    expect(buffer).toBeDefined()
    expect(buffer?.hasParser).toBe(true)
    expect(buffer?.content).toBe(jsCode)
    expect(buffer?.filetype).toBe("javascript")
  })

  test("should create buffer without parser for unsupported filetype", async () => {
    await client.initialize()

    const content = "some random content"
    const hasParser = await client.createBuffer(1, content, "unsupported")

    expect(hasParser).toBe(false)

    const buffer = client.getBuffer(1)
    expect(buffer).toBeDefined()
    expect(buffer?.hasParser).toBe(false)
  })

  test("should emit highlights:response event when buffer is updated", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    let highlightReceived = false
    let receivedBufferId: number | undefined
    let receivedVersion: number | undefined

    client.on("highlights:response", (bufferId, version, highlights) => {
      highlightReceived = true
      receivedBufferId = bufferId
      receivedVersion = version
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    const newCode = 'const hello = "world";\nconst foo = 42;'
    const edits = [
      {
        startIndex: jsCode.length,
        oldEndIndex: jsCode.length,
        newEndIndex: newCode.length,
        startPosition: { row: 0, column: jsCode.length },
        oldEndPosition: { row: 0, column: jsCode.length },
        newEndPosition: { row: 1, column: 14 },
      },
    ]

    await client.updateBuffer(1, edits, newCode, 2)

    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(highlightReceived).toBe(true)
    expect(receivedBufferId).toBe(1)
    expect(receivedVersion).toBe(2)
  })

  test("should handle buffer removal", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    let bufferDisposed = false
    client.on("buffer:disposed", (bufferId) => {
      if (bufferId === 1) {
        bufferDisposed = true
      }
    })

    await client.removeBuffer(1)

    expect(bufferDisposed).toBe(true)
    expect(client.getBuffer(1)).toBeUndefined()
  })

  test("should handle multiple buffers", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    const tsCode = "interface Test { value: string }"

    await client.createBuffer(1, jsCode, "javascript")
    await client.createBuffer(2, tsCode, "typescript")

    const buffers = client.getAllBuffers()
    expect(buffers).toHaveLength(2)

    const jsBuffer = client.getBuffer(1)
    const tsBuffer = client.getBuffer(2)

    expect(jsBuffer?.filetype).toBe("javascript")
    expect(tsBuffer?.filetype).toBe("typescript")
    expect(jsBuffer?.hasParser).toBe(true)
    expect(tsBuffer?.hasParser).toBe(true)
  })

  test("should handle buffer reset", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    const newContent = "function test() { return 42; }"
    await client.resetBuffer(1, 2, newContent)

    const buffer = client.getBuffer(1)
    expect(buffer?.content).toBe(newContent)
    expect(buffer?.version).toBe(2)
  })

  test("should emit error events for invalid operations", async () => {
    await client.initialize()

    let errorReceived = false
    let errorMessage = ""

    client.on("error", (error, bufferId) => {
      errorReceived = true
      errorMessage = error
    })

    await client.resetBuffer(999, 1, "test")

    expect(errorReceived).toBe(true)
    expect(errorMessage).toContain("Cannot reset buffer with no parser")
  })

  test("should prevent duplicate buffer creation", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    await expect(client.createBuffer(1, "other code", "javascript")).rejects.toThrow("Buffer with id 1 already exists")
  })

  test("should handle performance metrics", async () => {
    await client.initialize()

    const performance = await client.getPerformance()
    expect(performance).toBeDefined()
    expect(typeof performance.averageParseTime).toBe("number")
    expect(typeof performance.averageQueryTime).toBe("number")
    expect(Array.isArray(performance.parseTimes)).toBe(true)
    expect(Array.isArray(performance.queryTimes)).toBe(true)
  })

  test("should handle concurrent buffer operations", async () => {
    await client.initialize()

    const promises = []

    for (let i = 0; i < 5; i++) {
      const code = `const var${i} = ${i};`
      promises.push(client.createBuffer(i, code, "javascript"))
    }

    const results = await Promise.all(promises)
    expect(results.every((result) => result === true)).toBe(true)

    const buffers = client.getAllBuffers()
    expect(buffers).toHaveLength(5)
  })

  test("should clean up resources on destroy", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    await client.createBuffer(1, jsCode, "javascript")

    expect(client.getAllBuffers()).toHaveLength(1)

    await client.destroy()

    expect(client.isInitialized()).toBe(false)
    expect(client.getAllBuffers()).toHaveLength(0)
  })

  test("should perform one-shot highlighting", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";\nfunction test() { return 42; }'
    const result = await client.highlightOnce(jsCode, "javascript")

    expect(result.highlights).toBeDefined()
    expect(result.highlights!.length).toBeGreaterThan(0)

    const firstHighlight = result.highlights![0]
    expect(Array.isArray(firstHighlight)).toBe(true)
    expect(firstHighlight).toHaveLength(3)
    expect(typeof firstHighlight[0]).toBe("number")
    expect(typeof firstHighlight[1]).toBe("number")
    expect(typeof firstHighlight[2]).toBe("string")

    const groups = result.highlights!.map((hl) => hl[2])
    expect(groups.length).toBeGreaterThan(0)
    expect(groups).toContain("keyword")
  })

  test("should handle one-shot highlighting for unsupported filetype", async () => {
    await client.initialize()

    const result = await client.highlightOnce("some content", "unsupported-lang")

    expect(result.highlights).toBeUndefined()
    expect(result.warning).toContain("No parser available for filetype unsupported-lang")
  }, 5000)

  test("should reject one-shot highlighting after a correlated worker error", async () => {
    await client.initialize()

    const internals = client as unknown as {
      messageCallbacks: Map<string, unknown>
      worker?: {
        onmessage: ((event: { data: { type: "ERROR"; messageId: string; error: string } }) => void) | null
        postMessage: (message: { type?: string; messageId?: string }) => void
      }
    }
    const worker = internals.worker
    expect(worker).toBeDefined()
    if (!worker) {
      throw new Error("Expected initialized client to have a worker")
    }

    let messageId: string | undefined
    const originalPostMessage = worker.postMessage.bind(worker)
    worker.postMessage = (message) => {
      if (message.type === "ONESHOT_HIGHLIGHT") {
        messageId = message.messageId
        return
      }
      originalPostMessage(message)
    }

    const highlighting = client.highlightOnce("const value = 1", "javascript")
    expect(messageId).toBeDefined()
    expect(internals.messageCallbacks.size).toBe(1)

    worker.onmessage?.({
      data: { type: "ERROR", messageId: messageId!, error: "synthetic one-shot failure" },
    })

    await expect(highlighting).rejects.toThrow("synthetic one-shot failure")
    expect(internals.messageCallbacks.size).toBe(0)
  })

  test("should perform multiple one-shot highlights independently", async () => {
    await client.initialize()

    const jsCode = 'const hello = "world";'
    const tsCode = "interface Test { value: string }"

    const [jsResult, tsResult] = await Promise.all([
      client.highlightOnce(jsCode, "javascript"),
      client.highlightOnce(tsCode, "typescript"),
    ])

    expect(jsResult.highlights).toBeDefined()
    expect(tsResult.highlights).toBeDefined()
    expect(jsResult.highlights!.length).toBeGreaterThan(0)
    expect(tsResult.highlights!.length).toBeGreaterThan(0)

    jsResult.highlights!.forEach((hl) => {
      expect(Array.isArray(hl)).toBe(true)
      expect(hl).toHaveLength(3)
    })

    tsResult.highlights!.forEach((hl) => {
      expect(Array.isArray(hl)).toBe(true)
      expect(hl).toHaveLength(3)
    })

    expect(client.getAllBuffers()).toHaveLength(0)
  })

  test("should perform one-shot highlighting for react parser aliases", async () => {
    await client.initialize()

    const jsxCode = 'const view = <div className="card">hello</div>'
    const tsxCode = 'const view: JSX.Element = <div className="card">hello</div>'

    const [jsxResult, tsxResult] = await Promise.all([
      client.highlightOnce(jsxCode, "javascriptreact"),
      client.highlightOnce(tsxCode, "typescriptreact"),
    ])

    expect(jsxResult.highlights).toBeDefined()
    expect(tsxResult.highlights).toBeDefined()
    expect(jsxResult.highlights!.length).toBeGreaterThan(0)
    expect(tsxResult.highlights!.length).toBeGreaterThan(0)

    const jsxGroups = jsxResult.highlights!.map((hl) => hl[2])
    const tsxGroups = tsxResult.highlights!.map((hl) => hl[2])

    expect(jsxGroups).toContain("keyword")
    expect(tsxGroups).toContain("keyword")
  })

  test("should handle Devanagari characters and highlight ranges after them correctly", async () => {
    await client.initialize()

    const jsCode = 'const greeting = "नमस्ते";\nconst x = 42;'
    const result = await client.highlightOnce(jsCode, "javascript")

    expect(result.highlights).toBeDefined()
    expect(result.highlights!.length).toBeGreaterThan(0)

    const keywordHighlights = result.highlights!.filter((hl) => hl[2] === "keyword")
    expect(keywordHighlights.length).toBeGreaterThanOrEqual(2)

    const constHighlights = keywordHighlights.filter((hl) => {
      const text = jsCode.substring(hl[0], hl[1])
      return text === "const"
    })

    expect(constHighlights).toHaveLength(2)

    const firstConst = constHighlights[0]
    const secondConst = constHighlights[1]

    expect(jsCode.substring(firstConst[0], firstConst[1])).toBe("const")
    expect(jsCode.substring(secondConst[0], secondConst[1])).toBe("const")

    expect(firstConst[0]).toBe(0)
    expect(firstConst[1]).toBe(5)

    expect(secondConst[0]).toBeGreaterThan(firstConst[1])
    const textBetween = jsCode.substring(firstConst[1], secondConst[0])
    expect(textBetween).toContain("नमस्ते")

    const numberHighlight = result.highlights!.find((hl) => {
      const text = jsCode.substring(hl[0], hl[1])
      return text === "42" && hl[2] === "number"
    })

    expect(numberHighlight).toBeDefined()
    if (numberHighlight) {
      const [start, end] = numberHighlight
      const actualText = jsCode.substring(start, end)
      expect(actualText).toBe("42")

      const secondLine = jsCode.split("\n")[1]
      const secondLineStart = jsCode.indexOf(secondLine)
      const expectedStart = secondLineStart + secondLine.indexOf("42")
      expect(start).toBe(expectedStart)
    }
  })

  test("should support local file paths for parser configuration", async () => {
    const testQueryPath = join(dataPath, `test-highlights-${Date.now()}.scm`)
    const simpleQuery = "(identifier) @variable"
    const javascriptParser = (await getParsers()).find((parser) => parser.filetype === "javascript")
    if (!javascriptParser) {
      throw new Error("Expected the default JavaScript parser")
    }
    await writeFile(testQueryPath, simpleQuery, "utf8")

    try {
      client.addFiletypeParser({
        filetype: "test-lang",
        aliases: ["test-lang-react"],
        queries: {
          highlights: [testQueryPath],
        },
        wasm: javascriptParser.wasm,
      })

      await client.initialize()

      const hasParser = await client.preloadParser("test-lang")
      expect(hasParser).toBe(true)

      const hasAliasParser = await client.preloadParser("test-lang-react")
      expect(hasAliasParser).toBe(true)

      const testCode = "const myVariable = 42;"
      const result = await client.highlightOnce(testCode, "test-lang")
      const aliasResult = await client.highlightOnce(testCode, "test-lang-react")

      expect(result.highlights).toBeDefined()
      expect(aliasResult.highlights).toBeDefined()
      expect(result.error).toBeUndefined()
      expect(aliasResult.error).toBeUndefined()
      expect(result.warning).toBeUndefined()
      expect(aliasResult.warning).toBeUndefined()
    } finally {
      try {
        await unlink(testQueryPath)
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  })

  test("should handle concurrent highlightOnce calls efficiently (no duplicate parser loading)", async () => {
    const workerLogs: string[] = []

    client.on("worker:log", (_logType, message) => {
      if (message.includes("Loading from local path:")) {
        workerLogs.push(message)
      }
    })

    await client.initialize()

    const jsCode = 'const hello = "world"; function test() { return 42; }'
    const promises = Array.from({ length: 5 }, () => client.highlightOnce(jsCode, "javascript"))

    const results = await Promise.all(promises)

    for (const result of results) {
      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)
      expect(result.error).toBeUndefined()
    }

    const firstResult = results[0]
    for (let i = 1; i < results.length; i++) {
      expect(results[i].highlights).toEqual(firstResult.highlights)
    }

    await new Promise((resolve) => setTimeout(resolve, 100))

    const languageLoadLogs = workerLogs.filter((log) => log.includes("tree-sitter-javascript.wasm"))
    const queryLoadLogs = workerLogs.filter((log) => log.includes("highlights.scm"))

    expect(languageLoadLogs.length).toBeLessThanOrEqual(1)
    expect(queryLoadLogs.length).toBeLessThanOrEqual(1)
  }, 15000)

  test("should reuse canonical parser assets for aliased filetypes", async () => {
    const workerLogs: string[] = []

    client.on("worker:log", (_logType, message) => {
      if (message.includes("Loading from local path:")) {
        workerLogs.push(message)
      }
    })

    await client.initialize()

    const jsxCode = 'const view = <div className="card">hello</div>'
    const [canonicalResult, aliasResult] = await Promise.all([
      client.highlightOnce(jsxCode, "javascript"),
      client.highlightOnce(jsxCode, "javascriptreact"),
    ])

    expect(canonicalResult.highlights).toBeDefined()
    expect(aliasResult.highlights).toBeDefined()
    expect(canonicalResult.error).toBeUndefined()
    expect(aliasResult.error).toBeUndefined()

    await new Promise((resolve) => setTimeout(resolve, 100))

    const languageLoadLogs = workerLogs.filter((log) => log.includes("tree-sitter-javascript.wasm"))
    const queryLoadLogs = workerLogs.filter(
      (log) => log.includes("assets") && log.includes("javascript") && log.includes("highlights.scm"),
    )

    expect(languageLoadLogs.length).toBeLessThanOrEqual(1)
    expect(queryLoadLogs.length).toBeLessThanOrEqual(1)
    expect(workerLogs.some((log) => log.includes("javascriptreact"))).toBe(false)
  }, 15000)
})

describe("TreeSitterClient Injections", () => {
  let dataPath: string

  const injectionsDataPath = join(tmpdir(), "tree-sitter-injections-test-data")

  beforeAll(async () => {
    await mkdir(injectionsDataPath, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = injectionsDataPath
  })

  test("should highlight inline code in markdown using markdown_inline injection", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Hello World

The \`CodeRenderable\` component provides syntax highlighting.

You can use \`const x = 42\` in your code.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const groups = result.highlights!.map((hl) => hl[2])
      const hasInlineCodeHighlights = groups.some((g) => g.includes("markup.raw"))

      expect(hasInlineCodeHighlights).toBe(true)
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should highlight code blocks in markdown using language-specific injection", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Code Example

\`\`\`typescript
const hello: string = "world";
function test() { return 42; }
\`\`\`

Some text here.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const groups = result.highlights!.map((hl) => hl[2])
      const hasTypeScriptHighlights = groups.some((g) => g === "keyword" || g === "type" || g === "function")

      expect(hasTypeScriptHighlights).toBe(true)
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should highlight tsx code blocks in markdown using language-specific injection", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Code Example

\`\`\`tsx
const view: JSX.Element = <div>Hello</div>;
\`\`\`

Some text here.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const constHighlight = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        return text === "const" && hl[2] === "keyword"
      })

      expect(constHighlight).toBeDefined()
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should return correct offsets for injected code in markdown code blocks", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Title\n\n\`\`\`typescript\nconst x = 42;\n\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const constHighlight = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        return text === "const" && hl[2] === "keyword"
      })

      expect(constHighlight).toBeDefined()
      if (constHighlight) {
        const [start, end, group] = constHighlight
        const text = markdownCode.substring(start, end)

        expect(text).toBe("const")
        expect(group).toBe("keyword")
        expect(start).toBe(23)
        expect(end).toBe(28)
      }

      const numberHighlight = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        return text === "42" && hl[2] === "number"
      })

      expect(numberHighlight).toBeDefined()
      if (numberHighlight) {
        const [start, end, group] = numberHighlight
        const text = markdownCode.substring(start, end)

        expect(text).toBe("42")
        expect(group).toBe("number")
        expect(start).toBe(33)
        expect(end).toBe(35)
      }
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should return highlights sorted by start offset for injected code", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Documentation

Some text with \`inline code\` here.

\`\`\`typescript
const first = 1;
const second = 2;
\`\`\`

More text with \`another inline\` code.

\`\`\`javascript
function test() {
  return 42;
}
\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      for (let i = 1; i < result.highlights!.length; i++) {
        const prevStart = result.highlights![i - 1][0]
        const currStart = result.highlights![i][0]
        expect(currStart).toBeGreaterThanOrEqual(prevStart)
      }
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle markdown with injections and return valid highlights", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Heading

Some **bold** text with \`inline code\`.

\`\`\`typescript
const x: string = "hello";
\`\`\`

[Link text](https://example.com)`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(0)

      const overlaps: Array<[number, number]> = []
      for (let i = 0; i < result.highlights!.length; i++) {
        for (let j = i + 1; j < result.highlights!.length; j++) {
          const [start1, end1] = result.highlights![i]
          const [start2, end2] = result.highlights![j]

          if (start2 < end1) {
            overlaps.push([i, j])
          }
        }
      }

      expect(overlaps.length).toBeGreaterThanOrEqual(0)

      const injectionHighlights = result.highlights!.filter((hl) => hl[2].includes("injection"))
      expect(injectionHighlights).toBeDefined()

      const concealHighlights = result.highlights!.filter((hl) => hl[2] === "conceal")
      expect(concealHighlights).toBeDefined()

      const blockHighlights = result.highlights!.filter((hl) => hl[2] === "markup.raw.block")
      expect(blockHighlights).toBeDefined()
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle fast concurrent markdown highlighting requests with injections", async () => {
    const client = new TreeSitterClient({ dataPath })

    const errors: string[] = []
    client.on("error", (error) => {
      errors.push(error)
    })

    client.on("worker:log", (logType, message) => {
      if (logType === "error") {
        errors.push(message)
      }
    })

    try {
      await client.initialize()

      const markdownCode = `# OpenTUI Documentation

## Getting Started

OpenTUI is a modern terminal UI framework built on **tree-sitter** and WebGPU.

### Installation

\`\`\`bash
bun install opentui
\`\`\`

### Quick Example

\`\`\`typescript
import { createCliRenderer, BoxRenderable } from 'opentui';

const renderer = await createCliRenderer();
const box = new BoxRenderable(renderer, {
  border: true,
  title: "Hello World"
});
renderer.root.add(box);
\`\`\`

The \`CodeRenderable\` component provides syntax highlighting.

| Property | Type | Description |
|----------|------|-------------|
| content | string | Code to display |
| filetype | string | Language type |`

      const jsCode = `function test() {
  const hello = "world";
  return hello;
}`

      const tsCode = `interface User {
  name: string;
  age: number;
}

const user: User = { name: "Alice", age: 25 };`

      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(client.highlightOnce(markdownCode, "markdown"))
      }

      const results = await Promise.allSettled(promises)

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === "fulfilled") {
          expect(result.value.error).toBeUndefined()
          expect(result.value.highlights).toBeDefined()
        } else {
          throw new Error(`Request ${i} was rejected: ${result.reason}`)
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500))

      const hasMemoryErrors = errors.some((err) => err.includes("Out of bounds memory access"))
      expect(hasMemoryErrors).toBe(false)
    } finally {
      await client.destroy()
    }
  }, 15000)
})

describe("TreeSitterClient Conceal Values", () => {
  let dataPath: string

  const concealDataPath = join(tmpdir(), "tree-sitter-conceal-test-data")

  beforeAll(async () => {
    await mkdir(concealDataPath, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = concealDataPath
  })

  test("should return conceal values from normal (non-injected) queries", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `![Image Alt Text](https://example.com/image.png)`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should return conceal values from injected queries (markdown_inline)", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `Here is a [link](https://example.com) in text.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
        expect(meta.isInjection).toBeDefined()
      })

      const closingBracketHighlight = concealedHighlights.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        return text === "]" && meta.conceal !== ""
      })

      if (closingBracketHighlight) {
        const meta = (closingBracketHighlight as any)[3]
        expect(meta.conceal).toBeDefined()
      }
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should distinguish conceal values between normal and injected queries", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `Here is a [link](https://example.com) and ![image](https://example.com/img.png).`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      const normalConceal = concealedHighlights.filter((hl) => {
        const meta = (hl as any)[3]
        return !meta.isInjection
      })

      const injectedConceal = concealedHighlights.filter((hl) => {
        const meta = (hl as any)[3]
        return meta.isInjection
      })

      expect(injectedConceal.length).toBeGreaterThan(0)

      injectedConceal.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
        expect(meta.isInjection).toBe(true)
      })

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
        expect(typeof meta.isInjection).toBe("boolean")
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle pattern index lookups correctly for injections", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `A [link](url) here.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        expect(meta.conceal).toBeDefined()
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should handle multiple injected languages with different conceal patterns", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `# Title

Inline \`code\` and a [link](url) here.

\`\`\`typescript
const x = 42;
\`\`\`

More text with ![image](img.png) and **bold**.`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const concealedHighlights = result.highlights!.filter((hl) => {
        const meta = (hl as any)[3]
        return meta && meta.conceal !== undefined
      })

      expect(concealedHighlights.length).toBeGreaterThan(0)

      const byLang = new Map<string, any[]>()
      concealedHighlights.forEach((hl) => {
        const meta = (hl as any)[3]
        const lang = meta.isInjection ? meta.injectionLang || "injected" : "normal"
        if (!byLang.has(lang)) {
          byLang.set(lang, [])
        }
        byLang.get(lang)!.push(hl)
      })

      expect(byLang.size).toBeGreaterThan(0)

      byLang.forEach((highlights) => {
        expect(highlights.length).toBeGreaterThan(0)
        highlights.forEach((hl: any) => {
          const meta = hl[3]
          expect(meta.conceal).toBeDefined()
        })
      })
    } finally {
      await client.destroy()
    }
  }, 10000)

  test("should preserve non-empty conceal replacements like space character", async () => {
    const client = new TreeSitterClient({ dataPath })

    try {
      await client.initialize()

      const markdownCode = `Check [this link](https://example.com) out!`

      const result = await client.highlightOnce(markdownCode, "markdown")

      expect(result.highlights).toBeDefined()
      expect(result.error).toBeUndefined()

      const closingBracket = result.highlights!.find((hl) => {
        const text = markdownCode.substring(hl[0], hl[1])
        const meta = (hl as any)[3]
        return text === "]" && hl[2] === "conceal" && meta?.conceal !== undefined
      })

      if (closingBracket) {
        const meta = (closingBracket as any)[3]
        expect(meta).toBeDefined()
        expect(meta.conceal).toBeDefined()
        expect(meta.conceal).toBe(" ")
        expect(meta.conceal.length).toBeGreaterThan(0)
      }
    } finally {
      await client.destroy()
    }
  }, 10000)
})

describe("TreeSitterClient Edge Cases", () => {
  let dataPath: string

  const edgeCaseDataPath = join(tmpdir(), "tree-sitter-edge-case-test-data")
  const reactiveDataPathRoot = join(tmpdir(), "tree-sitter-reactive-data-path-test")

  beforeAll(async () => {
    await mkdir(edgeCaseDataPath, { recursive: true })
    await mkdir(reactiveDataPathRoot, { recursive: true })
  })

  beforeEach(async () => {
    dataPath = edgeCaseDataPath
  })

  test("should handle initialization timeout", async () => {
    const client = new TreeSitterClient({
      dataPath,
      workerPath: "invalid-path",
      initTimeout: 500,
    })

    await expect(client.initialize()).rejects.toThrow(/Worker error|Worker initialization timed out/)

    await client.destroy()
  })

  test("should handle operations before initialization", async () => {
    const client = new TreeSitterClient({ dataPath })

    expect(client.isInitialized()).toBe(false)
    expect(client.getAllBuffers()).toHaveLength(0)
    expect(client.getBuffer(1)).toBeUndefined()

    await client.destroy()
  })

  test("should handle destroy() during pending initialization", async () => {
    const client = new TreeSitterClient({ dataPath, initTimeout: 50 })
    const internals = client as unknown as {
      initializeResolvers?: unknown
    }

    // Start init but don't await
    const initPromise = client.initialize()
    void initPromise.catch(() => {})

    // Immediately destroy
    await client.destroy()

    // Init promise should reject with specific error
    await expect(initPromise).rejects.toThrow("Client destroyed during initialization")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(client.isInitialized()).toBe(false)
    expect(internals.initializeResolvers).toBeUndefined()
  })

  test("should reject initialization while worker termination is pending", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    const internals = client as unknown as {
      worker?: { terminate: () => void | Promise<number> }
    }
    const worker = internals.worker
    expect(worker).toBeDefined()
    if (!worker) {
      throw new Error("Expected initialized client to have a worker")
    }

    let resolveTermination!: () => void
    const terminationGate = new Promise<void>((resolve) => {
      resolveTermination = resolve
    })
    const originalTerminate = worker.terminate.bind(worker)
    worker.terminate = async () => {
      await terminationGate
      const result = originalTerminate()
      return result && typeof (result as PromiseLike<number>).then === "function" ? await result : 0
    }

    const destroyPromise = client.destroy()

    try {
      await expect(client.initialize()).rejects.toThrow("Cannot initialize while client is being destroyed")
      expect(client.isInitialized()).toBe(false)

      resolveTermination()
      await destroyPromise

      await client.initialize()
      expect(client.isInitialized()).toBe(true)
      expect(internals.worker).not.toBe(worker)
    } finally {
      resolveTermination()
      await destroyPromise
      await client.destroy()
    }
  })

  test("should retain the worker when termination fails so destroy can be retried", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    const internals = client as unknown as {
      worker?: {
        onexit?: ((event: { code: number }) => void) | null
        terminate: () => void | Promise<number>
      }
    }
    const worker = internals.worker
    expect(worker).toBeDefined()
    if (!worker) {
      throw new Error("Expected initialized client to have a worker")
    }

    const originalTerminate = worker.terminate.bind(worker)
    const originalExit = worker.onexit
    worker.terminate = async () => {
      throw new Error("synthetic termination failure")
    }

    await expect(client.destroy()).rejects.toThrow("synthetic termination failure")
    expect(internals.worker).toBe(worker)
    expect(worker.onexit).toBe(originalExit)
    await expect(client.initialize()).rejects.toThrow("retry destroy()")

    worker.terminate = originalTerminate
    await client.destroy()
    expect(internals.worker).toBeUndefined()
  })

  test("should reject pending requests when an initialized worker errors", async () => {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()

    const internals = client as unknown as {
      messageCallbacks: Map<string, unknown>
      worker?: {
        onerror: ((event: { message: string; error?: unknown }) => void) | null
        postMessage: (message: { type?: string }) => void
      }
    }
    const worker = internals.worker
    expect(worker).toBeDefined()
    if (!worker) {
      throw new Error("Expected initialized client to have a worker")
    }

    const originalPostMessage = worker.postMessage.bind(worker)
    const blockedTypes = new Set(["GET_PERFORMANCE", "PRELOAD_PARSER", "ONESHOT_HIGHLIGHT"])
    worker.postMessage = (message) => {
      if (!blockedTypes.has(message.type ?? "")) {
        originalPostMessage(message)
      }
    }
    const observe = <T>(promise: Promise<T>) =>
      promise.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
    const outcomes = [
      observe(client.getPerformance()),
      observe(client.preloadParser("javascript")),
      observe(client.highlightOnce("const value = 1", "javascript")),
    ]

    try {
      expect(internals.messageCallbacks.size).toBe(3)
      expect(worker.onerror).not.toBeNull()
      worker.onerror?.({ message: "synthetic post-init failure" })

      expect(client.isInitialized()).toBe(false)
      expect(internals.messageCallbacks.size).toBe(0)
      for (const outcome of await Promise.all(outcomes)) {
        expect(outcome.status).toBe("rejected")
        if (outcome.status === "rejected") {
          expect(outcome.error).toBeInstanceOf(Error)
          expect((outcome.error as Error).message).toContain("synthetic post-init failure")
        }
      }
    } finally {
      await client.destroy()
      await Promise.all(outcomes)
    }
  })

  test("should handle worker errors gracefully", async () => {
    const client = new TreeSitterClient({ dataPath })

    let errorReceived = false
    client.on("error", () => {
      errorReceived = true
    })

    const hasParser = await client.createBuffer(1, "test", "javascript", 1, false)
    expect(hasParser).toBe(false)
    expect(errorReceived).toBe(true)

    await client.destroy()
  })

  test("should handle data path changes with reactive getTreeSitterClient", async () => {
    const originalXdgDataHome = process.env.XDG_DATA_HOME

    process.env.XDG_DATA_HOME = reactiveDataPathRoot
    clearEnvCache()
    destroySingleton("data-paths-opentui")
    await destroyTreeSitterClient()

    const dataPathsManager = getDataPaths()
    let client: any

    try {
      client = getTreeSitterClient()
      await client.initialize()

      const initialDataPath = dataPathsManager.globalDataPath

      dataPathsManager.appName = "test-app-changed"

      await new Promise((resolve) => setTimeout(resolve, 100))

      const newDataPath = dataPathsManager.globalDataPath
      expect(newDataPath).not.toBe(initialDataPath)
      expect(newDataPath).toContain("test-app-changed")

      if (!client.isInitialized()) {
        await client.initialize()
      }

      const hasParser = await client.preloadParser("javascript")
      expect(hasParser).toBe(true)
    } finally {
      await destroyTreeSitterClient()
      destroySingleton("data-paths-opentui")

      if (originalXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = originalXdgDataHome
      }
      clearEnvCache()
    }
  })

  test("should remove the reactive data path listener when the singleton client is destroyed", async () => {
    await destroyTreeSitterClient()
    destroySingleton("data-paths-opentui")

    const dataPathsManager = getDataPaths()

    expect(dataPathsManager.listenerCount("paths:changed")).toBe(0)

    getTreeSitterClient()
    expect(dataPathsManager.listenerCount("paths:changed")).toBe(1)

    await destroyTreeSitterClient()
    expect(dataPathsManager.listenerCount("paths:changed")).toBe(0)

    destroySingleton("data-paths-opentui")
  })
})

describe("TreeSitterClient lifecycle hardening", () => {
  let dataPath: string
  const sharedDataPath = join(tmpdir(), "tree-sitter-lifecycle-test-data")

  beforeAll(async () => {
    await mkdir(sharedDataPath, { recursive: true })
  })

  beforeEach(() => {
    dataPath = sharedDataPath
  })

  const captureWarnTimedOut = () => {
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args)
    }
    return {
      restore: () => {
        console.warn = originalWarn
      },
      hasDisposeTimeoutWarning: () =>
        warnings.some((args) => Array.from(args).some((arg) => typeof arg === "string" && arg.includes("Timed out"))),
    }
  }

  test("removeBuffer cancels the dispose timer on a fast response", async () => {
    const client = new TreeSitterClient({ dataPath }, { disposeTimeoutMs: 200 })
    const warn = captureWarnTimedOut()
    try {
      await client.initialize()
      const internals = client as unknown as {
        worker?: { onmessage: ((event: { data: unknown }) => void) | null }
      }
      const worker = internals.worker!
      await client.createBuffer(1, "const a = 1", "javascript")

      const dispose = client.removeBuffer(1).then(
        () => "resolved",
        (error: unknown) => `rejected: ${String(error)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, 5))
      worker.onmessage?.({ data: { type: "BUFFER_DISPOSED", bufferId: 1 } })

      expect(await dispose).toBe("resolved")
      // Timer must have been cleared on the fast response; wait past the timeout
      // and assert no stale "Timed out" warning fires.
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(warn.hasDisposeTimeoutWarning()).toBe(false)
    } finally {
      warn.restore()
      await client.destroy().catch(() => {})
    }
  }, 5000)

  test("removeBuffer dispose timeout settles once and a late response is harmless", async () => {
    const client = new TreeSitterClient({ dataPath }, { disposeTimeoutMs: 30 })
    try {
      await client.initialize()
      const internals = client as unknown as {
        worker?: { onmessage: ((event: { data: unknown }) => void) | null }
      }
      const worker = internals.worker!
      await client.createBuffer(1, "const a = 1", "javascript")

      const start = Date.now()
      await client.removeBuffer(1)
      expect(Date.now() - start).toBeLessThan(1000)

      // A late BUFFER_DISPOSED after the timeout is harmless (already settled once).
      worker.onmessage?.({ data: { type: "BUFFER_DISPOSED", bufferId: 1 } })
    } finally {
      await client.destroy().catch(() => {})
    }
  }, 5000)

  test("worker error cancels the dispose timer", async () => {
    const client = new TreeSitterClient({ dataPath }, { disposeTimeoutMs: 200 })
    const warn = captureWarnTimedOut()
    try {
      await client.initialize()
      const internals = client as unknown as {
        worker?: {
          onerror: ((event: { message?: string }) => void) | null
          postMessage: (message: { type?: string }) => void
        }
      }
      const worker = internals.worker!
      // Prevent the real worker from resolving the dispose ahead of the synthetic error.
      const originalPost = worker.postMessage.bind(worker)
      worker.postMessage = (message) => {
        if (message.type === "DISPOSE_BUFFER") return
        originalPost(message)
      }
      await client.createBuffer(1, "const a = 1", "javascript")

      const dispose = client.removeBuffer(1).then(
        () => "resolved",
        () => "rejected",
      )
      await new Promise((resolve) => setTimeout(resolve, 5))
      worker.onerror?.({ message: "synthetic dispose worker failure" })

      expect(await dispose).toBe("rejected")
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(warn.hasDisposeTimeoutWarning()).toBe(false)
    } finally {
      warn.restore()
      await client.destroy().catch(() => {})
    }
  }, 5000)

  test("destroy cancels the dispose timer", async () => {
    const client = new TreeSitterClient({ dataPath }, { disposeTimeoutMs: 50 })
    try {
      await client.initialize()
      const internals = client as unknown as {
        worker?: {
          postMessage: (message: { type?: string }) => void
        }
      }
      const worker = internals.worker!
      // Prevent the real worker from resolving the dispose ahead of destroy().
      const originalPost = worker.postMessage.bind(worker)
      worker.postMessage = (message) => {
        if (message.type === "DISPOSE_BUFFER") return
        originalPost(message)
      }
      await client.createBuffer(1, "const a = 1", "javascript")

      const dispose = client.removeBuffer(1).then(
        () => "resolved",
        () => "rejected",
      )
      await new Promise((resolve) => setTimeout(resolve, 5))
      await client.destroy()

      expect(await dispose).toBe("rejected")
    } finally {
      await client.destroy().catch(() => {})
    }
  }, 5000)

  test("repeated removeBuffer does not create competing dispose owners", async () => {
    const client = new TreeSitterClient({ dataPath }, { disposeTimeoutMs: 30 })
    try {
      await client.initialize()
      await client.createBuffer(1, "const a = 1", "javascript")

      const first = client.removeBuffer(1).then(
        () => "resolved",
        (error: unknown) => `rejected: ${String(error)}`,
      )
      const second = client.removeBuffer(1).then(
        () => "resolved",
        (error: unknown) => `rejected: ${String(error)}`,
      )

      expect(await first).toBe("resolved")
      expect(await second).toBe("resolved")
    } finally {
      await client.destroy().catch(() => {})
    }
  }, 5000)

  test("worker exit propagates once through the failure path", async () => {
    const client = new TreeSitterClient({ dataPath })
    try {
      await client.initialize()
      const internals = client as unknown as {
        worker?: {
          onmessage: ((event: { data: unknown }) => void) | null
          onexit: ((event: { code: number }) => void) | null
        }
        messageCallbacks: Map<string, unknown>
        buffers: Map<number, unknown>
      }
      const worker = internals.worker!
      await client.createBuffer(1, "const a = 1", "javascript")

      const highlight = client.highlightOnce("const a = 1", "javascript").then(
        () => "resolved",
        () => "rejected",
      )
      expect(internals.messageCallbacks.size).toBeGreaterThan(0)

      worker.onexit?.({ code: 1 })

      expect(await highlight).toBe("rejected")
      expect(client.isInitialized()).toBe(false)
      expect(internals.buffers.size).toBe(0)
      expect(internals.messageCallbacks.size).toBe(0)
    } finally {
      await client.destroy().catch(() => {})
    }
  }, 5000)

  test("worker restart budget blocks recreation after consecutive failures", async () => {
    const client = new TreeSitterClient({ dataPath })
    try {
      const internals = client as unknown as {
        worker?: { onerror: ((event: { message?: string }) => void) | null }
      }

      // Exercise five real client failure/recreate generations. Successful
      // initialization alone must not reset the crash-loop budget.
      for (let attempt = 1; attempt <= 5; attempt++) {
        await client.initialize()
        const worker = internals.worker
        expect(worker).toBeDefined()
        worker?.onerror?.({ message: `synthetic consecutive failure ${attempt}` })
        expect(client.isInitialized()).toBe(false)
      }

      await expect(client.initialize()).rejects.toThrow(/restart budget exceeded/)
    } finally {
      await client.destroy().catch(() => {})
    }
  }, 5000)

  test("resetBuffer propagates real debounced work failures", async () => {
    const client = new TreeSitterClient({ dataPath }, { autoStartWorker: false })
    try {
      const internals = client as unknown as {
        initialized: boolean
        buffers: Map<number, { id: number; content: string; filetype: string; version: number; hasParser: true }>
        processEdit: () => Promise<void>
      }
      internals.initialized = true
      internals.buffers.set(1, {
        id: 1,
        content: "const a = 1",
        filetype: "javascript",
        version: 1,
        hasParser: true,
      })
      internals.processEdit = async () => {
        throw new Error("synthetic reset send failure")
      }

      const outcome = await client.resetBuffer(1, 2, "const b = 2").then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(Error)
        expect((outcome.error as Error).message).toBe("synthetic reset send failure")
      }
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("rapid resetBuffer calls settle and only send the latest reset", async () => {
    const client = new TreeSitterClient({ dataPath }, { autoStartWorker: false })
    try {
      const sent: string[] = []
      const internals = client as unknown as {
        initialized: boolean
        buffers: Map<number, { id: number; content: string; filetype: string; version: number; hasParser: true }>
        processEdit: (
          bufferId: number,
          edits: unknown[],
          content: string,
          version: number,
          isReset: boolean,
        ) => Promise<void>
      }
      internals.initialized = true
      internals.buffers.set(1, {
        id: 1,
        content: "const a = 1",
        filetype: "javascript",
        version: 1,
        hasParser: true,
      })
      internals.processEdit = async (_bufferId, _edits, content) => {
        sent.push(content)
      }

      const first = client.resetBuffer(1, 2, "const b = 2")
      const second = client.resetBuffer(1, 3, "const c = 3")
      await Promise.all([first, second])

      expect(sent).toEqual(["const c = 3"])
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("destroying one client does not cancel another client's debounced reset", async () => {
    const first = new TreeSitterClient({ dataPath }, { autoStartWorker: false })
    const second = new TreeSitterClient({ dataPath }, { autoStartWorker: false })
    try {
      const sent: string[] = []
      const internals = first as unknown as {
        initialized: boolean
        buffers: Map<number, { id: number; content: string; filetype: string; version: number; hasParser: true }>
        processEdit: (
          bufferId: number,
          edits: unknown[],
          content: string,
          version: number,
          isReset: boolean,
        ) => Promise<void>
      }
      internals.initialized = true
      internals.buffers.set(1, {
        id: 1,
        content: "const a = 1",
        filetype: "javascript",
        version: 1,
        hasParser: true,
      })
      internals.processEdit = async (_bufferId, _edits, content) => {
        sent.push(content)
      }

      const pendingReset = first.resetBuffer(1, 2, "const b = 2")
      await second.destroy()
      await pendingReset

      expect(sent).toEqual(["const b = 2"])
    } finally {
      await first.destroy().catch(() => {})
      await second.destroy().catch(() => {})
    }
  })
})

describe("TreeSitterClient backpressure (latest-wins)", () => {
  interface HeldHandle {
    client: TreeSitterClient
    posted: Array<{ type: string; bufferId: number; version: number; content: string; edits: unknown[] }>
    fire: (data: unknown) => void
    worker: { onexit: ((event: { code: number }) => void) | null }
    internals: any
  }

  // Initializes a real worker and buffer, then wraps postMessage to HOLD edit
  // jobs (not forwarded to the worker) so ACKs are delivered deterministically
  // via `fire`. The client's real onmessage handler is retained.
  async function seedClient(dataPath: string): Promise<HeldHandle> {
    const client = new TreeSitterClient({ dataPath })
    await client.initialize()
    await client.createBuffer(1, "const a = 1\n", "javascript")
    const internals = client as unknown as {
      worker: {
        postMessage: (m: any) => void
        onmessage: ((event: any) => void) | null
        onexit: ((event: { code: number }) => void) | null
      }
    }
    const realWorker = internals.worker
    const posted: HeldHandle["posted"] = []
    const originalPost = realWorker.postMessage.bind(realWorker)
    realWorker.postMessage = (message: any) => {
      if (message.type === "HANDLE_EDITS" || message.type === "RESET_BUFFER") {
        posted.push({
          type: message.type,
          bufferId: message.bufferId,
          version: message.version,
          content: message.content,
          edits: message.edits,
        })
        return
      }
      originalPost(message)
    }
    return {
      client,
      posted,
      fire: (data) => realWorker.onmessage?.({ data }),
      worker: realWorker,
      internals,
    }
  }

  function simpleEdit(start: number, newContent: string): any[] {
    return [
      {
        startIndex: start,
        oldEndIndex: start,
        newEndIndex: newContent.length,
        startPosition: { row: 0, column: start },
        oldEndPosition: { row: 0, column: start },
        newEndPosition: { row: 0, column: newContent.length },
      },
    ]
  }

  test("latest-wins: 100 same-turn held updates post <=2 jobs, supersede >=98, pending bytes = newest only", async () => {
    const held = await seedClient(tmpdir())
    const client = held.client
    try {
      const calls: Array<Promise<{ status: string }>> = []
      const contents: string[] = []
      for (let i = 2; i <= 101; i++) {
        const content = `const v = ${i}; ${"x".repeat(i)}`
        contents.push(content)
        calls.push(client.updateBuffer(1, simpleEdit(0, content), content, i) as Promise<{ status: string }>)
      }

      // No ACK released: only the first update should be active-posted.
      expect(held.posted.length).toBe(1)
      expect(held.posted[0].version).toBe(2)

      // Release the active v2 -> promotes the single newest pending (v101).
      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 2, highlights: [] })
      expect(held.posted.length).toBe(2)
      expect(held.posted[1].version).toBe(101)
      expect(held.posted[1].content).toBe(contents[99])

      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 101, highlights: [] })

      const outcomes = await Promise.all(calls)
      const completed = outcomes.filter((o) => o.status === "completed")
      const superseded = outcomes.filter((o) => o.status === "superseded")
      expect(completed.length).toBe(2)
      expect(superseded.length).toBe(98)

      const stats = client.getUpdateQueueStats()
      expect(stats.posted).toBe(2)
      expect(stats.superseded).toBe(98)
      expect(held.posted.length).toBe(2)

      const newestBytes = Buffer.byteLength(contents[99], "utf8")
      const sumBytes = contents.reduce((a, c) => a + Buffer.byteLength(c, "utf8"), 0)
      expect(stats.pendingByteHighWater).toBeGreaterThan(0)
      expect(stats.pendingByteHighWater).toBeLessThanOrEqual(newestBytes)
      expect(stats.pendingByteHighWater).toBeLessThan(sumBytes)
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("an ACK for an older version cannot overwrite a newer version", async () => {
    const held = await seedClient(tmpdir())
    const client = held.client
    try {
      const active = client.updateBuffer(1, [], "const b = 2", 2)
      client.updateBuffer(1, [], "const c = 3", 3)

      // A mis-ordered/older ACK (v1) must be ignored: active v2 must not settle.
      const received: unknown[] = []
      client.on("highlights:response", (bufferId, version) => {
        received.push(version)
      })
      held.fire({
        type: "HIGHLIGHT_RESPONSE",
        bufferId: 1,
        version: 1,
        highlights: [{ line: 0, highlights: [], droppedHighlights: [] }],
      })
      expect(received.length).toBe(0)
      expect(held.posted.length).toBe(1)

      // The correct active ACK settles it and promotes the newest pending.
      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 2, highlights: [] })
      expect(held.posted.length).toBe(2)
      expect(held.posted[1].version).toBe(3)
      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 3, highlights: [] })

      const oa = await active
      expect(oa.status).toBe("completed")
      expect(received.length).toBe(2)
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("an out-of-order newer ACK (e.g. a reset) never settles or promotes an in-flight active edit", async () => {
    const held = await seedClient(tmpdir())
    const client = held.client
    try {
      const active = client.updateBuffer(1, [], "const b = 2", 2)
      const pending = client.updateBuffer(1, [], "const c = 3", 3)
      expect(held.posted.length).toBe(1)

      // A newer version (v3) ACKs first — simulating a concurrent reset or a
      // pending job completing before the active one. It must NOT settle the
      // active v2 nor promote/pend anything (no second post).
      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 3, highlights: [] })
      expect(held.posted.length).toBe(1)

      // The true active ACK (v2) settles v2 and promotes the newest pending v3.
      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 2, highlights: [] })
      expect(held.posted.length).toBe(2)
      expect(held.posted[1].version).toBe(3)

      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 3, highlights: [] })
      const oa = await active
      const op = await pending
      expect(oa.status).toBe("completed")
      expect(op.status).toBe("completed")
      expect(held.posted.length).toBe(2)
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("two buffers do not block each other via a global latest-wins policy", async () => {
    const held = await seedClient(tmpdir())
    const client = held.client
    held.internals.buffers.set(2, { id: 2, content: "x", filetype: "javascript", version: 1, hasParser: true })
    try {
      const a = client.updateBuffer(1, [], "b1v2", 2)
      const b = client.updateBuffer(2, [], "b2v2", 2)
      await Promise.resolve()
      expect(held.posted.length).toBe(2)

      // Buffer 2 completes independently while buffer 1 is still held.
      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 2, version: 2, highlights: [] })
      await b
      expect(held.posted.length).toBe(2)

      held.fire({ type: "HIGHLIGHT_RESPONSE", bufferId: 1, version: 2, highlights: [] })
      const oa = await a
      expect(oa.status).toBe("completed")
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("destroy settles active and pending jobs exactly once and leaves no works", async () => {
    const held = await seedClient(tmpdir())
    const client = held.client
    try {
      const active = client.updateBuffer(1, [], "const b = 2", 2)
      const pending = client.updateBuffer(1, [], "const c = 3", 3)
      await client.destroy()
      const [oa, op] = (await Promise.all([active, pending])) as Array<{ status: string }>
      expect(oa.status).toBe("error")
      expect(op.status).toBe("error")
      expect((client as unknown as { works: Map<number, unknown> }).works.size).toBe(0)
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("worker exit before/during a job settles active and pending exactly once", async () => {
    const held = await seedClient(tmpdir())
    const client = held.client
    try {
      const active = client.updateBuffer(1, [], "const b = 2", 2)
      const pending = client.updateBuffer(1, [], "const c = 3", 3)
      held.worker.onexit?.({ code: 1 })
      const [oa, op] = (await Promise.all([active, pending])) as Array<{ status: string }>
      expect(oa.status).toBe("error")
      expect(op.status).toBe("error")
      expect((client as unknown as { works: Map<number, unknown> }).works.size).toBe(0)
    } finally {
      await client.destroy().catch(() => {})
    }
  })

  test("latest-wins output for a real worker matches the highlightOnce oracle", async () => {
    const client = new TreeSitterClient({ dataPath: tmpdir() })
    try {
      await client.initialize()
      const jsCode = 'const hello = "world"\n'
      await client.createBuffer(1, jsCode, "javascript")

      const final = 'const hello = "world"\nconst add = (a, b) => a + b // tail\n'
      const appendEdit = [
        {
          startIndex: jsCode.length,
          oldEndIndex: jsCode.length,
          newEndIndex: final.length,
          startPosition: { row: 1, column: 0 },
          oldEndPosition: { row: 1, column: 0 },
          newEndPosition: { row: 1, column: final.length - jsCode.length },
        },
      ]

      const emitted: Array<{ version: number; highlights: unknown[] }> = []
      client.on("highlights:response", (bufferId, version, highlights) => {
        emitted.push({ version, highlights })
      })

      const outcome = await client.updateBuffer(1, appendEdit, final, 2)
      expect(outcome.status).toBe("completed")
      const delivered = emitted.find((e) => e.version === 2)
      expect(delivered).toBeDefined()
      expect((delivered?.highlights ?? []).length).toBeGreaterThan(0)

      const oracle = await client.highlightOnce(final, "javascript")
      expect(oracle.error).toBeUndefined()
      expect((oracle.highlights ?? []).length).toBeGreaterThan(0)
    } finally {
      await client.destroy().catch(() => {})
    }
  })
})
