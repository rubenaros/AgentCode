import { describe, it, expect } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import type { Appointment } from '../src/domain/types';

function iso(date: Date): string {
  return date.toISOString();
}

function makeAppt(id: string, clientId: string, serviceId: string, start: Date, status: 'booked' | 'cancelled' | 'completed'): Appointment {
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

describe('StatsEngine e2e', () => {
  it('a week with mixed status: total=10, cancellationRate=0.2, ordered tops', () => {
    const repo = new InMemoryRepo(false);

    // Seed services
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 1000, upsells: [] });
    repo.saveService({ id: 'svc-corte', name: 'Corte', durationMin: 60, priceCents: 2000, upsells: [] });
    repo.saveService({ id: 'svc-spa', name: 'Spa', durationMin: 60, priceCents: 3000, upsells: [] });

    const base = new Date('2025-01-01T00:00:00.000Z');

    // 7 days of appointments (1 per day)
    // Day 1-5: booked
    for (let i = 0; i < 5; i++) {
      const day = new Date(base.getTime() + i * 86400000);
      day.setUTCHours(10, 0, 0, 0);
      repo.saveAppointment(makeAppt(`a${i}`, 'cli-1', 'svc-bano', day, 'booked'));
    }
    // Day 6: cancelled
    const day6 = new Date(base.getTime() + 5 * 86400000);
    day6.setUTCHours(10, 0, 0, 0);
    repo.saveAppointment(makeAppt('a5', 'cli-2', 'svc-corte', day6, 'cancelled'));
    // Day 7: cancelled
    const day7 = new Date(base.getTime() + 6 * 86400000);
    day7.setUTCHours(10, 0, 0, 0);
    repo.saveAppointment(makeAppt('a6', 'cli-3', 'svc-corte', day7, 'cancelled'));
    // Day 8: completed
    const day8 = new Date(base.getTime() + 7 * 86400000);
    day8.setUTCHours(10, 0, 0, 0);
    repo.saveAppointment(makeAppt('a7', 'cli-1', 'svc-spa', day8, 'completed'));
    // Day 9: completed
    const day9 = new Date(base.getTime() + 8 * 86400000);
    day9.setUTCHours(10, 0, 0, 0);
    repo.saveAppointment(makeAppt('a8', 'cli-2', 'svc-spa', day9, 'completed'));
    // Day 10: completed
    const day10 = new Date(base.getTime() + 9 * 86400000);
    day10.setUTCHours(10, 0, 0, 0);
    repo.saveAppointment(makeAppt('a9', 'cli-3', 'svc-bano', day10, 'completed'));

    const engine = new StatsEngine(repo);
    const rangeStart = new Date(base.getTime() - 86400000);
    const rangeEnd = new Date(base.getTime() + 10 * 86400000);
    const result = engine.compute(rangeStart, rangeEnd);

    // Total: 10 appointments
    expect(result.appointmentsTotal).toBe(10);
    // Booked: 5, Cancelled: 2, Completed: 3
    expect(result.appointmentsBooked).toBe(5);
    expect(result.appointmentsCancelled).toBe(2);
    expect(result.appointmentsCompleted).toBe(3);
    // Cancellation rate: 2/10 = 0.2
    expect(result.cancellationRate).toBeCloseTo(0.2, 4);

    // Top services by bookings: svc-bano (5 booked) > svc-spa (0 booked but has completed) > svc-corte (0)
    // Actually: svc-bano has 5 booked, svc-spa has 0 booked, svc-corte has 0 booked
    expect(result.topServicesByBookings.map(s => s.serviceId)).toEqual(['svc-bano', 'svc-corte', 'svc-spa']);

    // Top services by cancellations: svc-corte (2) > svc-bano (0) > svc-spa (0)
    expect(result.topServicesByCancellations.map(s => s.serviceId)).toEqual(['svc-corte', 'svc-bano', 'svc-spa']);

    // Top clients by visits: cli-1 (6 visits: 5 booked + 1 completed), cli-2 (3 visits: 1 cancelled + 1 completed + 1 booked... wait)
    // cli-1: a0-a4 (5 booked) + a7 (completed) = 6
    // cli-2: a5 (cancelled) + a8 (completed) = 2
    // cli-3: a6 (cancelled) + a9 (completed) = 2
    expect(result.topClientsByVisits[0].clientId).toBe('cli-1');
    expect(result.topClientsByVisits[0].count).toBe(6);
    // cli-2 and cli-3 tie at 2, stable sort by id: cli-2 < cli-3
    expect(result.topClientsByVisits[1].clientId).toBe('cli-2');
    expect(result.topClientsByVisits[2].clientId).toBe('cli-3');
  });
});
