// Wave-5 staged FFI binding: the eager CORE symbol set.
//
// Lives in its own module so the package barrel (src/index.ts re-exports
// zig.ts) does not surface FFI-staging mechanics as public API. zig.ts imports
// from here; the binding tests do the same.
//
// CORE = the 51 symbols the FFIRenderLib ctor + first native frame touch
// (committed M1 access trace, packages/core/.yesmem/bench/wave5-symbol-access-
// trace.json) plus the 4 render-commit trigger symbols (render,
// renderPartial, repaintSplitFooter, commitSplitFooterSnapshot): a real
// interactive first commit calls render()/renderPartial(), so the trigger path
// that should stay fast must be eager, not trapped on the critical path. All
// other symbols are DEFERRED: lazy-bound through the proxy on first use and
// pre-bound in full when the first commit fires.
export const opentuiCoreSymbols: readonly string[] = [
  "addToHitGrid",
  "bufferClear",
  "bufferDrawTextBufferView",
  "commitSplitFooterSnapshot",
  "createEventSink",
  "createNativeRenderable",
  "createRenderer",
  "createSyntaxStyle",
  "createTextBuffer",
  "createTextBufferView",
  "getBufferHeight",
  "getBufferWidth",
  "getCurrentBuffer",
  "getNextBuffer",
  "hitGridClearScissorRects",
  "imageRetainIccCache",
  "nativeRenderableAttachYogaNode",
  "nativeRenderableSetMeasureTarget",
  "render",
  "renderPartial",
  "renderRetained",
  "repaintSplitFooter",
  "resetSplitScrollback",
  "resizeRenderer",
  "setClearOnShutdown",
  "setKittyKeyboardFlags",
  "setLogCallback",
  "setRenderOffset",
  "setTerminalEnvVar",
  "setUseThread",
  "textBufferGetByteSize",
  "textBufferGetLength",
  "textBufferSetDefaultAttributes",
  "textBufferSetDefaultBg",
  "textBufferSetDefaultFg",
  "textBufferSetStyledText",
  "textBufferSetSyntaxStyle",
  "textBufferViewSetFirstLineOffset",
  "textBufferViewSetTruncate",
  "textBufferViewSetViewport",
  "textBufferViewSetWrapMode",
  "textBufferViewSetWrapWidth",
  "yogaNodeCalculateLayout",
  "yogaNodeCreateForOpenTUI",
  "yogaNodeFree",
  "yogaNodeGetComputedLayout",
  "yogaNodeInsertChild",
  "yogaNodeIsDirty",
  "yogaNodeMarkDirty",
  "yogaNodeSetHasNewLayout",
  "yogaNodeStyleSetEnum",
  "yogaNodeStyleSetFloat",
  "yogaNodeStyleSetValue",
  "yogaNodeUnsetDirtiedFunc",
  "yogaNodeUnsetMeasureFunc",
]
