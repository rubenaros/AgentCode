import { NextRequest, NextResponse } from 'next/server';
import { StatsEngine } from '@/engine/stats';
import { getSharedInstances } from '@/infra/sharedInstances';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const startParam = params.get('start');
    const endParam = params.get('end');

    let rangeStart: Date;
    let rangeEnd: Date;

    if (startParam && endParam) {
      rangeStart = new Date(startParam);
      rangeEnd = new Date(endParam);
    } else {
      // Default: last 30 days
      rangeEnd = new Date();
      rangeStart = new Date();
      rangeStart.setDate(rangeStart.getDate() - 30);
    }

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
