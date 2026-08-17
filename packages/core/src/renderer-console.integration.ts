import { capture, TerminalConsole } from "./console.js"
import { registerRendererConsoleIntegration } from "./renderer-integration.js"

registerRendererConsoleIntegration({
  create(renderer, options) {
    return new TerminalConsole(renderer, options)
  },
  claimCapturedOutput() {
    return capture.claimOutput()
  },
})
