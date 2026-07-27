import type { StatsBundle, ServiceCount, ClientCount } from '../domain/types';
import type { Repository } from '../domain/ports';

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const WORK_MINUTES_PER_DAY = (WORK_END_HOUR - WORK_START_HOUR) * 60; // 540

function iso(d: Date): string {
  return d.toISOString();
}

function parseIso(s: string): Date {
  return new Date(s);
}

function inRange(apptStart: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return apptStart >= rangeStart && apptStart < rangeEnd;
}

export class StatsEngine {
  constructor(private repo: Repository) {}

  compute(rangeStart: Date, rangeEnd: Date): StatsBundle {
    const allAppts = this.repo.listAppointments();
    const filtered = allAppts.filter((a) => inRange(parseIso(a.start), rangeStart, rangeEnd));

    const total = filtered.length;
    const booked = filtered.filter((a) => a.status === 'booked').length;
    const completed = filtered.filter((a) => a.status === 'completed').length;
    const cancelled = filtered.filter((a) => a.status === 'cancelled').length;

    const cancellationRate = total === 0 ? 0 : Math.round((cancelled / total) * 10000) / 10000;

    // Occupancy: only count days that actually have appointments in the range
    const uniqueDays = new Set<string>();
    filtered.forEach((a) => {
      const d = parseIso(a.start);
      uniqueDays.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`);
    });
    const workingMinutes = uniqueDays.size * WORK_MINUTES_PER_DAY;

    let occupancyRate = 0;
    if (workingMinutes > 0) {
      const bookedCompleted = filtered.filter((a) => a.status !== 'cancelled');
      let durationMin = 0;
      bookedCompleted.forEach((a) => {
        durationMin += (parseIso(a.end).getTime() - parseIso(a.start).getTime()) / 60000;
      });
      occupancyRate = Math.round((durationMin / workingMinutes) * 10000) / 10000;
    }

    // Collect all service IDs from both repo services and appointments
    const services = this.repo.listServices();
    const serviceIds = new Set<string>();
    services.forEach((s) => serviceIds.add(s.id));
    filtered.forEach((a) => serviceIds.add(a.serviceId));

    const serviceBookings = new Map<string, number>();
    const serviceCancellations = new Map<string, number>();
    serviceIds.forEach((id) => {
      serviceBookings.set(id, 0);
      serviceCancellations.set(id, 0);
    });
    filtered.forEach((a) => {
      if (a.status === 'booked') {
        serviceBookings.set(a.serviceId, (serviceBookings.get(a.serviceId) || 0) + 1);
      }
      if (a.status === 'cancelled') {
        serviceCancellations.set(a.serviceId, (serviceCancellations.get(a.serviceId) || 0) + 1);
      }
    });

    const topServicesByBookings: ServiceCount[] = Array.from(serviceIds)
      .map((serviceId) => ({ serviceId, count: serviceBookings.get(serviceId) || 0 }))
      .sort((a, b) => b.count - a.count || a.serviceId.localeCompare(b.serviceId))
      .slice(0, 5);

    const topServicesByCancellations: ServiceCount[] = Array.from(serviceIds)
      .map((serviceId) => ({ serviceId, count: serviceCancellations.get(serviceId) || 0 }))
      .sort((a, b) => b.count - a.count || a.serviceId.localeCompare(b.serviceId))
      .slice(0, 5);

    // Top clients by visits (all statuses)
    const clientVisits = new Map<string, number>();
    filtered.forEach((a) => {
      clientVisits.set(a.clientId, (clientVisits.get(a.clientId) || 0) + 1);
    });

    const topClientsByVisits: ClientCount[] = Array.from(clientVisits.entries())
      .map(([clientId, count]) => ({ clientId, count }))
      .sort((a, b) => b.count - a.count || a.clientId.localeCompare(b.clientId))
      .slice(0, 5);

    return {
      rangeStart: iso(rangeStart),
      rangeEnd: iso(rangeEnd),
      appointmentsTotal: total,
      appointmentsBooked: booked,
      appointmentsCompleted: completed,
      appointmentsCancelled: cancelled,
      cancellationRate,
      occupancyRate,
      topServicesByBookings,
      topServicesByCancellations,
      topClientsByVisits,
    };
  }
}
