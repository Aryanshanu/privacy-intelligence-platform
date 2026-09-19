'use client';

import { useState } from 'react';

type GapItem = {
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

type CopilotResponse = {
  complianceStatus?: string;
  summary?: string;
  gapMatrix?: GapItem[];
  remediations?: RemediationItem[];
  citations?: CitationItem[];
  answer?: string;
  gaps?: { severity: string; title: string; action: string }[];
};

const POLICY_SAMPLE =
  'Section 4.2: Data Retention Schedules. The Company retains all customer transaction profiles, account history, and associated identifiers for a mandatory period of 7 years post-account termination to facilitate marketing analytics and seasonal re-engagement campaigns. If a customer requests account deletion or withdraws consent, data will be archived in an inactive status within 90 days, but absolute deletion from active servers will only occur during annual IT maintenance cycles';

export function Copilot() {
  const [q, setQ] = useState(POLICY_SAMPLE);
  const [r, setR] = useState<CopilotResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    try {
      const x = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const res = await x.json();
      setR(res.data);
    } catch (err) {
      console.error('Copilot query error:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="form" style={{ maxWidth: '1000px' }}>
      <textarea
        rows={6}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Paste a policy clause or ask a DPDP compliance question..."
      />

      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={ask} disabled={loading} style={{ flex: 1 }}>
          {loading ? 'Analyzing…' : 'Analyze with Privacy Copilot'}
        </button>
        <button
          type="button"
          onClick={() => setQ(POLICY_SAMPLE)}
          style={{ background: '#e2e8f0', color: '#1e293b', border: '1px solid #cbd5e1' }}
        >
          Load Policy Sample
        </button>
      </div>

      {r && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
          {/* Compliance Status Banner */}
          <div
            className="card"
            style={{
              background: '#fff5f5',
              borderLeft: '5px solid #ef4444',
              padding: '18px 20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '18px', fontWeight: 700 }}>
                Compliance Status: {r.complianceStatus || '🔴 Non-Compliant (High Risk)'}
              </span>
            </div>
            <p style={{ margin: 0, color: '#4b5563', fontSize: '14px', lineHeight: '1.5' }}>
              {r.summary ||
                'The analyzed policy contains compliance gaps and operational risks under the DPDP Act.'}
            </p>
          </div>

          {/* Evidence-Led Gap Matrix */}
          {r.gapMatrix && r.gapMatrix.length > 0 && (
            <div className="card" style={{ padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '17px', color: '#0f172a' }}>
                📋 Evidence-Led Gap Matrix
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', minWidth: '650px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ width: '32%' }}>Internal Policy Terms</th>
                      <th style={{ width: '28%' }}>DPDP Provision / Section</th>
                      <th style={{ width: '40%' }}>Compliance Status & Gap Analysis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.gapMatrix.map((item, idx) => (
                      <tr key={idx} style={{ verticalAlign: 'top' }}>
                        <td
                          style={{
                            fontStyle: 'italic',
                            color: '#334155',
                            fontSize: '13px',
                            lineHeight: '1.5',
                          }}
                        >
                          {item.policyTerm}
                        </td>
                        <td style={{ fontWeight: 600, color: '#1e293b', fontSize: '13px' }}>
                          {item.dpdpSection}
                        </td>
                        <td style={{ fontSize: '13px', lineHeight: '1.5' }}>
                          {item.gapAnalysis}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recommended Remediation Actions */}
          {r.remediations && r.remediations.length > 0 && (
            <div className="card" style={{ padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '17px', color: '#0f172a' }}>
                🛠️ Recommended Remediation Actions
              </h3>
              <div style={{ display: 'grid', gap: '14px' }}>
                {r.remediations.map((rem, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        color: '#0f172a',
                        fontSize: '14px',
                        marginBottom: '4px',
                      }}
                    >
                      {rem.title}
                    </div>
                    <div style={{ color: '#475569', fontSize: '13px', lineHeight: '1.5' }}>
                      {rem.action}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Citations */}
          {r.citations && r.citations.length > 0 && (
            <div className="callout" style={{ fontSize: '13px', lineHeight: '1.6' }}>
              <strong>Regulatory Citations:</strong>
              <ul style={{ margin: '6px 0 0 0', paddingLeft: '20px' }}>
                {r.citations.map((c, i) => (
                  <li key={i}>
                    <strong>{c.source}</strong> ({c.section}): {c.excerpt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
