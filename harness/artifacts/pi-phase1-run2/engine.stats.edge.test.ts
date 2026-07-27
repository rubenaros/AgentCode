import { describe, it, expect } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import type { Appointment } from '../src/domain/types';

function makeRepo(appointments: Appointment[]): InMemoryRepo {
  const repo = new InMemoryRepo(false);
  repo.saveService({ id: 'svc-1', name: 'A', durationMin: 60, priceCents: 100000, upsells: [] });
  repo.saveService({ id: 'svc-2', name: 'B', durationMin: 45, priceCents: 80000, upsells: [] });
  repo.saveService({ id: 'svc-3', name: 'C', durationMin: 90, priceCents: 150000, upsells: [] });
  repo.saveClient({ id: 'c1', name: 'C1', phone: '+0' });
  repo.saveClient({ id: 'c2', name: 'C2', phone: '+0' });
  for (const a of appointments) {
    repo.saveAppointment(a);
  }
  return repo;
}

function iso(d: Date): string {
  return d.toISOString();
}

const DAY = 86400000;

describe('StatsEngine edge cases', () => {
  it('empty range returns all zeros and empty tops', () => {
    const engine = new StatsEngine(makeRepo([]));
    const now = new Date('2026-01-01T00:00:00.000Z');
    const stats = engine.compute(now, now);

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

  it('range with no appointments in it returns all zeros', () => {
    const appointments: Appointment[] = [
      { id: '1', clientId: 'c1', serviceId: 'svc-1', start: iso(new Date('2027-01-01T10:00:00.000Z')), end: iso(new Date('2027-01-01T11:00:00.000Z')), status: 'booked' },
    ];
    const engine = new StatsEngine(makeRepo(appointments));
    const rangeStart = new Date('2026-01-01T00:00:00.000Z');
    const rangeEnd = new Date('2026-01-02T00:00:00.000Z');
    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.appointmentsTotal).toBe(0);
    expect(stats.cancellationRate).toBe(0);
    expect(stats.occupancyRate).toBe(0);
  });

  it('all cancelled appointments -> cancellationRate=1', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const appointments: Appointment[] = [
      { id: '1', clientId: 'c1', serviceId: 'svc-1', start: iso(new Date(now.getTime() + 10 * 3600000)), end: iso(new Date(now.getTime() + 11 * 3600000)), status: 'cancelled' },
      { id: '2', clientId: 'c1', serviceId: 'svc-1', start: iso(new Date(now.getTime() + 12 * 3600000)), end: iso(new Date(now.getTime() + 13 * 3600000)), status: 'cancelled' },
    ];
    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(now, new Date(now.getTime() + DAY));

    expect(stats.appointmentsTotal).toBe(2);
    expect(stats.appointmentsCancelled).toBe(2);
    expect(stats.cancellationRate).toBe(1);
    expect(stats.occupancyRate).toBe(0);
  });

  it('occupancy 100% when booked+completed fill all working hours', () => {
    // 1 day = 540 working minutes
    // 9 slots of 60 min booked = 540 min
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + DAY);

    const appointments: Appointment[] = [];
    for (let i = 0; i < 9; i++) {
      const hour = 9 + i; // 9:00, 10:00, ..., 17:00
      const start = new Date(now.getTime() + hour * 3600000);
      const end = new Date(start.getTime() + 60 * 60000);
      appointments.push({
        id: `a-${i}`,
        clientId: 'c1',
        serviceId: 'svc-1',
        start: iso(start),
        end: iso(end),
        status: i < 4 ? 'booked' : 'completed',
      });
    }

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(rangeStart, rangeEnd);

    // 540 min / 540 min = 1.0
    expect(stats.occupancyRate).toBe(1);
  });

  it('ties are broken by id (stable sort ascending)', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + DAY);

    // 3 services each with 1 booking: svc-c, svc-a, svc-b -> tie-break by id ascending
    const appointments: Appointment[] = [
      { id: '1', clientId: 'c1', serviceId: 'svc-c', start: iso(new Date(now.getTime() + 10 * 3600000)), end: iso(new Date(now.getTime() + 11 * 3600000)), status: 'booked' },
      { id: '2', clientId: 'c1', serviceId: 'svc-a', start: iso(new Date(now.getTime() + 11 * 3600000)), end: iso(new Date(now.getTime() + 12 * 3600000)), status: 'booked' },
      { id: '3', clientId: 'c1', serviceId: 'svc-b', start: iso(new Date(now.getTime() + 12 * 3600000)), end: iso(new Date(now.getTime() + 13 * 3600000)), status: 'booked' },
    ];

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(rangeStart, rangeEnd);

    // All have count=1, so sorted by serviceId ascending
    expect(stats.topServicesByBookings[0]).toEqual({ serviceId: 'svc-a', count: 1 });
    expect(stats.topServicesByBookings[1]).toEqual({ serviceId: 'svc-b', count: 1 });
    expect(stats.topServicesByBookings[2]).toEqual({ serviceId: 'svc-c', count: 1 });
  });

  it('rangeEnd-exclusive: appointment at rangeEnd boundary is excluded', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + DAY);

    const appointments: Appointment[] = [
      // At rangeStart -> included
      { id: '1', clientId: 'c1', serviceId: 'svc-1', start: iso(rangeStart), end: iso(new Date(rangeStart.getTime() + 3600000)), status: 'booked' },
      // At rangeEnd -> excluded
      { id: '2', clientId: 'c1', serviceId: 'svc-1', start: iso(rangeEnd), end: iso(new Date(rangeEnd.getTime() + 3600000)), status: 'booked' },
    ];

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.appointmentsTotal).toBe(1);
  });
});
