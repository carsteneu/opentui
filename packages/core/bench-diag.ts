import { Renderable, ScrollBoxRenderable, TextRenderable } from "./src/index.js"
import { createTestRenderer } from "./src/testing.js"
const { renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 })
const scroll = new ScrollBoxRenderable(renderer, { width: "100%", flexGrow: 1, scrollY: true, border: false, contentOptions: { flexDirection: "column" } })
renderer.root.add(scroll)
for (let i = 0; i < 50; i++) scroll.add(new TextRenderable(renderer, { content: "row " + i }))
const root: any = renderer.root
const ctx: any = (root as any)._ctx
for (let f = 0; f < 4; f++) {
  await renderOnce()
  const blockers = (root.renderList || []).filter((c: any) => c.action === "render" && !c.renderable.canReuseRenderCommandList()).map((c: any) => c.renderable.constructor.name + "/" + (c.renderable.id ?? ""))
  console.log("frame", f, "gen=", ctx.__otuiLayoutGeneration, "rev=", ctx.__otuiRenderListRevision, "reusable=", root.renderListReusable, "applGen=", root.appliedLayoutGeneration, "applRev=", root.appliedRenderListRevision, "blockers=", [...new Set(blockers)].slice(0, 5))
}
