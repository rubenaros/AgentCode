import type { Repository } from '@/domain/ports';
import type { StatsBundle, ServiceCount, ClientCount } from '@/domain/types';

/**
 * Computes StatsBundle aggregations over a time range.
 */
export class StatsEngine {
  constructor(private readonly repo: Repository) {}

  compute(rangeStart: Date, rangeEnd: Date): StatsBundle {
    const allAppts = this.repo.listAppointments();
    const services = this.repo.listServices();
    const serviceMap = new Map(services.map((s) => [s.id, s]));

    // Filter to range [rangeStart, rangeEnd) — start is an ISO string
    const inRange = allAppts.filter((a) => {
      const start = new Date(a.start);
      return start >= rangeStart && start < rangeEnd;
    });

    const total = inRange.length;
    const booked = inRange.filter((a) => a.status === 'booked').length;
    const completed = inRange.filter((a) => a.status === 'completed').length;
    const cancelled = inRange.filter((a) => a.status === 'cancelled').length;
    const cancellationRate = total === 0 ? 0 : round(cancelled / total, 4);

    // Occupancy: booked+completed duration / working minutes in range
    const workingMin = getWorkingMinutes(rangeStart, rangeEnd);
    const bookedCompletedDuration = inRange
      .filter((a) => a.status === 'booked' || a.status === 'completed')
      .reduce((sum, a) => {
        const svc = serviceMap.get(a.serviceId);
        return sum + (svc?.durationMin ?? 0);
      }, 0);
    const occupancyRate =
      workingMin === 0 ? 0 : round(bookedCompletedDuration / workingMin, 4);

    return {
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      appointmentsTotal: total,
      appointmentsBooked: booked,
      appointmentsCompleted: completed,
      appointmentsCancelled: cancelled,
      cancellationRate,
      occupancyRate,
      topServicesByBookings: top5By(
        inRange.filter((a) => a.status === 'booked'),
        (a) => a.serviceId,
        serviceMap,
      ),
      topServicesByCancellations: top5By(
        inRange.filter((a) => a.status === 'cancelled'),
        (a) => a.serviceId,
        serviceMap,
      ),
      topClientsByVisits: top5ByClient(
        inRange.filter((a) => a.status === 'booked' || a.status === 'completed'),
      ),
    };
  }
}

// ---- internals ----

function round(v: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

function getWorkingMinutes(rangeStart: Date, rangeEnd: Date): number {
  let minutes = 0;
  const d = new Date(rangeStart);
  d.setUTCHours(0, 0, 0, 0);

  while (d.getTime() < rangeEnd.getTime()) {
    const dayStart = new Date(d);
    dayStart.setUTCHours(9, 0, 0, 0);
    const dayEnd = new Date(d);
    dayEnd.setUTCHours(18, 0, 0, 0);

    const effStart = dayStart > rangeStart ? dayStart : rangeStart;
    const effEnd = dayEnd < rangeEnd ? dayEnd : rangeEnd;

    if (effStart < effEnd) {
      minutes += (effEnd.getTime() - effStart.getTime()) / 60000;
    }

    d.setUTCDate(d.getUTCDate() + 1);
  }

  return minutes;
}

function top5By(
  appts: Array<{ serviceId: string }>,
  getId: (a: { serviceId: string }) => string,
  serviceMap: Map<string, { durationMin: number }>,
): ServiceCount[] {
  const counts = new Map<string, number>();
  for (const a of appts) {
    const id = getId(a);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const items: { id: string; count: number }[] = [...counts.entries()].map(
    ([id, count]) => ({ id, count }),
  );
  items.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return items.slice(0, 5).map((i) => ({ serviceId: i.id, count: i.count }));
}

function top5ByClient(appts: Array<{ clientId: string }>): ClientCount[] {
  const counts = new Map<string, number>();
  for (const a of appts) {
    const id = a.clientId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const items: { id: string; count: number }[] = [...counts.entries()].map(
    ([id, count]) => ({ id, count }),
  );
  items.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return items.slice(0, 5).map((i) => ({ clientId: i.id, count: i.count }));
}
