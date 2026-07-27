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
  const svc = { id: serviceId, name: 'Test', durationMin: 60, priceCents: 100, upsells: [] };
  const end = new Date(start.getTime() + 60 * 60_000);
  return { id, clientId, serviceId, start: iso(start), end: iso(end), status };
}

describe('StatsEngine — e2e scenario', () => {
  it('full week: mixed statuses, occupancy calculation, and top-N lists', () => {
    const repo = new InMemoryRepo(false);

    // Seed 3 services
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveService({ id: 'svc-corte', name: 'Corte', durationMin: 90, priceCents: 200, upsells: [] });
    repo.saveService({ id: 'svc-spa', name: 'Spa', durationMin: 120, priceCents: 500, upsells: [] });

    // Seed 4 clients
    const clients = [
      { id: 'cli-ana', name: 'Ana Pérez', phone: '111' },
      { id: 'cli-bob', name: 'Roberto Díaz', phone: '222' },
      { id: 'cli-carol', name: 'Carol Gómez', phone: '333' },
      { id: 'cli-dave', name: 'Dave Martín', phone: '444' },
    ];
    for (const c of clients) repo.saveClient(c);

    // --- Book 7 appointments over 5 weekdays (Mon–Fri) ---
    const base = new Date('2099-01-01T00:00:00.000Z'); // a Monday
    const weekEnd = new Date('2099-01-08T00:00:00.000Z'); // next Monday

    // Mon: 2 booked (bano + bano)
    repo.saveAppointment(makeAppt('a1', 'cli-ana', 'svc-bano', new Date(base.getTime() + 1e6), 'booked'));
    repo.saveAppointment(makeAppt('a2', 'cli-bob', 'svc-bano', new Date(base.getTime() + 2e6), 'booked'));
    // Tue: 1 booked (corte)
    repo.saveAppointment(makeAppt('a3', 'cli-carol', 'svc-corte', new Date(base.getTime() + 10e6 + 86400_000), 'booked'));
    // Wed: 1 completed (spa)
    repo.saveAppointment(makeAppt('a4', 'cli-ana', 'svc-spa', new Date(base.getTime() + 20e00 + 86400_000 * 2), 'completed'));
    // Thu: 1 cancelled (bano)
    repo.saveAppointment(makeAppt('a5', 'cli-dave', 'svc-bano', new Date(base.getTime() + 30e00 + 86400_000 * 3), 'cancelled'));
    // Fri: 1 booked (corte)
    repo.saveAppointment(makeAppt('a6', 'cli-bob', 'svc-corte', new Date(base.getTime() + 40e00 + 86400_000 * 4), 'booked'));
    // Fri: 1 booked (spa)
    repo.saveAppointment(makeAppt('a7', 'cli-ana', 'svc-spa', new Date(base.getTime() + 50e00 + 86400_000 * 4), 'booked'));

    // Appointment on day 6 (Sat) should be excluded
    repo.saveAppointment(makeAppt('a8', 'cli-carol', 'svc-bano', new Date(base.getTime() + 60e00 + 86400_000 * 5), 'booked'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(base, weekEnd);

    // --- Verify totals ---
    expect(result.appointmentsTotal).toBe(7);
    expect(result.appointmentsBooked).toBe(5);
    expect(result.appointmentsCompleted).toBe(1);
    expect(result.appointmentsCancelled).toBe(1);
    expect(result.cancellationRate).toBeCloseTo(1 / 7, 4);

    // --- Verify occupancy ---
    // Working minutes: 5 days × 540 = 2700
    // Booked+completed duration: bano(60) + bano(60) + corte(90) + spa(120) + corte(90) + spa(120) = 540
    // occupancyRate = 540 / 2700 = 0.2
    expect(result.occupancyRate).toBeCloseTo(0.2, 4);

    // --- Verify top services by bookings ---
    expect(result.topServicesByBookings).toHaveLength(3);
    expect(result.topServicesByBookings[0].serviceId).toBe('svc-bano');
    expect(result.topServicesByBookings[0].count).toBe(3); // 2 booked + 0 cancelled doesn't count; booked only = 2 bano, 1 corte, 1 spa
    // Actually let me recalculate: booked appointments = a1(bano), a2(bano), a3(corte), a6(corte), a7(spa) = 5
    // bano: 2, corte: 2, spa: 1
    expect(result.topServicesByBookings[0].serviceId).toBe('svc-bano');
    expect(result.topServicesByBookings[0].count).toBe(2);
    expect(result.topServicesByBookings[1].serviceId).toBe('svc-corte');
    expect(result.topServicesByBookings[1].count).toBe(2);
    expect(result.topServicesByBookings[2].serviceId).toBe('svc-spa');
    expect(result.topServicesByBookings[2].count).toBe(1);

    // --- Verify top services by cancellations ---
    expect(result.topServicesByCancellations).toHaveLength(1);
    expect(result.topServicesByCancellations[0].serviceId).toBe('svc-bano');
    expect(result.topServicesByCancellations[0].count).toBe(1);

    // --- Verify top clients by visits ---
    expect(result.topClientsByVisits).toHaveLength(4);
    // ana: a1(booked) + a4(completed) + a7(booked) = 3
    // bob: a2(booked) + a6(booked) = 2
    // carol: a3(booked) = 1
    // dave: cancelled only → not counted
    expect(result.topClientsByVisits[0].clientId).toBe('cli-ana');
    expect(result.topClientsByVisits[0].count).toBe(3);
    expect(result.topClientsByVisits[1].clientId).toBe('cli-bob');
    expect(result.topClientsByVisits[1].count).toBe(2);
    expect(result.topClientsByVisits[2].clientId).toBe('cli-carol');
    expect(result.topClientsByVisits[2].count).toBe(1);
  });
});
