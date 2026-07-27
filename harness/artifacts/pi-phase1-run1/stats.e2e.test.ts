import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import { StatsEngine } from '../src/engine/stats';

/**
 * E2E test: one week with mixed statuses.
 * Expected: appointmentsTotal=10, cancellationRate=0.2, ordered tops.
 * Booked: 5, Completed: 3, Cancelled: 2
 */
describe('StatsEngine — e2e: mixed week', () => {
  it('computes stats over a week with 10 appointments (total=10, cancellationRate=0.2)', () => {
    const repo = new InMemoryRepo(false);

    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-04T00:00:00.000Z'); // Monday
    const rangeEnd = new Date('2099-01-11T00:00:00.000Z');   // next Monday (exclusive)

    // 10 appointments across the week:
    //   booked: 4, completed: 4, cancelled: 2 → total=10, cancellationRate=0.2
    // Services: svc-bano(4), svc-corte(4), svc-spa(2)
    // Clients: cli-ana(5), cli-bob(5)

    // Tuesday: 2 appointments
    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-ana', serviceId: 'svc-bano',
      start: '2099-01-05T10:00:00.000Z', end: '2099-01-05T11:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-bob', serviceId: 'svc-bano',
      start: '2099-01-05T12:00:00.000Z', end: '2099-01-05T13:00:00.000Z', status: 'completed',
    });

    // Wednesday: 3 appointments
    repo.saveAppointment({
      id: 'a-3', clientId: 'cli-ana', serviceId: 'svc-corte',
      start: '2099-01-06T09:00:00.000Z', end: '2099-01-06T10:30:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-4', clientId: 'cli-bob', serviceId: 'svc-spa',
      start: '2099-01-06T13:00:00.000Z', end: '2099-01-06T15:00:00.000Z', status: 'completed',
    });
    repo.saveAppointment({
      id: 'a-5', clientId: 'cli-bob', serviceId: 'svc-bano',
      start: '2099-01-06T16:00:00.000Z', end: '2099-01-06T17:00:00.000Z', status: 'booked',
    });

    // Thursday: 3 appointments
    repo.saveAppointment({
      id: 'a-6', clientId: 'cli-ana', serviceId: 'svc-corte',
      start: '2099-01-07T10:00:00.000Z', end: '2099-01-07T11:30:00.000Z', status: 'completed',
    });
    repo.saveAppointment({
      id: 'a-7', clientId: 'cli-ana', serviceId: 'svc-bano',
      start: '2099-01-07T13:00:00.000Z', end: '2099-01-07T14:00:00.000Z', status: 'cancelled',
    });
    repo.saveAppointment({
      id: 'a-8', clientId: 'cli-bob', serviceId: 'svc-corte',
      start: '2099-01-07T15:00:00.000Z', end: '2099-01-07T16:30:00.000Z', status: 'booked',
    });

    // Friday: 2 appointments
    repo.saveAppointment({
      id: 'a-9', clientId: 'cli-bob', serviceId: 'svc-spa',
      start: '2099-01-08T10:00:00.000Z', end: '2099-01-08T12:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-10', clientId: 'cli-bob', serviceId: 'svc-corte',
      start: '2099-01-08T13:00:00.000Z', end: '2099-01-08T14:30:00.000Z', status: 'cancelled',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    // --- Volume checks ---
    expect(stats.appointmentsTotal).toBe(10);
    expect(stats.appointmentsBooked).toBe(5);
    expect(stats.appointmentsCompleted).toBe(3);
    expect(stats.appointmentsCancelled).toBe(2);
    expect(stats.cancellationRate).toBe(0.2);

    // --- Top services by bookings (only booked status) ---
    // svc-bano: 2 booked (a-1, a-5)
    // svc-corte: 2 booked (a-3, a-8)
    // svc-spa: 1 booked (a-9)
    expect(stats.topServicesByBookings).toEqual([
      { serviceId: 'svc-bano', count: 2 },
      { serviceId: 'svc-corte', count: 2 },
      { serviceId: 'svc-spa', count: 1 },
    ]);

    // --- Top services by cancellations ---
    // svc-bano: 1 (a-7)
    // svc-corte: 1 (a-10)
    expect(stats.topServicesByCancellations).toEqual([
      { serviceId: 'svc-bano', count: 1 },
      { serviceId: 'svc-corte', count: 1 },
    ]);

    // --- Top clients by visits (booked + completed) ---
    // cli-ana: 5 visits (a-1 booked, a-3 booked, a-6 completed, a-2 completed, a-5 booked)
    // Wait, let me recount:
    // cli-ana: a-1(booked), a-3(booked), a-6(completed) = 3 visits
    // cli-bob: a-2(completed), a-5(booked), a-4(completed), a-8(booked), a-9(booked) = 5 visits
    expect(stats.topClientsByVisits).toEqual([
      { clientId: 'cli-bob', count: 5 },
      { clientId: 'cli-ana', count: 3 },
    ]);
  });
});
