import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import { StatsEngine } from '../src/engine/stats';

describe('StatsEngine — engine unit tests (seeded repo)', () => {
  it('appointmentsTotal counts all appointments in range regardless of status', () => {
    const repo = new InMemoryRepo(true); // uses seeded data
    const engine = new StatsEngine(repo);

    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2027-12-31T00:00:00.000Z');
    const stats = engine.compute(start, end);

    // Seeded repo has 1 appointment (appt-1 with status 'booked')
    expect(stats.appointmentsTotal).toBe(1);
  });

  it('cancellationRate is correctly computed as cancelled/total', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const start = new Date('2099-01-01T00:00:00.000Z');
    const end = new Date('2099-01-02T00:00:00.000Z');

    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-01T10:00:00.000Z',
      end: '2099-01-01T11:00:00.000Z',
      status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-2', serviceId: 'svc-1',
      start: '2099-01-01T12:00:00.000Z',
      end: '2099-01-01T13:00:00.000Z',
      status: 'cancelled',
    });

    const stats = engine.compute(start, end);

    expect(stats.appointmentsTotal).toBe(2);
    expect(stats.appointmentsCancelled).toBe(1);
    expect(stats.cancellationRate).toBe(0.5);
  });

  it('cancellationRate is 0 when total is 0', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const stats = engine.compute(
      new Date('2099-01-01T00:00:00.000Z'),
      new Date('2099-01-02T00:00:00.000Z'),
    );

    expect(stats.appointmentsTotal).toBe(0);
    expect(stats.cancellationRate).toBe(0);
  });

  it('sum of booked + completed + cancelled equals total', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-03T00:00:00.000Z');

    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-2', serviceId: 'svc-2',
      start: '2099-01-01T12:00:00.000Z', end: '2099-01-01T13:30:00.000Z', status: 'completed',
    });
    repo.saveAppointment({
      id: 'a-3', clientId: 'cli-3', serviceId: 'svc-1',
      start: '2099-01-02T09:00:00.000Z', end: '2099-01-02T10:00:00.000Z', status: 'cancelled',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.appointmentsBooked + stats.appointmentsCompleted + stats.appointmentsCancelled)
      .toBe(stats.appointmentsTotal);
  });

  it('occupancyRate is correctly computed for booked+completed appointments', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    // 1 working day = 540 minutes (9:00-18:00)
    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-02T00:00:00.000Z');

    // Booked appointment: 60 min
    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'booked',
    });
    // Completed appointment: 90 min
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-2', serviceId: 'svc-2',
      start: '2099-01-01T13:00:00.000Z', end: '2099-01-01T14:30:00.000Z', status: 'completed',
    });
    // Cancelled: 120 min — should NOT count toward occupancy
    repo.saveAppointment({
      id: 'a-3', clientId: 'cli-3', serviceId: 'svc-3',
      start: '2099-01-01T09:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'cancelled',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    // 150 min used / 540 min available = 0.2778
    expect(stats.occupancyRate).toBeCloseTo(150 / 540, 4);
  });

  it('top services by bookings returns top 5 sorted descending with stable tie-break by id', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-02T00:00:00.000Z');

    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-b',
      start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-2', serviceId: 'svc-a',
      start: '2099-01-01T12:00:00.000Z', end: '2099-01-01T13:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-3', clientId: 'cli-3', serviceId: 'svc-a',
      start: '2099-01-01T14:00:00.000Z', end: '2099-01-01T15:00:00.000Z', status: 'completed',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    // svc-a: 1 booked, svc-b: 1 booked — tie, break by id ascending
    expect(stats.topServicesByBookings).toEqual([
      { serviceId: 'svc-a', count: 1 },
      { serviceId: 'svc-b', count: 1 },
    ]);
  });

  it('top clients by visits counts booked + completed only', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-03T00:00:00.000Z');

    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-1', serviceId: 'svc-2',
      start: '2099-01-02T10:00:00.000Z', end: '2099-01-02T11:00:00.000Z', status: 'cancelled',
    });
    repo.saveAppointment({
      id: 'a-3', clientId: 'cli-2', serviceId: 'svc-1',
      start: '2099-01-01T12:00:00.000Z', end: '2099-01-01T13:00:00.000Z', status: 'completed',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    // cli-1: 1 visit (booked), cli-2: 1 visit (completed) — tie, break by id
    expect(stats.topClientsByVisits).toEqual([
      { clientId: 'cli-1', count: 1 },
      { clientId: 'cli-2', count: 1 },
    ]);
  });
});
