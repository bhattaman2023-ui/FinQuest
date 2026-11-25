import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import api from '@/api/client';
import HomePage from './HomePage';

describe('HomePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a retryable error when the portfolio request fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('API unavailable'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Could not load your portfolio.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
