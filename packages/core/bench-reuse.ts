import { Renderable, ScrollBoxRenderable, TextRenderable } from "./src/index.js"
import { createTestRenderer } from "./src/testing.js"

const N = 300
const FRAMES = 100

const { renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 })

const scroll = new ScrollBoxRenderable(renderer, {
  width: "100%",
  flexGrow: 1,
  scrollY: true,
  scrollX: false,
  border: false,
  contentOptions: { flexDirection: "column" },
})
renderer.root.add(scroll)
for (let i = 0; i < N; i++) {
  scroll.add(new TextRenderable(renderer, { content: `row ${i} ${"x".repeat(40)}` }))
}

// Count every tree-node layout visit; a full render-list rebuild walks the
// whole tree (~N calls), a reused list skips the walk entirely (0 calls).
let layoutCalls = 0
const origUpdateLayout = Renderable.prototype.updateLayout
Renderable.prototype.updateLayout = function (this: any, ...args: any[]) {
  layoutCalls++
  return origUpdateLayout.apply(this, args)
}

async function measure(label: string) {
  await renderOnce() // warm-up frame (always rebuilds once)
  layoutCalls = 0
  for (let i = 0; i < FRAMES; i++) await renderOnce() // static scroll, spinner-like re-renders
  console.log(`${label}: ${layoutCalls} layout-visits over ${FRAMES} static frames (${(layoutCalls / FRAMES).toFixed(1)}/frame)`)
}

// Fixed: ContentRenderable opts back into render-list reuse.
await measure("FIXED   (reuse on) ")

// Unfixed: force the pre-patch behaviour — culling filter blocks reuse.
// Perturb the scroll position so the cached renderListReusable flag is
// recomputed on the next rebuild with the patched-out hook.
;((scroll as any).content as any).isVisibleChildFilterReusable = () => false
scroll.scrollTop = 1
scroll.scrollTop = 0
await measure("UNFIXED (reuse off)")

renderer.destroy?.()
