import { describe, expect, test } from "bun:test"
import { NativeAudioStreamState as ExportedAudioStreamState, resolveRenderLib } from "../zig.js"
import {
  AudioStreamCreateOptionsStruct,
  AudioStreamStatsStruct,
  CursorStyleOptionsStruct,
  NativeAudioStreamCloseReason,
  NativeAudioStreamFormat,
  NativeAudioStreamState,
  StyledChunkStruct,
} from "../zig-structs.js"
import { RGBA } from "../lib/RGBA.js"
import { toArrayBuffer, type Pointer } from "../platform/ffi.js"

// Borrowed-pointer contract for styled text, styled placeholders, and cursor
// options: packed struct buffers must reach the FFI symbol as object values so
// the backend can borrow them for the synchronous call. Passing a pre-resolved
// address instead reintroduces the Node use-after-free from issue #1212.

const lib = resolveRenderLib()
const symbols = (lib as any).opentui.symbols as Record<string, (...args: any[]) => any>

function withStubbedSymbol(name: string, fn: (calls: any[][]) => void): void {
  const calls: any[][] = []
  const original = symbols[name]
  symbols[name] = (...args: any[]) => {
    calls.push(args)
  }
  try {
    fn(calls)
  } finally {
    symbols[name] = original
  }
}

async function forceGc(): Promise<void> {
  if (typeof Bun !== "undefined") {
    Bun.gc(true)
  }
  ;(globalThis as any).gc?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function fieldOffset(struct: { layoutByName: Map<string, { offset: number }> }, name: string): number {
  const field = struct.layoutByName.get(name)
  if (!field) {
    throw new Error(`Missing struct field: ${name}`)
  }
  return field.offset
}

function readPackedColor(packed: ArrayBuffer, offset: number): number[] {
  // 64-bit StyledChunk/CursorStyleOptions layout; matches the supported
  // x64/arm64 native targets.
  const address = new DataView(packed).getBigUint64(offset, true)
  expect(address).not.toBe(0n)
  return [...new Uint16Array(toArrayBuffer(address as unknown as Pointer, 0, 8).slice(0))]
}

describe("borrowed pointer call sites", () => {
  test("audio stream structs preserve the native ABI", () => {
    expect(AudioStreamCreateOptionsStruct.size).toBe(32)
    expect(
      Object.fromEntries(
        ["capacityMs", "startupMs", "resumeMs", "volume", "pan", "groupId", "maxProbeBytes", "format"].map((name) => [
          name,
          fieldOffset(AudioStreamCreateOptionsStruct, name),
        ]),
      ),
    ).toEqual({
      capacityMs: 0,
      startupMs: 4,
      resumeMs: 8,
      volume: 12,
      pan: 16,
      groupId: 20,
      maxProbeBytes: 24,
      format: 28,
    })

    const packed = AudioStreamCreateOptionsStruct.pack({
      capacityMs: 2000,
      startupMs: 1000,
      resumeMs: 500,
      volume: 0.75,
      pan: -0.25,
      groupId: 7,
      maxProbeBytes: 2 * 1024 * 1024,
      format: NativeAudioStreamFormat.Mp3,
    })
    const view = new DataView(packed)
    expect(view.getUint32(0, true)).toBe(2000)
    expect(view.getUint32(4, true)).toBe(1000)
    expect(view.getUint32(8, true)).toBe(500)
    expect(view.getFloat32(12, true)).toBe(0.75)
    expect(view.getFloat32(16, true)).toBe(-0.25)
    expect(view.getUint32(20, true)).toBe(7)
    expect(view.getUint32(24, true)).toBe(2 * 1024 * 1024)
    expect(view.getUint32(28, true)).toBe(NativeAudioStreamFormat.Mp3)

    expect(AudioStreamStatsStruct.size).toBe(56)
    expect(
      Object.fromEntries(
        [
          "bytesReceived",
          "framesDecoded",
          "framesPlayed",
          "state",
          "sampleRate",
          "channels",
          "bufferedFrames",
          "capacityFrames",
          "underruns",
          "errorCode",
          "readyGeneration",
        ].map((name) => [name, fieldOffset(AudioStreamStatsStruct, name)]),
      ),
    ).toEqual({
      bytesReceived: 0,
      framesDecoded: 8,
      framesPlayed: 16,
      state: 24,
      sampleRate: 28,
      channels: 32,
      bufferedFrames: 36,
      capacityFrames: 40,
      underruns: 44,
      errorCode: 48,
      readyGeneration: 52,
    })
  })

  test("audioCloseStream forwards its reason and unpacks the owned output buffer", () => {
    const calls: any[][] = []
    const original = symbols.audioCloseStream
    symbols.audioCloseStream = (...args: any[]) => {
      calls.push(args)
      AudioStreamStatsStruct.packInto(
        {
          bytesReceived: 123n,
          framesDecoded: 456n,
          framesPlayed: 321n,
          state: NativeAudioStreamState.Failed,
          sampleRate: 44_100,
          channels: 2,
          bufferedFrames: 0,
          capacityFrames: 44_100,
          underruns: 3,
          errorCode: -3,
          readyGeneration: 7,
        },
        new DataView(args[3]),
        0,
      )
      return 0
    }
    try {
      const result = lib.audioCloseStream(11 as any, 22, NativeAudioStreamCloseReason.TransportError)
      expect(calls).toHaveLength(1)
      expect(calls[0]![0]).toBe(11)
      expect(calls[0]![1]).toBe(22)
      expect(calls[0]![2]).toBe(NativeAudioStreamCloseReason.TransportError)
      expect(calls[0]![3]).toBeInstanceOf(ArrayBuffer)
      expect(result).toEqual({
        status: 0,
        stats: {
          bytesReceived: 123n,
          framesDecoded: 456n,
          framesPlayed: 321n,
          state: NativeAudioStreamState.Failed,
          sampleRate: 44_100,
          channels: 2,
          bufferedFrames: 0,
          capacityFrames: 44_100,
          underruns: 3,
          errorCode: -3,
          readyGeneration: 7,
        },
      })
      expect(ExportedAudioStreamState).toBe(NativeAudioStreamState)
    } finally {
      symbols.audioCloseStream = original
    }
  })

  test("audioWriteStream passes the byte owner directly and forwards count, zero, and errors", () => {
    const calls: any[][] = []
    const original = symbols.audioWriteStream
    const results = [3, 0, -4, 0]
    symbols.audioWriteStream = (...args: any[]) => {
      calls.push(args)
      return results.shift()
    }
    try {
      const bytes = new Uint8Array([1, 2, 3])
      expect(lib.audioWriteStream(0 as any, 1, bytes)).toBe(3)
      expect(lib.audioWriteStream(0 as any, 1, bytes)).toBe(0)
      expect(lib.audioWriteStream(0 as any, 1, bytes)).toBe(-4)
      expect(lib.audioWriteStream(0 as any, 1, new Uint8Array())).toBe(0)
      expect(calls).toHaveLength(4)
      expect(calls[0]).toHaveLength(4)
      expect(calls[0]![2]).toBe(bytes)
      expect(calls[0]![3]).toBe(bytes.byteLength)
      expect(calls[3]![2]).toBeNull()
      expect(calls[3]![3]).toBe(0)
    } finally {
      symbols.audioWriteStream = original
    }
  })

  test("stream create wrappers reject invalid groups and formats before FFI conversion", () => {
    withStubbedSymbol("audioCreateStream", (calls) => {
      expect(lib.audioSetStreamGroup(0 as any, 1, 1.5)).toBe(-1)
      expect(
        lib.audioCreateStream(0 as any, {
          capacityMs: 100,
          startupMs: 10,
          resumeMs: 10,
          maxProbeBytes: 1024 * 1024,
          format: NativeAudioStreamFormat.Mp3,
          volume: 1,
          pan: 0,
          groupId: 1.5,
        }),
      ).toEqual({ status: -1, streamId: null })
      const validOptions = {
        capacityMs: 100,
        startupMs: 10,
        resumeMs: 10,
        maxProbeBytes: 1024 * 1024,
        volume: 1,
        pan: 0,
        groupId: 0,
      }
      void lib.audioCreateStream(0 as any, {
        ...validOptions,
        format: NativeAudioStreamFormat.Flac,
      })
      expect(
        lib.audioCreateStream(0 as any, {
          ...validOptions,
          format: 1.5 as never,
        }),
      ).toEqual({ status: -1, streamId: null })
      expect(
        lib.audioCreateStream(0 as any, {
          ...validOptions,
          format: 3 as never,
        }),
      ).toEqual({ status: -1, streamId: null })
      expect(calls).toHaveLength(1)
    })
  })

  test("textBufferSetStyledText passes the packed chunk buffer as an object value", () => {
    withStubbedSymbol("textBufferSetStyledText", (calls) => {
      const chunks = [
        { text: "hello", fg: RGBA.fromValues(1, 0, 0, 1) },
        { text: "world", bg: RGBA.fromValues(0, 0, 1, 1) },
      ]

      lib.textBufferSetStyledText(0 as any, chunks)

      expect(calls).toHaveLength(1)
      expect(calls[0]![1]).toBeInstanceOf(ArrayBuffer)
      expect((calls[0]![1] as ArrayBuffer).byteLength).toBe(StyledChunkStruct.size * chunks.length)
      expect(calls[0]![2]).toBe(chunks.length)
    })
  })

  test("editorViewSetPlaceholderStyledText passes the packed chunk buffer as an object value", () => {
    withStubbedSymbol("editorViewSetPlaceholderStyledText", (calls) => {
      lib.editorViewSetPlaceholderStyledText(0 as any, [{ text: "placeholder", fg: RGBA.fromValues(0, 1, 0, 1) }])
      lib.editorViewSetPlaceholderStyledText(0 as any, [{ text: "" }])

      expect(calls).toHaveLength(2)
      expect(calls[0]![1]).toBeInstanceOf(ArrayBuffer)
      expect((calls[0]![1] as ArrayBuffer).byteLength).toBe(StyledChunkStruct.size)
      expect(calls[1]![1]).toBeNull()
      expect(calls[1]![2]).toBe(0)
    })
  })

  test("setCursorStyleOptions passes the packed options buffer as an object value", () => {
    withStubbedSymbol("setCursorStyleOptions", (calls) => {
      lib.setCursorStyleOptions(0 as any, { style: "block", blinking: true, color: RGBA.fromValues(1, 1, 0, 1) })

      expect(calls).toHaveLength(1)
      expect(calls[0]![1]).toBeInstanceOf(ArrayBuffer)
      expect((calls[0]![1] as ArrayBuffer).byteLength).toBe(CursorStyleOptionsStruct.size)
    })
  })

  test("image calls pass transient buffer owners directly", () => {
    const names = [
      "bufferDrawImage",
      "imageInfo",
      "imageDecode",
      "imageCreateFromRgba",
      "imageGetInfo",
      "imageClone",
      "imageCopyPixels",
      "imageResize",
      "imageExtract",
      "imageExtend",
      "imageTransform",
      "imageComposite",
    ] as const
    const originals = new Map<string, (...args: any[]) => any>()
    const calls = new Map<string, any[]>()
    for (const name of names) {
      originals.set(name, symbols[name]!)
      symbols[name] = (...args: any[]) => {
        calls.set(name, args)
        return 0
      }
    }

    try {
      const data = Uint8Array.of(1, 2, 3, 4)
      const pixels = Uint8Array.of(5, 6, 7, 255)
      const destination = new Uint8Array(4)
      const background = Uint8Array.of(8, 9, 10, 255)
      const handle = 1 as any

      lib.bufferDrawImage(handle, handle, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, "auto")
      lib.imageInfo(data)
      lib.imageDecode(data)
      lib.imageCreateFromRgba(pixels, 1, 1, 4)
      lib.imageGetInfo(handle)
      lib.imageClone(handle)
      lib.imageCopyPixels(handle, destination, 4, false)
      lib.imageResize(handle, 1, 1, 0)
      lib.imageExtract(handle, 0, 0, 1, 1)
      lib.imageExtend(handle, 0, 0, 0, 0, background)
      lib.imageTransform(handle, 0)
      lib.imageComposite(handle, handle, 0, 0, 0, 255)

      expect(calls.get("bufferDrawImage")![2]).toBeInstanceOf(ArrayBuffer)
      expect(calls.get("imageInfo")![0]).toBe(data)
      expect(calls.get("imageInfo")![2]).toBeInstanceOf(ArrayBuffer)
      expect(calls.get("imageDecode")![0]).toBe(data)
      expect(calls.get("imageDecode")![2]).toBeInstanceOf(Uint32Array)
      expect(calls.get("imageCreateFromRgba")![0]).toBe(pixels)
      expect(calls.get("imageCreateFromRgba")![5]).toBeInstanceOf(Uint32Array)
      expect(calls.get("imageGetInfo")![1]).toBeInstanceOf(ArrayBuffer)
      expect(calls.get("imageClone")![1]).toBeInstanceOf(Uint32Array)
      expect(calls.get("imageCopyPixels")![1]).toBe(destination)
      expect(calls.get("imageResize")![4]).toBeInstanceOf(Uint32Array)
      expect(calls.get("imageExtract")![5]).toBeInstanceOf(Uint32Array)
      expect(calls.get("imageExtend")![5]).toBe(background)
      expect(calls.get("imageExtend")![6]).toBeInstanceOf(Uint32Array)
      expect(calls.get("imageTransform")![2]).toBeInstanceOf(Uint32Array)
      expect(calls.get("imageComposite")![6]).toBeInstanceOf(Uint32Array)
    } finally {
      for (const [name, original] of originals) symbols[name] = original
    }
  })

  test("imageExtend rejects a short background before native access", () => {
    withStubbedSymbol("imageExtend", (calls) => {
      expect(lib.imageExtend(1 as any, 0, 0, 0, 0, Uint8Array.of(1, 2, 3))).toEqual({
        status: 7,
        handle: null,
      })
      expect(calls).toHaveLength(0)
    })
  })
})

describe("packed color owner retention", () => {
  test("styled chunk fg and bg colors stay readable after GC of transient chunks", async () => {
    const fgOffset = fieldOffset(StyledChunkStruct, "fg")
    const bgOffset = fieldOffset(StyledChunkStruct, "bg")

    const packTransientChunks = (count: number) => {
      const chunks = []
      const expected = []
      for (let i = 0; i < count; i++) {
        const fg = RGBA.fromValues((i % 16) / 15, 0, 1, 1)
        const bg = RGBA.fromValues(0, (i % 16) / 15, 0, 1)
        chunks.push({ text: `chunk-${i}`, fg, bg })
        expected.push({ fg: [...fg.buffer], bg: [...bg.buffer] })
      }
      // The chunk objects and their RGBA instances are unreachable after this
      // returns; only the packed buffer may keep the color memory alive.
      return { packed: StyledChunkStruct.packList(chunks), expected }
    }

    const count = 16
    const { packed, expected } = packTransientChunks(count)

    for (let round = 0; round < 20; round++) {
      const churn = []
      for (let i = 0; i < 2048; i++) {
        churn.push(new Uint16Array(4).fill(round))
      }
      await forceGc()

      for (let i = 0; i < count; i++) {
        const base = i * StyledChunkStruct.size
        expect(readPackedColor(packed, base + fgOffset)).toEqual(expected[i]!.fg)
        expect(readPackedColor(packed, base + bgOffset)).toEqual(expected[i]!.bg)
      }
    }
  })

  test("cursor style color stays readable after GC of the transient RGBA", async () => {
    const colorOffset = fieldOffset(CursorStyleOptionsStruct, "color")

    const packTransientColor = () => {
      const color = RGBA.fromValues(0.5, 0.25, 0.75, 1)
      return {
        packed: CursorStyleOptionsStruct.pack({ style: 255, blinking: 255, color, cursor: 255 }),
        expected: [...color.buffer],
      }
    }

    const { packed, expected } = packTransientColor()

    for (let round = 0; round < 20; round++) {
      const churn = []
      for (let i = 0; i < 2048; i++) {
        churn.push(new Uint16Array(4).fill(round))
      }
      await forceGc()

      expect(readPackedColor(packed, colorOffset)).toEqual(expected)
    }
  })
})
