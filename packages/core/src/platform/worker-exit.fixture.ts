import { parentPort } from "node:worker_threads"

parentPort?.postMessage({ type: "READY" })

parentPort?.on("message", () => {
  process.exit(4)
})
