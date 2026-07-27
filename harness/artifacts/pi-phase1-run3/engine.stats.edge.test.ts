import { describe, expect, it } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';

function makeRepo() {
  const repo = new InMemoryRepo(false);
  repo.saveService({ id: 'svc-a', name: 'A', durationMin: 60, priceCents: 100, upsells: [] });
  repo.saveService({ id: 'svc-b', name: 'B', durationMin: 90, priceCents: 200, upsells: [] });
  repo.saveClient({ id: 'cli-1', name: 'C1', phone: '111' });
  repo.saveClient({ id: 'cli-2', name: 'C2', phone: '222' });
  return repo;
}

function appt(id: string, client: string, service: string, start: string, status: string) {
  const startD = new Date(start);
  const durMin = service === 'svc-a' ? 60 : 90;
  const endD = new Date(startD.getTime() + durMin * 60000);
  return { id, clientId: client, serviceId: service, start, end: endD.toISOString(), status };
}

describe('StatsEngine edge cases', () => {
  it('empty range returns all zeros', () => {
    const repo = makeRepo();
    const engine = new StatsEngine(repo);
    const stats = engine.compute(new Date('2099-01-01T00:00:00.000Z'), new Date('2099-01-01T00:00:00.000Z'));

    expect(stats.appointmentsTotal).toBe(0);
    expect(stats.appointmentsBooked).toBe(0);
    expect(stats.appointmentsCancelled).toBe(0);
    expect(stats.cancellationRate).toBe(0);
    expect(stats.occupancyRate).toBe(0);
    expect(stats.topServicesByBookings).toHaveLength(0);
  });

  it('all appointments cancelled — cancellationRate=1', () => {
    const repo = makeRepo();
    repo.saveAppointment(appt('a1', 'cli-1', 'svc-a', '2099-01-02T10:00:00.000Z', 'cancelled'));
    repo.saveAppointment(appt('a2', 'cli-2', 'svc-b', '2099-01-03T10:00:00.000Z', 'cancelled'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(
      new Date('2099-01-01T09:00:00.000Z'),
      new Date('2099-01-09T18:00:00.000Z'),
    );

    expect(stats.appointmentsTotal).toBe(2);
    expect(stats.appointmentsCancelled).toBe(2);
    expect(stats.cancellationRate).toBe(1);
    expect(stats.occupancyRate).toBe(0); // no booked+completed
  });

  it('occupancy 100% — one service fills a full working day', () => {
    const repo = makeRepo();
    // svc-a has 60min duration. We need 540 minutes to fill one day.
    // 9 appointments of 60 min each = 540 min = 1 day of work
    for (let i = 0; i < 9; i++) {
      repo.saveAppointment(
        appt(`a${i}`, `cli-1`, 'svc-a', `2099-01-02T${String(9 + i).padStart(2, '0')}:00:00.000Z`, 'booked'),
      );
    }

    const engine = new StatsEngine(repo);
    const stats = engine.compute(
      new Date('2099-01-02T09:00:00.000Z'),
      new Date('2099-01-02T18:00:00.000Z'),
    );

    // 9 * 60 = 540 min working, 9:00-18:00 = 540 min
    expect(stats.occupancyRate).toBe(1);
    expect(stats.appointmentsTotal).toBe(9);
  });

  it('ties are broken by id (stable sort)', () => {
    const repo = makeRepo();
    // Two services with equal booking counts — tie-break by id
    repo.saveAppointment(appt('a1', 'cli-1', 'svc-b', '2099-01-02T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a2', 'cli-2', 'svc-a', '2099-01-02T11:00:00.000Z', 'booked'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(
      new Date('2099-01-01T09:00:00.000Z'),
      new Date('2099-01-09T18:00:00.000Z'),
    );

    // Both have count=1, so sorted by id: svc-a < svc-b
    expect(stats.topServicesByBookings).toHaveLength(2);
    expect(stats.topServicesByBookings[0].serviceId).toBe('svc-a');
    expect(stats.topServicesByBookings[1].serviceId).toBe('svc-b');
  });

  it('partial-day range: correct working minutes', () => {
    const repo = makeRepo();
    // Single appointment at 12:00 on a single day
    repo.saveAppointment(appt('a1', 'cli-1', 'svc-a', '2099-01-02T12:00:00.000Z', 'booked'));

    const engine = new StatsEngine(repo);
    // Range covers exactly one full working day
    const stats = engine.compute(
      new Date('2099-01-02T09:00:00.000Z'),
      new Date('2099-01-02T18:00:00.000Z'),
    );

    // 1 appointment of 60 min / 540 min = 0.1111...
    expect(stats.occupancyRate).toBeCloseTo(60 / 540, 4);
  });

  it('partial range at boundaries: only partial working minutes counted', () => {
    const repo = makeRepo();
    repo.saveAppointment(appt('a1', 'cli-1', 'svc-a', '2099-01-02T10:00:00.000Z', 'booked'));

    const engine = new StatsEngine(repo);
    // Range starts at 14:00, ends at 18:00 — only 4 hours of working time
    const stats = engine.compute(
      new Date('2099-01-02T14:00:00.000Z'),
      new Date('2099-01-02T18:00:00.000Z'),
    );

    // Working minutes = 14:00-18:00 = 240 min, appointment = 60 min
    // BUT: the appointment start at 10:00 is BEFORE rangeStart (14:00), so it's excluded
    // appointmentsTotal should be 0
    expect(stats.appointmentsTotal).toBe(0);
    expect(stats.occupancyRate).toBe(0);
  });

  it('top 5 limit enforced — only returns up to 5', () => {
    const repo = new InMemoryRepo(false);
    for (let i = 0; i < 10; i++) {
      repo.saveService({ id: `svc-${i}`, name: `Svc ${i}`, durationMin: 60, priceCents: 100, upsells: [] });
      repo.saveClient({ id: `cli-${i}`, name: `Client ${i}`, phone: `111${i}` });
    }
    for (let i = 0; i < 10; i++) {
      repo.saveAppointment(appt(`a${i}`, `cli-${i}`, `svc-${i}`, `2099-01-02T${String(9 + i).padStart(2, '0')}:00:00.000Z`, 'booked'));
    }

    const engine = new StatsEngine(repo);
    const stats = engine.compute(
      new Date('2099-01-01T09:00:00.000Z'),
      new Date('2099-01-09T18:00:00.000Z'),
    );

    expect(stats.topServicesByBookings).toHaveLength(5);
    expect(stats.topClientsByVisits).toHaveLength(5);
  });
});
