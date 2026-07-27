import { describe, it, expect } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import type { Appointment } from '../src/domain/types';

function iso(date: Date): string {
  return date.toISOString();
}

function makeAppt(
  id: string,
  clientId: string,
  serviceId: string,
  start: Date,
  status: 'booked' | 'cancelled' | 'completed',
): Appointment {
  const duration = 60 * 60 * 1000;
  return {
    id,
    clientId,
    serviceId,
    start: iso(start),
    end: iso(new Date(start.getTime() + duration)),
    status,
  };
}

describe('StatsEngine edge cases', () => {
  it('empty range returns all zeros', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);
    const result = engine.compute(
      new Date('2025-01-01T00:00:00.000Z'),
      new Date('2025-01-01T00:00:00.000Z'),
    );
    expect(result.appointmentsTotal).toBe(0);
    expect(result.cancellationRate).toBe(0);
    expect(result.occupancyRate).toBe(0);
    expect(result.topServicesByBookings).toEqual([]);
    expect(result.topServicesByCancellations).toEqual([]);
    expect(result.topClientsByVisits).toEqual([]);
  });

  it('all cancelled: cancellationRate=1', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-x', name: 'X', durationMin: 60, priceCents: 100, upsells: [] });
    const base = new Date('2025-01-01T00:00:00.000Z');
    for (let i = 0; i < 3; i++) {
      const day = new Date(base.getTime() + i * 86400000);
      day.setUTCHours(10, 0, 0, 0);
      repo.saveAppointment(makeAppt(`a${i}`, 'cli-1', 'svc-x', day, 'cancelled'));
    }
    const engine = new StatsEngine(repo);
    const result = engine.compute(
      new Date(base.getTime() - 86400000),
      new Date(base.getTime() + 3 * 86400000),
    );
    expect(result.appointmentsTotal).toBe(3);
    expect(result.appointmentsCancelled).toBe(3);
    expect(result.cancellationRate).toBeCloseTo(1, 4);
    // Occupancy: cancelled appointments don't count toward occupancy
    expect(result.occupancyRate).toBe(0);
  });

  it('occupancy 100%: full day booked', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-x', name: 'X', durationMin: 60, priceCents: 100, upsells: [] });
    const base = new Date('2025-01-01T00:00:00.000Z');
    // 9 appointments of 60 min each = 540 min = full day
    for (let h = 9; h < 18; h++) {
      const day = new Date(base.getTime());
      day.setUTCHours(h, 0, 0, 0);
      repo.saveAppointment(makeAppt(`a${h}`, 'cli-1', 'svc-x', day, 'booked'));
    }
    const engine = new StatsEngine(repo);
    const result = engine.compute(
      new Date(base.getTime() - 86400000),
      new Date(base.getTime() + 86400000),
    );
    expect(result.occupancyRate).toBeCloseTo(1, 4);
  });

  it('ties in top services: stable sort by id ascending', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-c', name: 'C', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveService({ id: 'svc-a', name: 'A', durationMin: 60, priceCents: 200, upsells: [] });
    repo.saveService({ id: 'svc-b', name: 'B', durationMin: 60, priceCents: 300, upsells: [] });
    const base = new Date('2025-01-01T00:00:00.000Z');
    base.setUTCHours(10, 0, 0, 0);
    // All have 1 booking each
    repo.saveAppointment(makeAppt('a1', 'cli-1', 'svc-c', base, 'booked'));
    const day2 = new Date(base.getTime() + 86400000);
    repo.saveAppointment(makeAppt('a2', 'cli-1', 'svc-a', day2, 'booked'));
    const day3 = new Date(base.getTime() + 2 * 86400000);
    repo.saveAppointment(makeAppt('a3', 'cli-1', 'svc-b', day3, 'booked'));
    const engine = new StatsEngine(repo);
    const result = engine.compute(
      new Date(base.getTime() - 86400000),
      new Date(base.getTime() + 3 * 86400000),
    );
    // All have count=1, tie-break by id ascending: svc-a, svc-b, svc-c
    expect(result.topServicesByBookings.map((s) => s.serviceId)).toEqual(['svc-a', 'svc-b', 'svc-c']);
    expect(result.topServicesByCancellations.map((s) => s.serviceId)).toEqual(['svc-a', 'svc-b', 'svc-c']);
  });

  it('top 5 limit: more than 5 services only returns 5', () => {
    const repo = new InMemoryRepo(false);
    for (let i = 0; i < 7; i++) {
      repo.saveService({
        id: `svc-${i}`,
        name: `S${i}`,
        durationMin: 60,
        priceCents: 100,
        upsells: [],
      });
    }
    const base = new Date('2025-01-01T00:00:00.000Z');
    base.setUTCHours(10, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const day = new Date(base.getTime() + i * 86400000);
      repo.saveAppointment(makeAppt(`a${i}`, 'cli-1', `svc-${i}`, day, 'booked'));
    }
    const engine = new StatsEngine(repo);
    const result = engine.compute(
      new Date(base.getTime() - 86400000),
      new Date(base.getTime() + 7 * 86400000),
    );
    expect(result.topServicesByBookings.length).toBe(5);
    // All have count=1, sorted by id: svc-0, svc-1, svc-2, svc-3, svc-4
    expect(result.topServicesByBookings.map((s) => s.serviceId)).toEqual(['svc-0', 'svc-1', 'svc-2', 'svc-3', 'svc-4']);
  });

  it('completed appointments count for occupancy but not for bookings', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-x', name: 'X', durationMin: 60, priceCents: 100, upsells: [] });
    const base = new Date('2025-01-01T00:00:00.000Z');
    base.setUTCHours(10, 0, 0, 0);
    repo.saveAppointment(makeAppt('a1', 'cli-1', 'svc-x', base, 'completed'));
    const engine = new StatsEngine(repo);
    const result = engine.compute(
      new Date(base.getTime() - 86400000),
      new Date(base.getTime() + 86400000),
    );
    expect(result.appointmentsTotal).toBe(1);
    expect(result.appointmentsCompleted).toBe(1);
    expect(result.appointmentsBooked).toBe(0);
    expect(result.topServicesByBookings).toEqual([{ serviceId: 'svc-x', count: 0 }]);
    // Occupancy: completed counts toward occupancy
    expect(result.occupancyRate).toBeCloseTo(60 / 540, 4);
  });
});
