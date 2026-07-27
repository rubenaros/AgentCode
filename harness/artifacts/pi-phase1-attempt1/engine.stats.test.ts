import { describe, expect, it } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';

function iso(d: Date): string {
  return d.toISOString();
}

function makeAppt(
  id: string,
  clientId: string,
  serviceId: string,
  start: Date,
  status: 'booked' | 'cancelled' | 'completed',
): { id: string; clientId: string; serviceId: string; start: string; end: string; status: string } {
  const end = new Date(start.getTime() + 60 * 60_000);
  return { id, clientId, serviceId, start: iso(start), end: iso(end), status };
}

describe('StatsEngine — unit tests', () => {
  it('compute returns correct totals for a week with 3 appointments', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveClient({ id: 'cli-ana', name: 'Ana', phone: '111' });
    repo.saveClient({ id: 'cli-bob', name: 'Bob', phone: '222' });

    const day1 = new Date('2099-01-01T00:00:00.000Z');
    const weekEnd = new Date('2099-01-08T00:00:00.000Z');

    repo.saveAppointment(makeAppt('a1', 'cli-ana', 'svc-bano', new Date('2099-01-01T10:00:00.000Z'), 'booked'));
    repo.saveAppointment(makeAppt('a2', 'cli-bob', 'svc-bano', new Date('2099-01-02T11:00:00.000Z'), 'completed'));
    repo.saveAppointment(makeAppt('a3', 'cli-ana', 'svc-bano', new Date('2099-01-03T14:00:00.000Z'), 'cancelled'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(day1, weekEnd);

    expect(result.appointmentsTotal).toBe(3);
    expect(result.appointmentsBooked).toBe(1);
    expect(result.appointmentsCompleted).toBe(1);
    expect(result.appointmentsCancelled).toBe(1);
    expect(result.cancellationRate).toBeCloseTo(0.3333, 4);
    expect(result.occupancyRate).toBeCloseTo(180 / (7 * 540), 4); // 3 appointments × 60 min / 3780 min
    expect(result.rangeStart).toBe(day1.toISOString());
    expect(result.rangeEnd).toBe(weekEnd.toISOString());
  });

  it('cancellationRate and occupancyRate are 0 when total is 0', () => {
    const repo = new InMemoryRepo(false);
    const engine = new StatsEngine(repo);
    const start = new Date('2099-01-01T00:00:00.000Z');
    const end = new Date('2099-01-02T00:00:00.000Z');
    const result = engine.compute(start, end);
    expect(result.appointmentsTotal).toBe(0);
    expect(result.cancellationRate).toBe(0);
    expect(result.occupancyRate).toBe(0);
    expect(result.topServicesByBookings).toEqual([]);
    expect(result.topServicesByCancellations).toEqual([]);
    expect(result.topClientsByVisits).toEqual([]);
  });

  it('topServicesByBookings returns sorted top 5 services', () => {
    const repo = new InMemoryRepo(false);
    const services = [
      { id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] },
      { id: 'svc-corte', name: 'Corte', durationMin: 90, priceCents: 200, upsells: [] },
      { id: 'svc-spa', name: 'Spa', durationMin: 120, priceCents: 500, upsells: [] },
    ];
    for (const s of services) repo.saveService(s);
    const client = { id: 'cli-1', name: 'A', phone: '1' };
    repo.saveClient(client);

    const base = new Date('2099-01-01T00:00:00.000Z');
    // 3 bano, 2 corte, 1 spa bookings
    repo.saveAppointment(makeAppt('a1', client.id, 'svc-bano', new Date(base.getTime() + 1e6), 'booked'));
    repo.saveAppointment(makeAppt('a2', client.id, 'svc-bano', new Date(base.getTime() + 2e6), 'booked'));
    repo.saveAppointment(makeAppt('a3', client.id, 'svc-bano', new Date(base.getTime() + 3e6), 'booked'));
    repo.saveAppointment(makeAppt('a4', client.id, 'svc-corte', new Date(base.getTime() + 4e6), 'booked'));
    repo.saveAppointment(makeAppt('a5', client.id, 'svc-corte', new Date(base.getTime() + 5e6), 'booked'));
    repo.saveAppointment(makeAppt('a6', client.id, 'svc-spa', new Date(base.getTime() + 6e6), 'booked'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(base, new Date(base.getTime() + 10e6));

    expect(result.topServicesByBookings).toHaveLength(3);
    expect(result.topServicesByBookings[0].serviceId).toBe('svc-bano');
    expect(result.topServicesByBookings[0].count).toBe(3);
    expect(result.topServicesByBookings[1].serviceId).toBe('svc-corte');
    expect(result.topServicesByBookings[1].count).toBe(2);
    expect(result.topServicesByBookings[2].serviceId).toBe('svc-spa');
    expect(result.topServicesByBookings[2].count).toBe(1);
  });

  it('topServicesByCancellations returns sorted top 5 services', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveClient({ id: 'cli-1', name: 'A', phone: '1' });

    const base = new Date('2099-01-01T00:00:00.000Z');
    repo.saveAppointment(makeAppt('a1', 'cli-1', 'svc-bano', new Date(base.getTime() + 1e6), 'cancelled'));
    repo.saveAppointment(makeAppt('a2', 'cli-1', 'svc-bano', new Date(base.getTime() + 2e6), 'cancelled'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(base, new Date(base.getTime() + 10e6));

    expect(result.topServicesByCancellations).toHaveLength(1);
    expect(result.topServicesByCancellations[0].serviceId).toBe('svc-bano');
    expect(result.topServicesByCancellations[0].count).toBe(2);
  });

  it('topClientsByVisits returns sorted top 5 clients by booked+completed', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveClient({ id: 'cli-ana', name: 'Ana', phone: '111' });
    repo.saveClient({ id: 'cli-bob', name: 'Bob', phone: '222' });

    const base = new Date('2099-01-01T00:00:00.000Z');
    // ana: 3 visits, bob: 1 visit
    repo.saveAppointment(makeAppt('a1', 'cli-ana', 'svc-bano', new Date(base.getTime() + 1e6), 'booked'));
    repo.saveAppointment(makeAppt('a2', 'cli-ana', 'svc-bano', new Date(base.getTime() + 2e6), 'completed'));
    repo.saveAppointment(makeAppt('a3', 'cli-ana', 'svc-bano', new Date(base.getTime() + 3e6), 'booked'));
    repo.saveAppointment(makeAppt('a4', 'cli-bob', 'svc-bano', new Date(base.getTime() + 4e6), 'completed'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(base, new Date(base.getTime() + 10e6));

    expect(result.topClientsByVisits).toHaveLength(2);
    expect(result.topClientsByVisits[0].clientId).toBe('cli-ana');
    expect(result.topClientsByVisits[0].count).toBe(3);
    expect(result.topClientsByVisits[1].clientId).toBe('cli-bob');
    expect(result.topClientsByVisits[1].count).toBe(1);
  });

  it('excludes cancelled from topClientsByVisits', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveClient({ id: 'cli-1', name: 'A', phone: '1' });

    const base = new Date('2099-01-01T00:00:00.000Z');
    repo.saveAppointment(makeAppt('a1', 'cli-1', 'svc-bano', new Date(base.getTime() + 1e6), 'cancelled'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(base, new Date(base.getTime() + 10e6));
    expect(result.topClientsByVisits).toEqual([]);
  });
});
