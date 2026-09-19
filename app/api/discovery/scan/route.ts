import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scanDetailed } from '@/lib/pii';

const schema = z.object({
  text: z.string().min(1).max(1_000_000),
  sourceName: z.string().min(1).max(200).default('Manual input'),
});

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const scanResult = scanDetailed(input.text);

    return NextResponse.json({
      data: {
        sourceName: input.sourceName,
        findings: scanResult.findings,
        highConfidenceFindings: scanResult.highConfidenceFindings,
        lowConfidenceFindings: scanResult.lowConfidenceFindings,
        maskedText: scanResult.maskedText,
        summary: scanResult.summary,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid scan request', details: e instanceof z.ZodError ? e.flatten() : undefined },
      { status: 400 }
    );
  }
}
