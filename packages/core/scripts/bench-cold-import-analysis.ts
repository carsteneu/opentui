import {
  analyzePairedObservations,
  createPairedSchedule,
  withinRegressionBudget,
  type PairedObservation,
  type PairedOrder,
} from "../src/benchmark/ffi-fast-path-paired-analysis.js"

export interface ColdImportMeasurement {
  importMs: number
  ttfmMs: number
}

export interface ColdImportPair {
  pair: number
  order: PairedOrder
  gapMs: number
  baseline: ColdImportMeasurement
  candidate: ColdImportMeasurement
}

export interface ColdImportAnalysisOptions {
  bootstrapSamples?: number
  confidence?: number
  maximumRegression?: number
  minimumPairs?: number
  seed?: number
}

export function createColdImportSchedule(pairs: number, seed: number): Array<{ pair: number; order: PairedOrder }> {
  return createPairedSchedule(["cold-import"], ["bun"], pairs, seed).map(({ pair, order }) => ({ pair, order }))
}

export function analyzeColdImportPairs(pairs: readonly ColdImportPair[], options: ColdImportAnalysisOptions = {}) {
  const bootstrapSamples = options.bootstrapSamples ?? 20_000
  const confidence = options.confidence ?? 0.95
  const maximumRegression = options.maximumRegression ?? 0.03
  const minimumPairs = options.minimumPairs ?? 10
  const seed = options.seed ?? 1
  const familywiseConfidence = 1 - (1 - confidence) / 2
  const metrics = {
    importMs: analyzeMetricWithIntervals(pairs, "importMs", bootstrapSamples, confidence, familywiseConfidence, seed),
    ttfmMs: analyzeMetricWithIntervals(
      pairs,
      "ttfmMs",
      bootstrapSamples,
      confidence,
      familywiseConfidence,
      seed ^ 0x9e3779b9,
    ),
  }
  const enoughPairs = pairs.length >= minimumPairs
  const metricPasses = {
    importMs: enoughPairs && withinRegressionBudget(metrics.importMs.familywise.ci.upper, maximumRegression),
    ttfmMs: enoughPairs && withinRegressionBudget(metrics.ttfmMs.familywise.ci.upper, maximumRegression),
  }

  return {
    metrics,
    safety: {
      criterion: `${Math.round(confidence * 100)}% familywise bootstrap CI upper bound <= ${maximumRegression * 100}% for importMs and ttfmMs`,
      confidence,
      perMetricConfidence: familywiseConfidence,
      maximumRegression,
      minimumPairs,
      enoughPairs,
      metricPasses,
      passed: metricPasses.importMs && metricPasses.ttfmMs,
    },
  }
}

function analyzeMetricWithIntervals(
  pairs: readonly ColdImportPair[],
  metric: keyof ColdImportMeasurement,
  bootstrapSamples: number,
  nominalConfidence: number,
  familywiseConfidence: number,
  seed: number,
) {
  const observations: PairedObservation[] = pairs.map((pair) => ({
    pair: pair.pair,
    order: pair.order,
    gapMs: pair.gapMs,
    baselineNsPerOp: pair.baseline[metric],
    candidateNsPerOp: pair.candidate[metric],
  }))
  return {
    nominal: analyzePairedObservations(observations, bootstrapSamples, nominalConfidence, seed),
    familywise: analyzePairedObservations(observations, bootstrapSamples, familywiseConfidence, seed),
  }
}
