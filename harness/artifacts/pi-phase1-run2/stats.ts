import type { Appointment, StatsBundle, ServiceCount, ClientCount } from '../domain/types';
import type { Repository } from '../domain/ports';

export class StatsEngine {
  constructor(private repo: Repository) {}

  compute(rangeStart: Date, rangeEnd: Date): StatsBundle {
    const appointments = this.repo.listAppointments();

    // Filter: start falls in [rangeStart, rangeEnd)
    const filtered = appointments.filter(
      (a) => new Date(a.start) >= rangeStart && new Date(a.start) < rangeEnd
    );

    const total = filtered.length;
    const booked = filtered.filter((a) => a.status === 'booked').length;
    const completed = filtered.filter((a) => a.status === 'completed').length;
    const cancelled = filtered.filter((a) => a.status === 'cancelled').length;

    const cancellationRate = total === 0 ? 0 : Math.round((cancelled / total) * 10000) / 10000;

    const services = this.repo.listServices();
    const serviceDuration = new Map<string, number>();
    for (const s of services) {
      serviceDuration.set(s.id, s.durationMin);
    }

    // Occupancy: durationMin of booked+completed appointments / working minutes in range
    let totalDurationMin = 0;
    for (const a of filtered) {
      if (a.status === 'booked' || a.status === 'completed') {
        const dur = serviceDuration.get(a.serviceId) ?? 0;
        totalDurationMin += dur;
      }
    }

    const workingMinutesPerDay = 9 * 60; // 9:00-18:00 UTC = 540 min
    const startDay = new Date(rangeStart);
    const endDay = new Date(rangeEnd);
    // Count unique calendar days (UTC) in [rangeStart, rangeEnd)
    const startMs = Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate());
    const endMs = Date.UTC(endDay.getUTCFullYear(), endDay.getUTCMonth(), endDay.getUTCDate());
    const dayCount = Math.max(0, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)));
    const totalWorkingMinutes = dayCount * workingMinutesPerDay;

    const occupancyRate = totalWorkingMinutes === 0 ? 0 : Math.round((totalDurationMin / totalWorkingMinutes) * 10000) / 10000;

    // Top services by bookings (status = 'booked')
    const topServicesByBookings = this.topServicesBy(filtered, (a) => a.status === 'booked');

    // Top services by cancellations (status = 'cancelled')
    const topServicesByCancellations = this.topServicesBy(filtered, (a) => a.status === 'cancelled');

    // Top clients by visits (any status in range)
    const topClientsByVisits = this.topClientsBy(filtered);

    return {
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
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

  private topServicesBy(appointments: Appointment[], predicate: (a: Appointment) => boolean): ServiceCount[] {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      if (predicate(a)) {
        counts.set(a.serviceId, (counts.get(a.serviceId) ?? 0) + 1);
      }
    }
    return this.toTop5ServiceCount(counts);
  }

  private topClientsBy(appointments: Appointment[]): ClientCount[] {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      counts.set(a.clientId, (counts.get(a.clientId) ?? 0) + 1);
    }
    return this.toTop5ClientCount(counts);
  }

  private toTop5ServiceCount(counts: Map<string, number>): ServiceCount[] {
    const entries = [...counts.entries()];
    entries.sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : 1;
    });
    const result: ServiceCount[] = [];
    for (let i = 0; i < Math.min(5, entries.length); i++) {
      result.push({ serviceId: entries[i][0], count: entries[i][1] });
    }
    return result;
  }

  private toTop5ClientCount(counts: Map<string, number>): ClientCount[] {
    const entries = [...counts.entries()];
    entries.sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : 1;
    });
    const result: ClientCount[] = [];
    for (let i = 0; i < Math.min(5, entries.length); i++) {
      result.push({ clientId: entries[i][0], count: entries[i][1] });
    }
    return result;
  }
}
