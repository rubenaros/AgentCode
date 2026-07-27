import { describe, expect, it } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';

function makeRepo() {
  const repo = new InMemoryRepo(false);
  // Services
  repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
  repo.saveService({ id: 'svc-corte', name: 'Corte', durationMin: 90, priceCents: 200, upsells: [] });
  // Clients
  repo.saveClient({ id: 'cli-ana', name: 'Ana', phone: '111' });
  repo.saveClient({ id: 'cli-bob', name: 'Bob', phone: '222' });
  return repo;
}

function appt(id: string, client: string, service: string, start: string, status: string) {
  const startD = new Date(start);
  const durMin = service === 'svc-bano' ? 60 : 90;
  const endD = new Date(startD.getTime() + durMin * 60000);
  return { id, clientId: client, serviceId: service, start, end: endD.toISOString(), status };
}

const RANGE_START = '2099-01-01T09:00:00.000Z';
const RANGE_END = '2099-01-08T18:00:00.000Z'; // 7 full working days

describe('StatsEngine unit tests', () => {
  it('counts total, booked, completed, cancelled correctly', () => {
    const repo = makeRepo();
    repo.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a2', 'cli-bob', 'svc-corte', '2099-01-02T11:00:00.000Z', 'completed'));
    repo.saveAppointment(appt('a3', 'cli-ana', 'svc-bano', '2099-01-03T10:00:00.000Z', 'cancelled'));
    repo.saveAppointment(appt('a4', 'cli-bob', 'svc-bano', '2099-01-04T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a5', 'cli-ana', 'svc-corte', '2099-01-05T10:00:00.000Z', 'completed'));
    repo.saveAppointment(appt('a6', 'cli-bob', 'svc-bano', '2099-01-06T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a7', 'cli-ana', 'svc-corte', '2099-01-07T10:00:00.000Z', 'cancelled'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(new Date(RANGE_START), new Date(RANGE_END));

    expect(stats.appointmentsTotal).toBe(7);
    expect(stats.appointmentsBooked).toBe(3);
    expect(stats.appointmentsCompleted).toBe(2);
    expect(stats.appointmentsCancelled).toBe(2);
    expect(stats.appointmentsBooked + stats.appointmentsCompleted + stats.appointmentsCancelled).toBe(7);
  });

  it('cancellationRate = cancelled / total, 0 if no appointments', () => {
    const repo = makeRepo();
    repo.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a2', 'cli-bob', 'svc-bano', '2099-01-02T11:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a3', 'cli-ana', 'svc-corte', '2099-01-02T12:00:00.000Z', 'cancelled'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(new Date(RANGE_START), new Date(RANGE_END));

    expect(stats.cancellationRate).toBeCloseTo(1 / 3, 4);

    // All booked => 0 cancellation rate
    const repo2 = makeRepo();
    repo2.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'booked'));
    const engine2 = new StatsEngine(repo2);
    const stats2 = engine2.compute(new Date(RANGE_START), new Date(RANGE_END));
    expect(stats2.cancellationRate).toBe(0);

    // Empty => 0
    const repo3 = makeRepo();
    const engine3 = new StatsEngine(repo3);
    const stats3 = engine3.compute(new Date(RANGE_START), new Date(RANGE_END));
    expect(stats3.cancellationRate).toBe(0);
  });

  it('topServicesByBookings returns top 5 descending', () => {
    const repo = makeRepo();
    // 3 svc-bano booked, 2 svc-corte booked
    repo.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a2', 'cli-ana', 'svc-bano', '2099-01-03T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a3', 'cli-ana', 'svc-bano', '2099-01-04T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a4', 'cli-bob', 'svc-corte', '2099-01-02T11:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a5', 'cli-bob', 'svc-corte', '2099-01-03T11:00:00.000Z', 'booked'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(new Date(RANGE_START), new Date(RANGE_END));

    expect(stats.topServicesByBookings).toHaveLength(2);
    expect(stats.topServicesByBookings[0].serviceId).toBe('svc-bano');
    expect(stats.topServicesByBookings[0].count).toBe(3);
    expect(stats.topServicesByBookings[1].serviceId).toBe('svc-corte');
    expect(stats.topServicesByBookings[1].count).toBe(2);
  });

  it('topServicesByCancellations orders by count desc', () => {
    const repo = makeRepo();
    repo.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'cancelled'));
    repo.saveAppointment(appt('a2', 'cli-bob', 'svc-bano', '2099-01-03T10:00:00.000Z', 'cancelled'));
    repo.saveAppointment(appt('a3', 'cli-ana', 'svc-corte', '2099-01-02T11:00:00.000Z', 'cancelled'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(new Date(RANGE_START), new Date(RANGE_END));

    expect(stats.topServicesByCancellations[0].serviceId).toBe('svc-bano');
    expect(stats.topServicesByCancellations[0].count).toBe(2);
    expect(stats.topServicesByCancellations[1].serviceId).toBe('svc-corte');
    expect(stats.topServicesByCancellations[1].count).toBe(1);
  });

  it('topClientsByVisits counts booked + completed', () => {
    const repo = makeRepo();
    repo.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a2', 'cli-ana', 'svc-bano', '2099-01-03T10:00:00.000Z', 'completed'));
    repo.saveAppointment(appt('a3', 'cli-bob', 'svc-bano', '2099-01-04T10:00:00.000Z', 'booked'));
    // Cancelled does NOT count as a visit
    repo.saveAppointment(appt('a4', 'cli-bob', 'svc-corte', '2099-01-05T10:00:00.000Z', 'cancelled'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(new Date(RANGE_START), new Date(RANGE_END));

    expect(stats.topClientsByVisits).toHaveLength(2);
    expect(stats.topClientsByVisits[0].clientId).toBe('cli-ana');
    expect(stats.topClientsByVisits[0].count).toBe(2);
    expect(stats.topClientsByVisits[1].clientId).toBe('cli-bob');
    expect(stats.topClientsByVisits[1].count).toBe(1);
  });

  it('range filter: only appointments with start in [rangeStart, rangeEnd) are counted', () => {
    const repo = makeRepo();
    // Inside range
    repo.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'booked'));
    // Before range — should be excluded
    repo.saveAppointment(appt('a2', 'cli-ana', 'svc-bano', '2098-12-31T10:00:00.000Z', 'booked'));
    // Exactly at rangeEnd — excluded (half-open interval)
    repo.saveAppointment(appt('a3', 'cli-bob', 'svc-bano', '2099-01-08T18:00:00.000Z', 'booked'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(new Date(RANGE_START), new Date(RANGE_END));

    expect(stats.appointmentsTotal).toBe(1);
  });
});
