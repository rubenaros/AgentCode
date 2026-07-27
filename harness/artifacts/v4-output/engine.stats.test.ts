import { describe, it, expect } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import type { Appointment, Service } from '../src/domain/types';

function iso(date: Date): string {
  return date.toISOString();
}

function makeAppointment(id: string, clientId: string, serviceId: string, start: Date, status: 'booked' | 'cancelled' | 'completed'): Appointment {
  const duration = 60 * 60 * 1000; // 1 hour
  return {
    id,
    clientId,
    serviceId,
    start: iso(start),
    end: iso(new Date(start.getTime() + duration)),
    status,
  };
}

describe('StatsEngine', () => {
  it('computes correct totals for a range with mixed statuses', () => {
    const repo = new InMemoryRepo(false);

    const base = new Date('2025-01-01T00:00:00.000Z');
    const day1 = new Date(base.getTime() + 1 * 86400000);
    const day2 = new Date(base.getTime() + 2 * 86400000);

    // Save services first
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 1000, upsells: [] });
    repo.saveService({ id: 'svc-corte', name: 'Corte', durationMin: 90, priceCents: 2000, upsells: [] });

    repo.saveAppointment(makeAppointment('a1', 'cli-1', 'svc-bano', day1, 'booked'));
    repo.saveAppointment(makeAppointment('a2', 'cli-2', 'svc-bano', day1, 'completed'));
    repo.saveAppointment(makeAppointment('a3', 'cli-3', 'svc-corte', day1, 'cancelled'));
    repo.saveAppointment(makeAppointment('a4', 'cli-1', 'svc-bano', day2, 'booked'));
    repo.saveAppointment(makeAppointment('a5', 'cli-2', 'svc-corte', day2, 'completed'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(new Date(day1.getTime() - 1), new Date(day2.getTime() + 86400000));

    expect(result.appointmentsTotal).toBe(5);
    expect(result.appointmentsBooked).toBe(2);
    expect(result.appointmentsCompleted).toBe(2);
    expect(result.appointmentsCancelled).toBe(1);
    expect(result.cancellationRate).toBeCloseTo(0.2, 4);
  });

  it('returns zero values for empty range', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);
    const start = new Date('2025-01-01T00:00:00.000Z');
    const end = new Date('2025-01-02T00:00:00.000Z');

    const result = engine.compute(start, end);

    expect(result.appointmentsTotal).toBe(0);
    expect(result.appointmentsBooked).toBe(0);
    expect(result.appointmentsCompleted).toBe(0);
    expect(result.appointmentsCancelled).toBe(0);
    expect(result.cancellationRate).toBe(0);
    expect(result.occupancyRate).toBe(0);
    expect(result.topServicesByBookings).toEqual([]);
    expect(result.topServicesByCancellations).toEqual([]);
    expect(result.topClientsByVisits).toEqual([]);
  });

  it('top services are ordered descending by count with stable tie-break by id', () => {
    const repo = new InMemoryRepo(false);

    const base = new Date('2025-01-01T00:00:00.000Z');
    const day1 = new Date(base.getTime() + 1 * 86400000);

    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 1000, upsells: [] });
    repo.saveService({ id: 'svc-corte', name: 'Corte', durationMin: 90, priceCents: 2000, upsells: [] });
    repo.saveService({ id: 'svc-spa', name: 'Spa', durationMin: 120, priceCents: 3000, upsells: [] });

    // svc-bano: 3 bookings
    repo.saveAppointment(makeAppointment('a1', 'cli-1', 'svc-bano', day1, 'booked'));
    repo.saveAppointment(makeAppointment('a2', 'cli-2', 'svc-bano', day1, 'booked'));
    repo.saveAppointment(makeAppointment('a3', 'cli-3', 'svc-bano', day1, 'booked'));
    // svc-corte: 2 bookings
    repo.saveAppointment(makeAppointment('a4', 'cli-1', 'svc-corte', day1, 'booked'));
    repo.saveAppointment(makeAppointment('a5', 'cli-2', 'svc-corte', day1, 'booked'));
    // svc-spa: 2 bookings (tie with corte, but corte < spa alphabetically)
    repo.saveAppointment(makeAppointment('a6', 'cli-3', 'svc-spa', day1, 'booked'));
    repo.saveAppointment(makeAppointment('a7', 'cli-1', 'svc-spa', day1, 'booked'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(new Date(day1.getTime() - 1), new Date(day1.getTime() + 86400000));

    expect(result.topServicesByBookings.map(s => s.serviceId)).toEqual(['svc-bano', 'svc-corte', 'svc-spa']);
  });

  it('top clients by visits counts all statuses', () => {
    const repo = new InMemoryRepo(false);

    const base = new Date('2025-01-01T00:00:00.000Z');
    const day1 = new Date(base.getTime() + 1 * 86400000);
    const day2 = new Date(base.getTime() + 2 * 86400000);

    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 1000, upsells: [] });

    // cli-1: 3 visits (booked, completed, cancelled)
    repo.saveAppointment(makeAppointment('a1', 'cli-1', 'svc-bano', day1, 'booked'));
    repo.saveAppointment(makeAppointment('a2', 'cli-1', 'svc-bano', day1, 'completed'));
    repo.saveAppointment(makeAppointment('a3', 'cli-1', 'svc-bano', day2, 'cancelled'));
    // cli-2: 1 visit
    repo.saveAppointment(makeAppointment('a4', 'cli-2', 'svc-bano', day1, 'booked'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(new Date(day1.getTime() - 1), new Date(day2.getTime() + 86400000));

    expect(result.topClientsByVisits.map(c => c.clientId)).toEqual(['cli-1', 'cli-2']);
    expect(result.topClientsByVisits[0].count).toBe(3);
    expect(result.topClientsByVisits[1].count).toBe(1);
  });

  it('cancellationRate is 0 when total is 0', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);
    const start = new Date('2025-01-01T00:00:00.000Z');
    const end = new Date('2025-01-02T00:00:00.000Z');

    const result = engine.compute(start, end);
    expect(result.cancellationRate).toBe(0);
  });

  it('occupancyRate correctly computes working minutes', () => {
    const repo = new InMemoryRepo(false);

    const base = new Date('2025-01-01T00:00:00.000Z');
    const day1 = new Date(base.getTime() + 1 * 86400000);
    day1.setUTCHours(10, 0, 0, 0);

    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 1000, upsells: [] });

    // One booked appointment of 60 min
    repo.saveAppointment(makeAppointment('a1', 'cli-1', 'svc-bano', day1, 'booked'));

    const engine = new StatsEngine(repo);
    // Range covers 1 working day: 9:00-18:00 = 540 min
    const result = engine.compute(new Date(day1.getTime() - 86400000), new Date(day1.getTime() + 86400000));

    // 60 min booked / 540 min working = 0.1111...
    expect(result.occupancyRate).toBeCloseTo(60 / 540, 4);
  });
});
