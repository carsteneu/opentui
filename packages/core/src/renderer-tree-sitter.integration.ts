import { destroyTreeSitterClient } from "./lib/tree-sitter/index.js"
import { registerRendererLastDestroyCleanup } from "./renderer-integration.js"

registerRendererLastDestroyCleanup({
  id: "tree-sitter-client",
  description: "tree-sitter client",
  run: destroyTreeSitterClient,
})
