type ProbabilityValue = number | null;

function probability(value: unknown): ProbabilityValue {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/** Normalize FastAPI snake_case/nested probabilities for the React client. */
export function mapMlPrediction(payload: Record<string, any>) {
  const probabilities = payload.probabilities ?? {};
  return {
    ...payload,
    confidenceUp: probability(probabilities.UP ?? payload.confidenceUp ?? payload.confidence_up),
    confidenceDown: probability(probabilities.DOWN ?? payload.confidenceDown ?? payload.confidence_down),
    confidenceSideways: probability(probabilities.SIDEWAYS ?? payload.confidenceSideways ?? payload.confidence_sideways),
    dataSource: payload.data_source ?? payload.dataSource ?? null,
    lastDataDate: payload.last_data_date ?? payload.lastDataDate ?? null,
    horizonDays: payload.horizon_days ?? payload.horizonDays ?? 5,
  };
}
