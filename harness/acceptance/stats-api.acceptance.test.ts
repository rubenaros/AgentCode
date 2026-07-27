/**
 * IMMUTABLE ACCEPTANCE SUITE — Stats API endpoint (petdesk-v3 feature)
 *
 * Kept separate from the engine suite on purpose: this file imports a Next.js
 * route handler, and if that import fails the engine verdict must still stand.
 *
 * Assertions are shape-level. The endpoint is wired to the shared repo
 * singleton, whose seed data is not part of the contract, so asserting concrete
 * aggregate values here would test the fixture rather than the implementation.
 * Numeric semantics are covered by stats-engine.acceptance.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/stats/route';

const STATS_KEYS = [
  'rangeStart',
  'rangeEnd',
  'appointmentsTotal',
  'appointmentsBooked',
  'appointmentsCompleted',
  'appointmentsCancelled',
  'cancellationRate',
  'occupancyRate',
  'topServicesByBookings',
  'topServicesByCancellations',
  'topClientsByVisits',
] as const;

/**
 * Drives the handler with a NextRequest. It extends Request, so this works
 * whether the implementation reads request.nextUrl.searchParams (the Next
 * idiom) or new URL(request.url).searchParams (the plain-Request idiom).
 */
async function callGet(url: string) {
  const res = await GET(new NextRequest(url));
  return { res, body: await res.json() };
}

describe('acceptance: GET /api/stats', () => {
  it('answers 200 with the bundle under a "stats" key', async () => {
    const { res, body } = await callGet(
      'http://localhost/api/stats?start=2026-03-02T00:00:00.000Z&end=2026-03-05T00:00:00.000Z',
    );

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('stats');
    for (const key of STATS_KEYS) {
      expect(body.stats).toHaveProperty(key);
    }
  });

  it('honours the start and end query parameters', async () => {
    const start = '2026-03-02T00:00:00.000Z';
    const end = '2026-03-05T00:00:00.000Z';

    const { body } = await callGet(`http://localhost/api/stats?start=${start}&end=${end}`);

    expect(new Date(body.stats.rangeStart).toISOString()).toBe(start);
    expect(new Date(body.stats.rangeEnd).toISOString()).toBe(end);
  });

  it('falls back to the last 30 days when the range is missing', async () => {
    const { res, body } = await callGet('http://localhost/api/stats');

    expect(res.status).toBe(200);

    const spanMs =
      new Date(body.stats.rangeEnd).getTime() - new Date(body.stats.rangeStart).getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    // One minute of slack absorbs the clock read between handler and assertion.
    expect(Math.abs(spanMs - THIRTY_DAYS_MS)).toBeLessThan(60_000);
  });

  it('returns rates inside [0, 1] and non-negative volumes', async () => {
    const { body } = await callGet('http://localhost/api/stats');
    const stats = body.stats;

    expect(stats.cancellationRate).toBeGreaterThanOrEqual(0);
    expect(stats.cancellationRate).toBeLessThanOrEqual(1);
    expect(stats.occupancyRate).toBeGreaterThanOrEqual(0);
    expect(stats.occupancyRate).toBeLessThanOrEqual(1);
    expect(stats.appointmentsTotal).toBeGreaterThanOrEqual(0);
  });

  it('caps every top list at 5 entries', async () => {
    const { body } = await callGet('http://localhost/api/stats');
    const stats = body.stats;

    expect(stats.topServicesByBookings.length).toBeLessThanOrEqual(5);
    expect(stats.topServicesByCancellations.length).toBeLessThanOrEqual(5);
    expect(stats.topClientsByVisits.length).toBeLessThanOrEqual(5);
  });
});
