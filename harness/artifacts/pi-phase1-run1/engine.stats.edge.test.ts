import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import { StatsEngine } from '../src/engine/stats';

describe('StatsEngine — edge cases', () => {
  it('empty range: no appointments, all rates are 0, tops are empty', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const stats = engine.compute(
      new Date('2099-01-01T00:00:00.000Z'),
      new Date('2099-01-02T00:00:00.000Z'),
    );

    expect(stats.appointmentsTotal).toBe(0);
    expect(stats.appointmentsBooked).toBe(0);
    expect(stats.appointmentsCompleted).toBe(0);
    expect(stats.appointmentsCancelled).toBe(0);
    expect(stats.cancellationRate).toBe(0);
    expect(stats.occupancyRate).toBe(0);
    expect(stats.topServicesByBookings).toEqual([]);
    expect(stats.topServicesByCancellations).toEqual([]);
    expect(stats.topClientsByVisits).toEqual([]);
  });

  it('all cancelled: cancellationRate=1, occupancy=0', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-02T00:00:00.000Z');

    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'cancelled',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-2', serviceId: 'svc-2',
      start: '2099-01-01T13:00:00.000Z', end: '2099-01-01T14:00:00.000Z', status: 'cancelled',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.appointmentsTotal).toBe(2);
    expect(stats.appointmentsCancelled).toBe(2);
    expect(stats.cancellationRate).toBe(1);
    expect(stats.occupancyRate).toBe(0);
    expect(stats.topServicesByBookings).toEqual([]);
  });

  it('occupancy 100%: booked appointments fill entire working day', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-02T00:00:00.000Z');

    // Booked 9h (540 min) = full working day
    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-01T09:00:00.000Z', end: '2099-01-01T18:00:00.000Z', status: 'booked',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    // 540 min used / 540 min available = 1.0
    expect(stats.occupancyRate).toBe(1);
  });

  it('ties: stable sort by id ascending for top services by bookings', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-02T00:00:00.000Z');

    // 3 services with same booking count
    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-1', serviceId: 'svc-c',
      start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-2', serviceId: 'svc-a',
      start: '2099-01-01T12:00:00.000Z', end: '2099-01-01T13:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-3', clientId: 'cli-3', serviceId: 'svc-b',
      start: '2099-01-01T14:00:00.000Z', end: '2099-01-01T15:00:00.000Z', status: 'booked',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    // All have count=1, stable sort by id ascending: a < b < c
    expect(stats.topServicesByBookings).toEqual([
      { serviceId: 'svc-a', count: 1 },
      { serviceId: 'svc-b', count: 1 },
      { serviceId: 'svc-c', count: 1 },
    ]);
  });

  it('ties: stable sort by id ascending for top clients by visits', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-03T00:00:00.000Z');

    // 3 clients with same visit count
    repo.saveAppointment({
      id: 'a-1', clientId: 'cli-c', serviceId: 'svc-1',
      start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z', status: 'booked',
    });
    repo.saveAppointment({
      id: 'a-2', clientId: 'cli-a', serviceId: 'svc-1',
      start: '2099-01-02T10:00:00.000Z', end: '2099-01-02T11:00:00.000Z', status: 'completed',
    });
    repo.saveAppointment({
      id: 'a-3', clientId: 'cli-b', serviceId: 'svc-2',
      start: '2099-01-01T12:00:00.000Z', end: '2099-01-01T13:00:00.000Z', status: 'completed',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    // All have count=1, stable sort by id ascending: a < b < c
    expect(stats.topClientsByVisits).toEqual([
      { clientId: 'cli-a', count: 1 },
      { clientId: 'cli-b', count: 1 },
      { clientId: 'cli-c', count: 1 },
    ]);
  });

  it('range boundary: start inclusive, end exclusive', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2099-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2099-01-03T00:00:00.000Z');

    // Appointment exactly at rangeStart → included
    repo.saveAppointment({
      id: 'a-start', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-01T00:00:00.000Z', end: '2099-01-01T01:00:00.000Z', status: 'booked',
    });

    // Appointment exactly at rangeEnd → excluded
    repo.saveAppointment({
      id: 'a-end', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-03T00:00:00.000Z', end: '2099-01-03T01:00:00.000Z', status: 'booked',
    });

    // Appointment in middle → included
    repo.saveAppointment({
      id: 'a-mid', clientId: 'cli-1', serviceId: 'svc-1',
      start: '2099-01-02T10:00:00.000Z', end: '2099-01-02T11:00:00.000Z', status: 'booked',
    });

    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.appointmentsTotal).toBe(2);
    expect(stats.appointmentsBooked).toBe(2);
  });
});
