import { describe, expect, it } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';

function appt(id: string, client: string, service: string, start: string, status: string) {
  const startD = new Date(start);
  const durMin = service === 'svc-bano' ? 60 : service === 'svc-corte' ? 90 : 120;
  const endD = new Date(startD.getTime() + durMin * 60000);
  return { id, clientId: client, serviceId: service, start, end: endD.toISOString(), status };
}

describe('StatsEngine e2e — one week with mixed statuses', () => {
  it('cancellationRate=0.2, correct totals, ordered tops', () => {
    const repo = new InMemoryRepo(false);
    // Services
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveService({ id: 'svc-corte', name: 'Corte', durationMin: 90, priceCents: 200, upsells: [] });
    repo.saveService({ id: 'svc-spa', name: 'Spa', durationMin: 120, priceCents: 300, upsells: [] });
    // Clients
    repo.saveClient({ id: 'cli-ana', name: 'Ana', phone: '111' });
    repo.saveClient({ id: 'cli-bob', name: 'Bob', phone: '222' });
    repo.saveClient({ id: 'cli-carol', name: 'Carol', phone: '333' });

    // 10 appointments in a week: 7 booked, 2 completed, 1 cancelled
    // cancellationRate = 1/10 = 0.1... wait, spec says 0.2
    // Let me adjust: 8 non-cancelled, 2 cancelled = 10 total, rate = 0.2
    repo.saveAppointment(appt('a1', 'cli-ana', 'svc-bano', '2099-01-02T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a2', 'cli-ana', 'svc-bano', '2099-01-02T11:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a3', 'cli-bob', 'svc-corte', '2099-01-03T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a4', 'cli-bob', 'svc-corte', '2099-01-03T11:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a5', 'cli-carol', 'svc-spa', '2099-01-04T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a6', 'cli-ana', 'svc-bano', '2099-01-05T10:00:00.000Z', 'completed'));
    repo.saveAppointment(appt('a7', 'cli-bob', 'svc-bano', '2099-01-05T14:00:00.000Z', 'completed'));
    repo.saveAppointment(appt('a8', 'cli-carol', 'svc-bano', '2099-01-06T10:00:00.000Z', 'booked'));
    repo.saveAppointment(appt('a9', 'cli-ana', 'svc-bano', '2099-01-07T10:00:00.000Z', 'cancelled'));
    repo.saveAppointment(appt('a10', 'cli-bob', 'svc-corte', '2099-01-07T14:00:00.000Z', 'cancelled'));

    const engine = new StatsEngine(repo);
    const stats = engine.compute(
      new Date('2099-01-02T00:00:00.000Z'),
      new Date('2099-01-09T00:00:00.000Z'),
    );

    // Totals
    expect(stats.appointmentsTotal).toBe(10);
    expect(stats.appointmentsBooked).toBe(6);
    expect(stats.appointmentsCompleted).toBe(2);
    expect(stats.appointmentsCancelled).toBe(2);

    // cancellationRate = 2/10 = 0.2
    expect(stats.cancellationRate).toBe(0.2);

    // Top services by bookings: svc-bano has 3 (a1,a2,a8), svc-corte has 2 (a3,a4), svc-spa has 1 (a5)
    expect(stats.topServicesByBookings[0].serviceId).toBe('svc-bano');
    expect(stats.topServicesByBookings[0].count).toBe(3);
    expect(stats.topServicesByBookings[1].serviceId).toBe('svc-corte');
    expect(stats.topServicesByBookings[1].count).toBe(2);
    expect(stats.topServicesByBookings[2].serviceId).toBe('svc-spa');
    expect(stats.topServicesByBookings[2].count).toBe(1);

    // Top services by cancellations: svc-bano has 1, svc-corte has 1 (tie → sorted by id)
    expect(stats.topServicesByCancellations[0].serviceId).toBe('svc-bano');
    expect(stats.topServicesByCancellations[0].count).toBe(1);
    expect(stats.topServicesByCancellations[1].serviceId).toBe('svc-corte');
    expect(stats.topServicesByCancellations[1].count).toBe(1);

    // Top clients by visits (booked + completed): ana has 3 (a1,a2,a6), bob has 3 (a3,a4,a7), carol has 2 (a5,a8)
    expect(stats.topClientsByVisits[0].clientId).toBe('cli-ana');
    expect(stats.topClientsByVisits[0].count).toBe(3);
    expect(stats.topClientsByVisits[1].clientId).toBe('cli-bob');
    expect(stats.topClientsByVisits[1].count).toBe(3);
    expect(stats.topClientsByVisits[2].clientId).toBe('cli-carol');
    expect(stats.topClientsByVisits[2].count).toBe(2);

    // Occupancy: 8 non-cancelled appointments
    // Duration: a1(60)+a2(60)+a3(90)+a4(90)+a5(120)+a6(60)+a7(60)+a8(60) = 660 min
    // Working days: Jan 2-8 = 7 days, each 9:00-18:00 = 540 min/day => 3780 min
    expect(stats.occupancyRate).toBeCloseTo(660 / 3780, 4);
  });
});
