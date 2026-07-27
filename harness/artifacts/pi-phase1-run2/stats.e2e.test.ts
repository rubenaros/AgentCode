import { describe, it, expect } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import type { Appointment, Service, Client } from '../src/domain/types';

// Build a fully seeded repo for an e2e scenario:
// 1 week (7 days), 10 appointments total, 2 cancelled -> cancellationRate = 0.2
// Services: svc-a has 5 bookings, svc-b has 3 bookings, svc-c has 2 bookings
// Clients: cli-x has 6 visits, cli-y has 4 visits
function buildSeededRepo(): InMemoryRepo {
  const repo = new InMemoryRepo(false);

  const services: Service[] = [
    { id: 'svc-a', name: 'Servicio A', durationMin: 60, priceCents: 100000, upsells: [] },
    { id: 'svc-b', name: 'Servicio B', durationMin: 45, priceCents: 80000, upsells: [] },
    { id: 'svc-c', name: 'Servicio C', durationMin: 90, priceCents: 150000, upsells: [] },
  ];
  services.forEach((s) => repo.saveService(s));

  const clients: Client[] = [
    { id: 'cli-x', name: 'X García', phone: '+0' },
    { id: 'cli-y', name: 'Y López', phone: '+0' },
  ];
  clients.forEach((c) => repo.saveClient(c));

  // Week: June 1-8, 2026 (7 days)
  const weekStart = new Date('2026-06-01T00:00:00.000Z');
  const weekEnd = new Date('2026-06-08T00:00:00.000Z');

  const appointments: Appointment[] = [
    // svc-a bookings (5): cli-x 3, cli-y 2
    { id: '1', clientId: 'cli-x', serviceId: 'svc-a', start: weekStart.toISOString(), end: new Date(weekStart.getTime() + 60 * 60000).toISOString(), status: 'booked' },
    { id: '2', clientId: 'cli-x', serviceId: 'svc-a', start: new Date(weekStart.getTime() + 1 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 1 * 86400000 + 60 * 60000).toISOString(), status: 'booked' },
    { id: '3', clientId: 'cli-x', serviceId: 'svc-a', start: new Date(weekStart.getTime() + 2 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 2 * 86400000 + 60 * 60000).toISOString(), status: 'completed' },
    { id: '4', clientId: 'cli-y', serviceId: 'svc-a', start: new Date(weekStart.getTime() + 3 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 3 * 86400000 + 60 * 60000).toISOString(), status: 'booked' },
    { id: '5', clientId: 'cli-y', serviceId: 'svc-a', start: new Date(weekStart.getTime() + 4 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 4 * 86400000 + 60 * 60000).toISOString(), status: 'completed' },

    // svc-b bookings (3): cli-x 2, cli-y 1
    { id: '6', clientId: 'cli-x', serviceId: 'svc-b', start: new Date(weekStart.getTime() + 2.5 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 2.5 * 86400000 + 45 * 60000).toISOString(), status: 'booked' },
    { id: '7', clientId: 'cli-x', serviceId: 'svc-b', start: new Date(weekStart.getTime() + 5 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 5 * 86400000 + 45 * 60000).toISOString(), status: 'completed' },
    { id: '8', clientId: 'cli-y', serviceId: 'svc-b', start: new Date(weekStart.getTime() + 6 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 6 * 86400000 + 45 * 60000).toISOString(), status: 'booked' },

    // svc-c bookings (2): cli-x 1, cli-y 1
    { id: '9', clientId: 'cli-x', serviceId: 'svc-c', start: new Date(weekStart.getTime() + 3.5 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 3.5 * 86400000 + 90 * 60000).toISOString(), status: 'cancelled' },
    { id: '10', clientId: 'cli-y', serviceId: 'svc-c', start: new Date(weekStart.getTime() + 4.5 * 86400000).toISOString(), end: new Date(weekStart.getTime() + 4.5 * 86400000 + 90 * 60000).toISOString(), status: 'cancelled' },

    // 2 more appointments outside the week (should not be counted)
    { id: '11', clientId: 'cli-x', serviceId: 'svc-a', start: weekEnd.toISOString(), end: new Date(weekEnd.getTime() + 60 * 60000).toISOString(), status: 'booked' },
    { id: '12', clientId: 'cli-x', serviceId: 'svc-a', start: new Date(weekEnd.getTime() + 86400000).toISOString(), end: new Date(weekEnd.getTime() + 86400000 + 60 * 60000).toISOString(), status: 'booked' },
  ];

  for (const a of appointments) {
    repo.saveAppointment(a);
  }

  return repo;
}

describe('StatsEngine e2e', () => {
  it('computes a correct weekly stats bundle', () => {
    const repo = buildSeededRepo();
    const engine = new StatsEngine(repo);

    const rangeStart = new Date('2026-06-01T00:00:00.000Z');
    const rangeEnd = new Date('2026-06-08T00:00:00.000Z');

    const stats = engine.compute(rangeStart, rangeEnd);

    // Total: 10 in range (appt 11, 12 are outside)
    expect(stats.appointmentsTotal).toBe(10);

    // Booked: 1,2,4,6,8 = 5
    expect(stats.appointmentsBooked).toBe(5);
    // Completed: 3,5,7 = 3
    expect(stats.appointmentsCompleted).toBe(3);
    // Cancelled: 9,10 = 2
    expect(stats.appointmentsCancelled).toBe(2);

    // Sum check
    expect(stats.appointmentsBooked + stats.appointmentsCompleted + stats.appointmentsCancelled).toBe(stats.appointmentsTotal);

    // Cancellation rate: 2/10 = 0.2
    expect(stats.cancellationRate).toBe(0.2);

    // Top services by bookings (status=booked): svc-a=3 (appts 1,2,4), svc-b=2 (appts 6,8)
    // svc-c has 0 bookings so it's not in the map (only services with >=1 booking appear)
    expect(stats.topServicesByBookings).toHaveLength(2);
    expect(stats.topServicesByBookings[0]).toEqual({ serviceId: 'svc-a', count: 3 });
    expect(stats.topServicesByBookings[1]).toEqual({ serviceId: 'svc-b', count: 2 });

    // Top services by cancellations (desc): svc-c=2
    expect(stats.topServicesByCancellations[0]).toEqual({ serviceId: 'svc-c', count: 2 });

    // Top clients by visits: cli-x=6 (appts 1,2,3,6,7,9), cli-y=4 (appts 4,5,8,10)
    expect(stats.topClientsByVisits[0]).toEqual({ clientId: 'cli-x', count: 6 });
    expect(stats.topClientsByVisits[1]).toEqual({ clientId: 'cli-y', count: 4 });

    // Occupancy: booked+completed duration
    // booked: svc-a(60×3) + svc-b(45×2) = 180+90 = 270
    // completed: svc-a(60×2) + svc-b(45×1) = 120+45 = 165
    // Total = 435, working = 7*540 = 3780
    expect(stats.occupancyRate).toBeCloseTo(435 / 3780, 4);
  });
});
