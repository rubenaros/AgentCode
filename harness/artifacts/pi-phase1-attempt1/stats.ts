import type { Repository } from '../domain/ports';
import type {
  Appointment,
  Service,
  ServiceCount,
  ClientCount,
  StatsBundle,
  AppointmentStatus,
} from '../domain/types';

function parseIso(s: string): Date {
  return new Date(s);
}

/**
 * StatsEngine — computa agregaciones sobre un rango temporal.
 * Rango: [rangeStart, rangeEnd).
 */
export class StatsEngine {
  constructor(private repo: Repository) {}

  compute(rangeStart: Date, rangeEnd: Date): StatsBundle {
    const services = this.repo.listServices();
    const appointments = this.repo.listAppointments();

    // Filter appointments in [rangeStart, rangeEnd)
    const filtered = appointments.filter((a) => {
      const start = parseIso(a.start);
      return start >= rangeStart && start < rangeEnd;
    });

    const appointmentsTotal = filtered.length;
    const appointmentsBooked = filtered.filter((a) => a.status === 'booked').length;
    const appointmentsCompleted = filtered.filter((a) => a.status === 'completed').length;
    const appointmentsCancelled = filtered.filter((a) => a.status === 'cancelled').length;

    // Rates
    const cancellationRate =
      appointmentsTotal === 0 ? 0 : Math.round((appointmentsCancelled / appointmentsTotal) * 10000) / 10000;

    // Occupancy: booked+completed duration / working minutes in range
    const nonCancelled = filtered.filter((a) => a.status === 'booked' || a.status === 'completed');
    let bookedDurationMin = 0;
    for (const a of nonCancelled) {
      const svc = services.find((s) => s.id === a.serviceId);
      if (svc) {
        bookedDurationMin += svc.durationMin;
      }
    }
    const workingMinutes = this.countWorkingMinutes(rangeStart, rangeEnd);
    const occupancyRate =
      workingMinutes === 0 ? 0 : Math.round((bookedDurationMin / workingMinutes) * 10000) / 10000;

    // Top services by bookings (booked status)
    const topServicesByBookings = this.topServicesByStatus(filtered, 'booked', services);
    // Top services by cancellations (cancelled status)
    const topServicesByCancellations = this.topServicesByStatus(filtered, 'cancelled', services);
    // Top clients by visits (booked + completed)
    const topClientsByVisits = this.topClientsByStatus(filtered, ['booked', 'completed']);

    return {
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      appointmentsTotal,
      appointmentsBooked,
      appointmentsCompleted,
      appointmentsCancelled,
      cancellationRate,
      occupancyRate,
      topServicesByBookings,
      topServicesByCancellations,
      topClientsByVisits,
    };
  }

  private topServicesByStatus(
    appointments: Appointment[],
    status: AppointmentStatus,
    services: Service[],
  ): ServiceCount[] {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      if (a.status === status) {
        counts.set(a.serviceId, (counts.get(a.serviceId) || 0) + 1);
      }
    }
    const entries: ServiceCount[] = [...counts.entries()].map(([serviceId, count]) => ({ serviceId, count }));
    // Sort desc by count, then asc by serviceId for stable tie-break
    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.serviceId.localeCompare(b.serviceId);
    });
    return entries.slice(0, 5);
  }

  private topClientsByStatus(
    appointments: Appointment[],
    statuses: AppointmentStatus[],
  ): ClientCount[] {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      if (statuses.includes(a.status)) {
        counts.set(a.clientId, (counts.get(a.clientId) || 0) + 1);
      }
    }
    const entries: ClientCount[] = [...counts.entries()].map(([clientId, count]) => ({ clientId, count }));
    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.clientId.localeCompare(b.clientId);
    });
    return entries.slice(0, 5);
  }

  private countWorkingMinutes(rangeStart: Date, rangeEnd: Date): number {
    // Iterate over each calendar day that overlaps with [rangeStart, rangeEnd)
    // and sum 9:00-18:00 UTC working minutes.
    let day = new Date(rangeStart);
    day.setUTCHours(0, 0, 0, 0);

    let totalMinutes = 0;
    while (day.getTime() < rangeEnd.getTime()) {
      const dayStart = new Date(day);
      dayStart.setUTCHours(9, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setUTCHours(18, 0, 0, 0);

      // Intersection of [dayStart, dayEnd) with [rangeStart, rangeEnd)
      const workStartMs = Math.max(dayStart.getTime(), rangeStart.getTime());
      const workEndMs = Math.min(dayEnd.getTime(), rangeEnd.getTime());

      if (workEndMs > workStartMs) {
        totalMinutes += (workEndMs - workStartMs) / 60_000;
      }

      day.setUTCDate(day.getUTCDate() + 1);
    }

    return totalMinutes;
  }
}
