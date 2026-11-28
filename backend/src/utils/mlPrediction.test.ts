import { mapMlPrediction } from './mlPrediction';

describe('mapMlPrediction', () => {
  it('maps all nested FastAPI class probabilities and provenance', () => {
    expect(mapMlPrediction({
      prediction: 'UP',
      probabilities: { UP: 0.61, DOWN: 0.17, SIDEWAYS: 0.22 },
      data_source: 'YFINANCE_NS',
      last_data_date: '2026-11-27',
      horizon_days: 5,
    })).toMatchObject({
      confidenceUp: 0.61,
      confidenceDown: 0.17,
      confidenceSideways: 0.22,
      dataSource: 'YFINANCE_NS',
      lastDataDate: '2026-11-27',
      horizonDays: 5,
    });
  });

  it('rejects malformed probability values instead of displaying them', () => {
    expect(mapMlPrediction({ probabilities: { UP: 1.2, DOWN: '0.2', SIDEWAYS: NaN } })).toMatchObject({
      confidenceUp: null,
      confidenceDown: null,
      confidenceSideways: null,
    });
  });
});
