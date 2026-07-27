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
  const end = new Date(start.getTime() + 60 * 60_000);
  return { id, clientId, serviceId, start: iso(start), end: iso(end), status };
}

describe('StatsEngine — edge cases', () => {
  it('single day range: appointment at exact start is included', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveClient({ id: 'cli-1', name: 'A', phone: '1' });

    const start = new Date('2099-01-01T09:00:00.000Z');
    const end = new Date('2099-01-02T00:00:00.000Z');
    repo.saveAppointment(makeAppt('a1', 'cli-1', 'svc-bano', start, 'booked'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(start, end);
    expect(result.appointmentsTotal).toBe(1);
    expect(result.appointmentsBooked).toBe(1);
  });

  it('appointment at exact rangeEnd is excluded', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveClient({ id: 'cli-1', name: 'A', phone: '1' });

    const start = new Date('2099-01-01T00:00:00.000Z');
    const end = new Date('2099-01-02T10:00:00.000Z');
    repo.saveAppointment(makeAppt('a1', 'cli-1', 'svc-bano', end, 'booked'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(start, end);
    expect(result.appointmentsTotal).toBe(0);
  });

  it('appointment just before rangeEnd is included', () => {
    const repo = new InMemoryRepo(false);
    repo.saveService({ id: 'svc-bano', name: 'Baño', durationMin: 60, priceCents: 100, upsells: [] });
    repo.saveClient({ id: 'cli-1', name: 'A', phone: '1' });

    const start = new Date('2099-01-01T00:00:00.000Z');
    const end = new Date('2099-01-02T10:00:00.000Z');
    const justBeforeEnd = new Date(end.getTime() - 1);
    repo.saveAppointment(makeAppt('a1', 'cli-1', 'svc-bano', justBeforeEnd, 'booked'));

    const engine = new StatsEngine(repo);
    const result = engine.compute(start, end);
    expect(result.appointmentsTotal).toBe(1);
  });

  it('occupancyRate capped at 1.0 when fully booked', () => {
    const repo = new InMemoryRepo(false);
    // Short service: 15 minutes
    repo.saveService({ id: 'svc-mini', name: 'Mini', durationMin: 15, priceCents: 50, upsells: [] });
    repo.saveClient({ id: 'cli-1', name: 'A', phone: '1' });

    // One full day range
    const start = new Date('2099