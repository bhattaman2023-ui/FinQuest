import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import api from '@/api/client';
import InsightsPage from './InsightsPage';

describe('Insights ML tab', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows mapped UP, DOWN and SIDEWAYS probabilities, horizon and Yahoo provenance', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/ml-prediction/')) {
        return { data: {
          prediction: 'UP',
          probabilities: { UP: 0.61, DOWN: 0.17, SIDEWAYS: 0.22 },
          confidenceUp: 0.61,
          confidenceDown: 0.17,
          confidenceSideways: 0.22,
          horizonDays: 5,
          dataSource: 'YFINANCE_NS',
          lastDataDate: '2026-11-27',
          predictedAt: '2026-11-28T10:15:00Z',
          source: 'ml_service',
        } } as never;
      }
      if (path.includes('/model-info')) {
        return { data: { status: 'NOT_TRAINED' } } as never;
      }
      return { data: { metrics: { totalReturnPct: 1, volatilityPct: 1, maxDrawdownPct: 1, dataPoints: 1 }, prices: [] } } as never;
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><InsightsPage /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'ML Classifier' }));

    expect(await screen.findByText('5-day movement classification')).toBeInTheDocument();
    expect(screen.getByText(/Data: YFINANCE_NS/)).toBeInTheDocument();
    expect(screen.getByText(/latest session 2026-11-27/)).toBeInTheDocument();
    expect(screen.getByText(/Predicted at:/)).toBeInTheDocument();
    expect(screen.getByText('61.0%')).toBeInTheDocument();
    expect(screen.getByText('17.0%')).toBeInTheDocument();
    expect(screen.getByText('22.0%')).toBeInTheDocument();
  });
});
