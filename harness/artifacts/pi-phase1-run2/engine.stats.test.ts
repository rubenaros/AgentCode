import { describe, it, expect } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import type { Appointment, Service } from '../src/domain/types';

function makeRepo(appointments: Appointment[]): InMemoryRepo {
  const repo = new InMemoryRepo(false);
  // Seed services (required for occupancy calculation)
  const services: Service[] = [
    { id: 'svc-bano', name: 'Baño completo', durationMin: 60, priceCents: 2500000, upsells: [] },
    { id: 'svc-corte', name: 'Corte y peinado', durationMin: 90, priceCents: 3500000, upsells: [] },
    { id: 'svc-spa', name: 'Spa de mascotas', durationMin: 120, priceCents: 5000000, upsells: [] },
  ];
  services.forEach((s) => repo.saveService(s));
  // Seed a client
  repo.saveClient({ id: 'cli-1', name: 'Test', phone: '+0' });
  for (const a of appointments) {
    repo.saveAppointment(a);
  }
  return repo;
}

function iso(date: Date): string {
  return date.toISOString();
}

const DAY = 24 * 60 * 60 * 1000;

describe('StatsEngine', () => {
  it('counts appointmentsTotal correctly for a range', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const start = new Date(now.getTime());
    const end = new Date(now.getTime() + DAY); // 1 day range

    const appointments: Appointment[] = [
      { id: '1', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 5 * 3600000)), end: iso(new Date(now.getTime() + 6 * 3600000)), status: 'booked' },
      { id: '2', clientId: 'cli-1', serviceId: 'svc-corte', start: iso(new Date(now.getTime() + 10 * 3600000)), end: iso(new Date(now.getTime() + 11.5 * 3600000)), status: 'completed' },
      { id: '3', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 14 * 3600000)), end: iso(new Date(now.getTime() + 15 * 3600000)), status: 'cancelled' },
      // Outside range
      { id: '4', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(end.getTime())), end: iso(new Date(end.getTime() + 3600000)), status: 'booked' },
    ];

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(start, end);

    expect(stats.appointmentsTotal).toBe(3);
    expect(stats.appointmentsBooked).toBe(1);
    expect(stats.appointmentsCompleted).toBe(1);
    expect(stats.appointmentsCancelled).toBe(1);
  });

  it('calculates cancellationRate correctly', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + DAY);

    const appointments: Appointment[] = [
      { id: '1', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 10 * 3600000)), end: iso(new Date(now.getTime() + 11 * 3600000)), status: 'booked' },
      { id: '2', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 14 * 3600000)), end: iso(new Date(now.getTime() + 15 * 3600000)), status: 'cancelled' },
      { id: '3', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 16 * 3600000)), end: iso(new Date(now.getTime() + 17 * 3600000)), status: 'cancelled' },
      { id: '4', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 18 * 3600000)), end: iso(new Date(now.getTime() + 19 * 3600000)), status: 'completed' },
      { id: '5', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 20 * 3600000)), end: iso(new Date(now.getTime() + 21 * 3600000)), status: 'booked' },
    ];

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(rangeStart, rangeEnd);

    // 5 total, 2 cancelled -> cancellationRate = 2/5 = 0.4
    expect(stats.cancellationRate).toBe(0.4);
  });

  it('returns 0 cancellationRate when total is 0', () => {
    const engine = new StatsEngine(makeRepo([]));
    const now = new Date('2026-06-01T00:00:00.000Z');
    const stats = engine.compute(now, new Date(now.getTime() + DAY));

    expect(stats.appointmentsTotal).toBe(0);
    expect(stats.cancellationRate).toBe(0);
    expect(stats.occupancyRate).toBe(0);
  });

  it('calculates occupancyRate from booked+completed duration', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + DAY);

    // 1 booked (60min) + 1 cancelled (60min) in a 1-day range (540 working min)
    // occupancy = 60 / 540 = 0.1111
    const appointments: Appointment[] = [
      { id: '1', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 10 * 3600000)), end: iso(new Date(now.getTime() + 11 * 3600000)), status: 'booked' },
      { id: '2', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 14 * 3600000)), end: iso(new Date(now.getTime() + 15 * 3600000)), status: 'cancelled' },
    ];

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(rangeStart, rangeEnd);

    // 60min booked / 540min working = 0.1111 (4 decimals)
    expect(stats.occupancyRate).toBeCloseTo(60 / 540, 4);
  });

  it('returns topServicesByBookings sorted desc by count, then by id', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + DAY);

    const appointments: Appointment[] = [
      { id: '1', clientId: 'cli-1', serviceId: 'svc-corte', start: iso(new Date(now.getTime() + 10 * 3600000)), end: iso(new Date(now.getTime() + 11 * 3600000)), status: 'booked' },
      { id: '2', clientId: 'cli-1', serviceId: 'svc-corte', start: iso(new Date(now.getTime() + 11 * 3600000)), end: iso(new Date(now.getTime() + 12 * 3600000)), status: 'booked' },
      { id: '3', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 12 * 3600000)), end: iso(new Date(now.getTime() + 13 * 3600000)), status: 'booked' },
      { id: '4', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 13 * 3600000)), end: iso(new Date(now.getTime() + 14 * 3600000)), status: 'booked' },
      { id: '5', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 14 * 3600000)), end: iso(new Date(now.getTime() + 15 * 3600000)), status: 'booked' },
      { id: '6', clientId: 'cli-1', serviceId: 'svc-spa', start: iso(new Date(now.getTime() + 15 * 3600000)), end: iso(new Date(now.getTime() + 16 * 3600000)), status: 'booked' },
    ];

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.topServicesByBookings).toHaveLength(3);
    expect(stats.topServicesByBookings[0]).toEqual({ serviceId: 'svc-bano', count: 3 });
    expect(stats.topServicesByBookings[1]).toEqual({ serviceId: 'svc-corte', count: 2 });
    expect(stats.topServicesByBookings[2]).toEqual({ serviceId: 'svc-spa', count: 1 });
  });

  it('limits top lists to 5 entries', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + DAY);

    // 7 services with 1 booking each
    const appointments: Appointment[] = [];
    for (let i = 0; i < 7; i++) {
      appointments.push({
        id: `a-${i}`,
        clientId: 'cli-1',
        serviceId: `svc-s${String(i).padStart(2, '0')}`,
        start: iso(new Date(now.getTime() + (i + 1) * 3600000)),
        end: iso(new Date(now.getTime() + (i + 2) * 3600000)),
        status: 'booked',
      });
    }

    const repo = makeRepo(appointments);
    // Add services
    for (let i = 0; i < 7; i++) {
      repo.saveService({ id: `svc-s${String(i).padStart(2, '0')}`, name: `Servicio ${i}`, durationMin: 30, priceCents: 100000, upsells: [] });
    }

    const engine = new StatsEngine(repo);
    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.topServicesByBookings).toHaveLength(5);
  });

  it('includes completed appointments in topClientsByVisits', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const rangeStart = new Date(now.getTime());
    const rangeEnd = new Date(now.getTime() + 2 * DAY);

    const appointments: Appointment[] = [
      { id: '1', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 10 * 3600000)), end: iso(new Date(now.getTime() + 11 * 3600000)), status: 'completed' },
      { id: '2', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 14 * 3600000)), end: iso(new Date(now.getTime() + 15 * 3600000)), status: 'completed' },
      { id: '3', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 34 * 3600000)), end: iso(new Date(now.getTime() + 35 * 3600000)), status: 'completed' },
      { id: '4', clientId: 'cli-1', serviceId: 'svc-bano', start: iso(new Date(now.getTime() + 38 * 3600000)), end: iso(new Date(now.getTime() + 39 * 3600000)), status: 'booked' },
    ];

    const engine = new StatsEngine(makeRepo(appointments));
    const stats = engine.compute(rangeStart, rangeEnd);

    expect(stats.topClientsByVisits).toHaveLength(1);
    expect(stats.topClientsByVisits[0]).toEqual({ clientId: 'cli-1', count: 4 });
  });
});
