import { NextResponse } from 'next/server';
import { StatsEngine } from '@/engine/stats';
import { getSharedInstances } from '@/infra/sharedInstances';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get('start');
    const endParam = searchParams.get('end');

    const now = new Date();
    const defaultEnd = new Date(now);
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rangeStart = startParam ? new Date(startParam) : defaultStart;
    const rangeEnd = endParam ? new Date(endParam) : defaultEnd;

    if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
      return NextResponse.json({ error: 'Invalid date format. Use ISO 8601.' }, { status: 400 });
    }

    const engine = new StatsEngine(getSharedInstances().repo);
    const stats = engine.compute(rangeStart, rangeEnd);

    return NextResponse.json({ stats });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
