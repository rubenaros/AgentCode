import { NextRequest, NextResponse } from 'next/server';
import { StatsEngine } from '@/engine/stats';
import { getSharedInstances } from '@/infra/sharedInstances';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const startStr = params.get('start');
    const endStr = params.get('end');

    const now = new Date();
    const defaultEnd = new Date(now);
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rangeStart = startStr ? new Date(startStr) : defaultStart;
    const rangeEnd = endStr ? new Date(endStr) : defaultEnd;

    const { repo } = getSharedInstances();
    const engine = new StatsEngine(repo);
    const stats = engine.compute(rangeStart, rangeEnd);

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Error in stats API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
