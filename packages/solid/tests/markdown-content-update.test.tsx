import { afterEach, expect, test } from "bun:test"
import { MarkdownRenderable, SyntaxStyle, parseColor } from "@opentui/core"
import { createSignal } from "solid-js"
import { testRender } from "../index.js"

let testSetup: Awaited<ReturnType<typeof testRender>>

afterEach(() => {
  testSetup?.renderer.destroy()
})

test("markdown contentUpdate forwards a decoded append suffix", async () => {
  const [update, setUpdate] = createSignal({ content: "Streaming tail", appended: undefined as string | undefined })
  let markdown: MarkdownRenderable | undefined

  testSetup = await testRender(
    () => (
      <markdown
        ref={(value: MarkdownRenderable) => (markdown = value)}
        syntaxStyle={SyntaxStyle.fromStyles({ default: { fg: parseColor("#ffffff") } })}
        streaming
        internalBlockMode="top-level"
        contentUpdate={update()}
      />
    ),
    { width: 40, height: 5 },
  )

  setUpdate({ content: "Streaming tail &amp; grows", appended: " &amp; grows" })
  await testSetup.renderOnce()

  expect(markdown?.content).toBe("Streaming tail & grows")
  expect(markdown?._parseState?.content).toBe("Streaming tail & grows")
})
