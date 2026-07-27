import type { Repository } from '../domain/ports';
import type { Appointment, ServiceCount, ClientCount, StatsBundle } from '../domain/types';

/**
 * StatsEngine — computes a StatsBundle over a time range.
 *
 * Range semantics: [rangeStart, rangeEnd) — inclusive start, exclusive end.
 *
 * Occupancy: sum(durationMin) of non-cancelled appointments in range
 *           / (working minutes per day × number of days in range)
 * Working hours: 09:00–18:00 UTC = 540 min/day.
 */

function parseIso(s: string): Date {
  return new Date(s);
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export class StatsEngine {
  constructor(private repo: Repository) {}

  compute(rangeStart: Date, rangeEnd: Date): StatsBundle {
    const allAppts = this.repo.listAppointments();

    // Filter appointments whose start falls in [rangeStart, rangeEnd)
    const filtered = allAppts.filter((a) => {
      const start = parseIso(a.start);
      return start >= rangeStart && start < rangeEnd;
    });

    const appointmentsTotal = filtered.length;
    const appointmentsBooked = filtered.filter((a) => a.status === 'booked').length;
    const appointmentsCompleted = filtered.filter((a) => a.status === 'completed').length;
    const appointmentsCancelled = filtered.filter((a) => a.status === 'cancelled').length;

    // Cancellation rate
    const cancellationRate =
      appointmentsTotal === 0 ? 0 : round4(appointmentsCancelled / appointmentsTotal);

    // Occupancy rate
    // Count calendar days in range [rangeStart, rangeEnd)
    const rangeStartDay = new Date(rangeStart);
    rangeStartDay.setUTCHours(0, 0, 0, 0);
    const rangeEndDay = new Date(rangeEnd);
    rangeEndDay.setUTCHours(0, 0, 0, 0);

    let workingDays = 0;
    for (let d = new Date(rangeStartDay); d < rangeEndDay; d.setUTCDate(d.getUTCDate() + 1)) {
      workingDays++;
    }

    // Sum durationMin of non-cancelled appointments in range
    const workingMinutes = workingDays * 540; // 9:00-18:00 UTC = 540 min
    let bookedCompletedMinutes = 0;

    for (const a of filtered) {
      if (a.status !== 'cancelled') {
        const start = parseIso(a.start);
        const end = parseIso(a.end);
        bookedCompletedMinutes += Math.round((end.getTime() - start.getTime()) / 60000);
      }
    }

    const occupancyRate =
      workingMinutes === 0 ? 0 : round4(bookedCompletedMinutes / workingMinutes);

    // Top services by bookings (count of booked appointments per service)
    const topServicesByBookings = this._topServicesBy(
      filtered.filter((a) => a.status === 'booked'),
    );

    // Top services by cancellations (count of cancelled appointments per service)
    const topServicesByCancellations = this._topServicesBy(
      filtered.filter((a) => a.status === 'cancelled'),
    );

    // Top clients by visits (count of booked + completed appointments per client)
    const topClientsByVisits = this._topClients(
      filtered.filter((a) => a.status !== 'cancelled'),
    );

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

  private _topServicesBy(appointments: Appointment[]): ServiceCount[] {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      counts.set(a.serviceId, (counts.get(a.serviceId) ?? 0) + 1);
    }

    const sorted = [...counts.entries()].map(
      ([serviceId, count]) => ({ serviceId, count }),
    );

    // Stable sort: descending by count, then ascending by serviceId for ties
    sorted.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0;
    });

    return sorted.slice(0, 5);
  }

  private _topClients(appointments: Appointment[]): ClientCount[] {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      counts.set(a.clientId, (counts.get(a.clientId) ?? 0) + 1);
    }

    const sorted = [...counts.entries()].map(
      ([clientId, count]) => ({ clientId, count }),
    );

    sorted.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
    });

    return sorted.slice(0, 5);
  }
}
