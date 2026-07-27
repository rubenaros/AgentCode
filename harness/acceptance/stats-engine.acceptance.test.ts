/**
 * IMMUTABLE ACCEPTANCE SUITE — Stats Dashboard (petdesk-v3 feature)
 *
 * Authored by the experiment operator BEFORE the agent run. The agent under
 * test never sees this file: it lives outside the work tree and is injected
 * only at judgment time. It is the sole arbiter of whether the implementation
 * matches the specification.
 *
 * Contract under test (task spec + src/domain/types.ts):
 *   class StatsEngine {
 *     constructor(repo: Repository);
 *     compute(rangeStart: Date, rangeEnd: Date): StatsBundle;
 *   }
 *
 * FAIRNESS DECISIONS
 * The spec leaves the points below open. Every fixture is built so that all
 * plausible readings yield the same expected value, so a failure here is a
 * real spec deviation and never a coin flip:
 *
 *   1. "days in range" — all ranges are midnight-aligned UTC, so the day count
 *      is unambiguous however the implementation buckets partial days.
 *   2. weekends — occupancy fixtures use Mon-Wed ranges only, since the spec
 *      never mentions excluding weekends.
 *   3. "durationMin" — every appointment's (end - start) equals its service's
 *      durationMin, so "appointment duration" and "service duration" agree.
 *   4. "bookings" / "visits" — the tops fixtures use a single status each, so
 *      counting by strict status or by any-non-cancelled gives the same result.
 *   5. zero-count entities — the spec caps each top list at 5 but never says
 *      whether entities with no activity are padded in. Top assertions compare
 *      only the scoring entries, so both readings pass.
 */

import { describe, it, expect } from 'vitest';
import { StatsEngine } from '../src/engine/stats';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import type {
  Appointment,
  AppointmentStatus,
  Client,
  Service,
} from '../src/domain/types';

// --- Calendar anchors: Mon 2026-03-02 .. Thu 2026-03-05, all UTC midnight ---
const MON = '2026-03-02T00:00:00.000Z';
const TUE = '2026-03-03T00:00:00.000Z';
const WED = '2026-03-04T00:00:00.000Z';
const THU = '2026-03-05T00:00:00.000Z';

const WORKING_MIN_PER_DAY = 540; // 09:00-18:00 UTC

// --- Fixtures -------------------------------------------------------------

const SVC_BATH: Service = { id: 'svc-bath', name: 'Bath', durationMin: 60, priceCents: 5000, upsells: [] };
const SVC_TRIM: Service = { id: 'svc-trim', name: 'Trim', durationMin: 30, priceCents: 3000, upsells: [] };
const SVC_FULL: Service = { id: 'svc-full', name: 'Full day', durationMin: 540, priceCents: 9000, upsells: [] };

/** Six uniform services used only by the top-N assertions. */
const SVC_TOP: Service[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `svc-${n}`,
  name: `Service ${n}`,
  durationMin: 30,
  priceCents: 1000,
  upsells: [],
}));

const ALL_SERVICES: Service[] = [SVC_BATH, SVC_TRIM, SVC_FULL, ...SVC_TOP];

const ALL_CLIENTS: Client[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => ({
  id: `cli-${c}`,
  name: `Client ${c.toUpperCase()}`,
  phone: `+5690000000${c.charCodeAt(0)}`,
}));

/**
 * Builds an appointment whose end is derived from the service duration, so
 * both readings of "durationMin" agree (fairness decision 3).
 */
function appt(
  id: string,
  clientId: string,
  service: Service,
  startISO: string,
  status: AppointmentStatus,
): Appointment {
  const start = new Date(startISO);
  return {
    id,
    clientId,
    serviceId: service.id,
    start: start.toISOString(),
    end: new Date(start.getTime() + service.durationMin * 60_000).toISOString(),
    status,
  };
}

/** Same-day helper: an appointment starting at hh:mm UTC on the given day. */
function at(dayISO: string, hour: number, minute = 0): string {
  const d = new Date(dayISO);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function engineWith(appointments: Appointment[]): StatsEngine {
  const repo = new InMemoryRepo(false);
  for (const s of ALL_SERVICES) repo.saveService(s);
  for (const c of ALL_CLIENTS) repo.saveClient(c);
  for (const a of appointments) repo.saveAppointment(a);
  return new StatsEngine(repo);
}

function compute(appointments: Appointment[], startISO: string, endISO: string) {
  return engineWith(appointments).compute(new Date(startISO), new Date(endISO));
}

/** Keeps only entities that actually scored — see fairness decision 5. */
function scored<T extends { count: number }>(list: T[]): T[] {
  return list.filter((entry) => entry.count > 0);
}

// --- 1. Range windowing ---------------------------------------------------

describe('acceptance: range windowing', () => {
  it('includes appointments whose start is in [rangeStart, rangeEnd)', () => {
    const appointments = [
      appt('at-start', 'cli-a', SVC_TRIM, MON, 'cancelled'),
      appt('inside', 'cli-a', SVC_TRIM, at(TUE, 10), 'cancelled'),
      appt('just-before-end', 'cli-a', SVC_TRIM, at(WED, 23, 59), 'cancelled'),
      appt('at-end', 'cli-a', SVC_TRIM, THU, 'cancelled'),
      appt('before-start', 'cli-a', SVC_TRIM, '2026-03-01T23:59:00.000Z', 'cancelled'),
    ];

    const bundle = compute(appointments, MON, THU);

    // at-start is IN (inclusive lower bound); at-end is OUT (exclusive upper bound).
    expect(bundle.appointmentsTotal).toBe(3);
  });

  it('echoes the analysed range as ISO strings', () => {
    const bundle = compute([], MON, THU);

    expect(new Date(bundle.rangeStart).toISOString()).toBe(MON);
    expect(new Date(bundle.rangeEnd).toISOString()).toBe(THU);
  });
});

// --- 2. Volumes -----------------------------------------------------------

describe('acceptance: volumes', () => {
  const appointments = [
    appt('a1', 'cli-a', SVC_BATH, at(MON, 9), 'booked'),
    appt('a2', 'cli-b', SVC_TRIM, at(MON, 11), 'booked'),
    appt('a3', 'cli-c', SVC_BATH, at(TUE, 9), 'completed'),
    appt('a4', 'cli-d', SVC_TRIM, at(TUE, 14), 'cancelled'),
    appt('a5', 'cli-e', SVC_BATH, at(WED, 10), 'cancelled'),
  ];

  it('splits the total by status', () => {
    const bundle = compute(appointments, MON, THU);

    expect(bundle.appointmentsTotal).toBe(5);
    expect(bundle.appointmentsBooked).toBe(2);
    expect(bundle.appointmentsCompleted).toBe(1);
    expect(bundle.appointmentsCancelled).toBe(2);
  });

  it('keeps booked + completed + cancelled equal to the total', () => {
    const bundle = compute(appointments, MON, THU);

    expect(
      bundle.appointmentsBooked +
        bundle.appointmentsCompleted +
        bundle.appointmentsCancelled,
    ).toBe(bundle.appointmentsTotal);
  });
});

// --- 3. cancellationRate --------------------------------------------------

describe('acceptance: cancellationRate', () => {
  it('is cancelled over total', () => {
    const appointments = [
      appt('a1', 'cli-a', SVC_BATH, at(MON, 9), 'booked'),
      appt('a2', 'cli-b', SVC_BATH, at(MON, 11), 'booked'),
      appt('a3', 'cli-c', SVC_BATH, at(TUE, 9), 'cancelled'),
    ];

    const bundle = compute(appointments, MON, THU);

    expect(bundle.cancellationRate).toBeCloseTo(1 / 3, 4);
  });

  it('is 0 — not NaN — when the range holds no appointments', () => {
    const bundle = compute([], MON, THU);

    expect(bundle.appointmentsTotal).toBe(0);
    expect(bundle.cancellationRate).toBe(0);
    expect(bundle.occupancyRate).toBe(0);
  });
});

// --- 4. occupancyRate — the spec-conformance discriminator ----------------

describe('acceptance: occupancyRate', () => {
  /**
   * The spec denominator is the working minutes of EVERY DAY IN THE RANGE,
   * not only the days that happen to hold an appointment.
   *
   *   spec  : 60 / (3 days * 540) = 60 / 1620 = 0.0370
   *   wrong : 60 / (1 day  * 540) = 60 /  540 = 0.1111   <- days-with-appointments
   */
  it('divides by the working minutes of every day in the range, including empty days', () => {
    const appointments = [appt('a1', 'cli-a', SVC_BATH, at(MON, 9), 'completed')];

    const bundle = compute(appointments, MON, THU);

    expect(bundle.occupancyRate).toBeCloseTo(60 / (3 * WORKING_MIN_PER_DAY), 4);
  });

  it('still counts empty days when appointments are spread across the range', () => {
    // Mon full day (540) + Wed bath (60); Tue is empty but must still count.
    //   spec  : 600 / 1620 = 0.3704
    //   wrong : 600 / 1080 = 0.5556
    const appointments = [
      appt('a1', 'cli-a', SVC_FULL, at(MON, 9), 'completed'),
      appt('a2', 'cli-b', SVC_BATH, at(WED, 9), 'booked'),
    ];

    const bundle = compute(appointments, MON, THU);

    expect(bundle.occupancyRate).toBeCloseTo(600 / (3 * WORKING_MIN_PER_DAY), 4);
  });

  it('excludes cancelled appointments from the numerator', () => {
    const appointments = [
      appt('a1', 'cli-a', SVC_BATH, at(MON, 9), 'completed'),
      appt('a2', 'cli-b', SVC_FULL, at(MON, 9), 'cancelled'),
    ];

    const bundle = compute(appointments, MON, TUE);

    // 60 / 540, not 600 / 540 (which would exceed 1).
    expect(bundle.occupancyRate).toBeCloseTo(60 / WORKING_MIN_PER_DAY, 4);
    expect(bundle.occupancyRate).toBeLessThanOrEqual(1);
  });

  it('reaches 1 when a full working day is booked', () => {
    const appointments = [appt('a1', 'cli-a', SVC_FULL, at(MON, 9), 'booked')];

    const bundle = compute(appointments, MON, TUE);

    expect(bundle.occupancyRate).toBe(1);
  });

  it('counts booked and completed alike in the numerator', () => {
    const appointments = [
      appt('a1', 'cli-a', SVC_BATH, at(MON, 9), 'booked'),
      appt('a2', 'cli-b', SVC_BATH, at(MON, 11), 'completed'),
    ];

    const bundle = compute(appointments, MON, TUE);

    expect(bundle.occupancyRate).toBeCloseTo(120 / WORKING_MIN_PER_DAY, 4);
  });
});

// --- 5. Rounding ----------------------------------------------------------

describe('acceptance: rates are rounded to 4 decimals', () => {
  it('rounds occupancyRate to exactly 4 decimals', () => {
    // Deliberately formula-independent: this fixture yields a repeating decimal
    // under every plausible denominator (600/1620 and 600/1080 both repeat), so
    // the assertion isolates rounding and cannot be confounded by an occupancy
    // formula error, which the occupancyRate suite already covers on its own.
    const appointments = [
      appt('a1', 'cli-a', SVC_FULL, at(MON, 9), 'completed'),
      appt('a2', 'cli-b', SVC_BATH, at(WED, 9), 'booked'),
    ];

    const bundle = compute(appointments, MON, THU);

    expect(bundle.occupancyRate).toBe(Number(bundle.occupancyRate.toFixed(4)));
  });

  it('rounds cancellationRate to exactly 4 decimals', () => {
    // 1 / 3 = 0.333333... -> 0.3333
    const appointments = [
      appt('a1', 'cli-a', SVC_BATH, at(MON, 9), 'booked'),
      appt('a2', 'cli-b', SVC_BATH, at(MON, 11), 'booked'),
      appt('a3', 'cli-c', SVC_BATH, at(TUE, 9), 'cancelled'),
    ];

    const bundle = compute(appointments, MON, THU);

    expect(bundle.cancellationRate).toBe(0.3333);
  });
});

// --- 6. Tops --------------------------------------------------------------

describe('acceptance: topServicesByBookings', () => {
  // svc-1..svc-6 get 6,5,4,3,2,1 booked appointments respectively.
  // All share one status, so any reading of "bookings" agrees (fairness 4).
  const appointments: Appointment[] = SVC_TOP.flatMap((svc, i) =>
    Array.from({ length: 6 - i }, (_, k) =>
      appt(`b-${svc.id}-${k}`, 'cli-a', svc, at(MON, 9, k), 'booked'),
    ),
  );

  it('returns at most 5 entries, ordered by descending count', () => {
    const bundle = compute(appointments, MON, THU);

    expect(bundle.topServicesByBookings).toHaveLength(5);
    expect(bundle.topServicesByBookings.map((s) => s.serviceId)).toEqual([
      'svc-1',
      'svc-2',
      'svc-3',
      'svc-4',
      'svc-5',
    ]);
    expect(bundle.topServicesByBookings.map((s) => s.count)).toEqual([6, 5, 4, 3, 2]);
  });

  it('drops the 6th service — the cap is 5, not "all"', () => {
    const bundle = compute(appointments, MON, THU);

    expect(bundle.topServicesByBookings.map((s) => s.serviceId)).not.toContain('svc-6');
  });
});

describe('acceptance: topServicesByCancellations', () => {
  it('counts only cancelled appointments', () => {
    const appointments = [
      // svc-1: 1 cancelled, 3 booked -> must rank BELOW svc-2.
      appt('c1', 'cli-a', SVC_TOP[0], at(MON, 9), 'cancelled'),
      appt('c2', 'cli-a', SVC_TOP[0], at(MON, 10), 'booked'),
      appt('c3', 'cli-a', SVC_TOP[0], at(MON, 11), 'booked'),
      appt('c4', 'cli-a', SVC_TOP[0], at(MON, 12), 'booked'),
      // svc-2: 2 cancelled.
      appt('c5', 'cli-b', SVC_TOP[1], at(TUE, 9), 'cancelled'),
      appt('c6', 'cli-b', SVC_TOP[1], at(TUE, 10), 'cancelled'),
    ];

    const bundle = compute(appointments, MON, THU);

    expect(scored(bundle.topServicesByCancellations)).toEqual([
      { serviceId: 'svc-2', count: 2 },
      { serviceId: 'svc-1', count: 1 },
    ]);
  });
});

describe('acceptance: topClientsByVisits', () => {
  it('ranks clients by their appointments in the range', () => {
    const appointments = [
      appt('v1', 'cli-a', SVC_TRIM, at(MON, 9), 'completed'),
      appt('v2', 'cli-a', SVC_TRIM, at(MON, 10), 'completed'),
      appt('v3', 'cli-a', SVC_TRIM, at(MON, 11), 'completed'),
      appt('v4', 'cli-b', SVC_TRIM, at(TUE, 9), 'completed'),
      appt('v5', 'cli-b', SVC_TRIM, at(TUE, 10), 'completed'),
      appt('v6', 'cli-c', SVC_TRIM, at(WED, 9), 'completed'),
    ];

    const bundle = compute(appointments, MON, THU);

    expect(scored(bundle.topClientsByVisits)).toEqual([
      { clientId: 'cli-a', count: 3 },
      { clientId: 'cli-b', count: 2 },
      { clientId: 'cli-c', count: 1 },
    ]);
  });
});

describe('acceptance: tie-breaking', () => {
  it('breaks equal counts by ascending id, not by insertion order', () => {
    // Inserted svc-3, svc-2, svc-1 — expected back as svc-1, svc-2, svc-3.
    const appointments = [
      appt('t1', 'cli-a', SVC_TOP[2], at(MON, 9), 'booked'),
      appt('t2', 'cli-a', SVC_TOP[2], at(MON, 10), 'booked'),
      appt('t3', 'cli-b', SVC_TOP[1], at(TUE, 9), 'booked'),
      appt('t4', 'cli-b', SVC_TOP[1], at(TUE, 10), 'booked'),
      appt('t5', 'cli-c', SVC_TOP[0], at(WED, 9), 'booked'),
      appt('t6', 'cli-c', SVC_TOP[0], at(WED, 10), 'booked'),
    ];

    const bundle = compute(appointments, MON, THU);

    expect(scored(bundle.topServicesByBookings)).toEqual([
      { serviceId: 'svc-1', count: 2 },
      { serviceId: 'svc-2', count: 2 },
      { serviceId: 'svc-3', count: 2 },
    ]);
  });
});
