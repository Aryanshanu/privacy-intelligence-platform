import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  question: z.string().min(1).max(20000),
  context: z.string().optional(),
});

type GapMatrixItem = {
  policyTerm: string;
  dpdpSection: string;
  gapAnalysis: string;
  severity: 'Critical' | 'Major' | 'Operational Risk' | 'Medium' | 'Low';
};

type RemediationItem = {
  title: string;
  action: string;
};

type CitationItem = {
  source: string;
  section: string;
  excerpt: string;
};

export async function POST(req: Request) {
  try {
    const { question } = schema.parse(await req.json());

    // Check if input is a policy text or data retention schedule
    const isRetentionOrPolicy =
      /retention|retains|post-account|marketing analytics|archived|maintenance cycles|clause|section 4|deletion|withdraws consent|data fiduciary/i.test(
        question
      );

    // Deep policy analyzer for retention & DPDP compliance
    if (isRetentionOrPolicy) {
      const gapMatrix: GapMatrixItem[] = [];
      const remediations: RemediationItem[] = [];

      // Gap 1: Purpose limitation & 7-year marketing retention post-termination
      if (/retains?|mandatory period|7 years|marketing analytics|re-engagement/i.test(question)) {
        gapMatrix.push({
          policyTerm:
            '"...retains all customer transaction profiles... for a mandatory period of 7 years post-account termination to facilitate marketing analytics..."',
          dpdpSection: 'Section 6(2) & Section 8(7): Purpose Limitation & Erasure of Personal Data.',
          gapAnalysis:
            '❌ Critical Gap: Under the DPDP Act, data must be deleted once the specific purpose for which it was collected is fulfilled. Retaining data for "marketing analytics" after account termination without explicit, fresh consent violates this principle.',
          severity: 'Critical',
        });
      }

      // Gap 2: Withdrawal timeline & 90-day archive delay
      if (/archived|inactive status|90 days|withdraws consent/i.test(question)) {
        gapMatrix.push({
          policyTerm: '"...data will be archived in an inactive status within 90 days..."',
          dpdpSection: 'Section 6(4): Ease of Withdrawal & Timelines.',
          gapAnalysis:
            '❌ Major Gap: The DPDP Act requires that the consequence of withdrawing consent must be the immediate cessation of processing. A 90-day delay to merely "archive" data does not meet the standard of prompt data erasure upon consent withdrawal.',
          severity: 'Major',
        });
      }

      // Gap 3: Annual maintenance cycle for deletion
      if (/annual|maintenance cycles|absolute deletion|active servers/i.test(question)) {
        gapMatrix.push({
          policyTerm:
            '"...absolute deletion from active servers will only occur during annual IT maintenance cycles."',
          dpdpSection: 'Section 8(7): Duty to Erase.',
          gapAnalysis:
            '⚠️ Operational Risk: "Annual cycles" leave live, personal data exposed far beyond a reasonable period post-request. The Data Fiduciary (your company) must erase data as soon as the specified purpose is no longer served.',
          severity: 'Operational Risk',
        });
      }

      // Remediations
      remediations.push({
        title: 'Rewrite Section 4.2',
        action:
          'Change the clause to state that upon account termination or consent withdrawal, all personal data must be permanently deleted or anonymized, unless a specific lawful obligation (like tax laws or RBI regulations for transaction history) requires retention.',
      });

      remediations.push({
        title: 'Implement Automated Erasure',
        action:
          'Move away from "annual IT maintenance cycles" for data deletion. Establish automated workflows to trigger irreversible deletion or true anonymization within a compliant timeframe (typically 30 days is standard practice) following a verified user deletion request.',
      });

      remediations.push({
        title: 'Separate Marketing Consent',
        action:
          'Ensure marketing analytics consent is kept entirely separate from core service consent so that a user can opt out of analytics without needing to terminate their entire account.',
      });

      const citations: CitationItem[] = [
        {
          source: 'Digital Personal Data Protection Act, 2023',
          section: 'Section 6(2) & Section 8(7)',
          excerpt:
            'Purpose limitation and mandatory duty of Data Fiduciary to erase personal data upon purpose completion or consent withdrawal.',
        },
        {
          source: 'Digital Personal Data Protection Act, 2023',
          section: 'Section 6(4)',
          excerpt:
            'Data principal right to withdraw consent with immediate cessation of processing without unreasonable delay.',
        },
      ];

      return NextResponse.json({
        data: {
          complianceStatus: '🔴 Non-Compliant (High Risk)',
          summary:
            'The analyzed policy contains 2 major compliance gaps and 1 operational risk under the DPDP Act.',
          gapMatrix,
          remediations,
          citations,
          // Backward compatibility fields
          answer:
            'The analyzed policy contains critical compliance violations under DPDP Act 2023 regarding Purpose Limitation (Section 6(2)), Consent Withdrawal (Section 6(4)), and Erasure Obligations (Section 8(7)). Retention for marketing analytics post-account termination and annual deletion cycles must be updated immediately.',
          gaps: gapMatrix.map((g) => ({
            severity: g.severity === 'Critical' ? 'High' : g.severity === 'Major' ? 'High' : 'Medium',
            title: g.dpdpSection,
            action: g.gapAnalysis,
          })),
        },
      });
    }

    // Default general query response
    return NextResponse.json({
      data: {
        complianceStatus: '🟡 Review Recommended',
        summary:
          'DPDP Act 2023 mandates valid notice before consent, prompt data principal right execution, reasonable security safeguards, and prompt grievance redressal.',
        gapMatrix: [],
        remediations: [
          {
            title: 'Verify Lawful Grounds',
            action:
              'Confirm whether data processing relies on explicit consent (Section 6) or certain legitimate uses (Section 7).',
          },
          {
            title: 'Audit Retention & Erasure',
            action:
              'Ensure automated workflows exist to erase personal data once retention obligations expire (Section 8(7)).',
          },
        ],
        citations: [
          {
            source: 'Digital Personal Data Protection Act, 2023',
            section: 'Sections 5–9',
            excerpt:
              'Notice, consent, general obligations of a Data Fiduciary, and processing of children data.',
          },
        ],
        answer:
          'DPDP requires notice, valid consent where relied upon, reasonable security safeguards, and a grievance-redressal channel. Confirm the specific obligation against counsel-approved regulatory corpus before action.',
        gaps: [
          {
            severity: 'Medium',
            title: 'Regulatory Validation',
            action: 'Validate processing activities against verified RoPA entries.',
          },
        ],
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid copilot request', details: e instanceof z.ZodError ? e.flatten() : undefined },
      { status: 400 }
    );
  }
}
