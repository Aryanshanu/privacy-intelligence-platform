'use client';

import { useState } from 'react';

type Finding = {
  type: string;
  classification?: string;
  value: string;
  originalValue?: string;
  masked: string;
  start: number;
  end: number;
  confidence: number;
  confidenceTier: 'High' | 'Low' | 'Medium';
  confidenceDetails?: string;
  regulation?: string;
  needsReview: boolean;
  context?: string;
  reason?: string;
};

type ScanData = {
  findings: Finding[];
  highConfidenceFindings: Finding[];
  lowConfidenceFindings: Finding[];
  maskedText: string;
  summary: {
    total: number;
    highConfidenceCount: number;
    lowConfidenceCount: number;
    reviewCount: number;
  };
};

const DEFAULT_SAMPLE =
  'Hey team, I checked the server log for user jdoe_admin. He tried to run the backup script but it timed out. By the way, I updated the master billing sheet. Can you verify if the routing number for the main vendor is 021000021? Also, the fallback corporate card we used for the AWS overages was 4111-2222-3333-4444 with exp 12/29, but it might just be a test number from our sandbox documentation page 499-102-392. Let me know if you need the temporary API token: sk_live_51Nx... or if we should just reset the access key.';

export function DiscoveryScanner() {
  const [text, setText] = useState(DEFAULT_SAMPLE);
  const [result, setResult] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(false);

  async function scan() {
    setLoading(true);
    try {
      const r = await fetch('/api/discovery/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sourceName: 'Manual input' }),
      });
      const json = await r.json();
      if (json?.data) {
        setResult(json.data);
      }
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setLoading(false);
    }
  }

  const highConf =
    result?.highConfidenceFindings || result?.findings.filter((f) => !f.needsReview) || [];
  const lowConf =
    result?.lowConfidenceFindings || result?.findings.filter((f) => f.needsReview) || [];

  return (
    <div className="form" style={{ maxWidth: '960px' }}>
      <textarea
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Content to scan"
        placeholder="Paste logs, emails, code or database excerpts..."
      />

      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={scan} disabled={loading} style={{ flex: 1 }}>
          {loading ? 'Scanning…' : 'Scan for personal data'}
        </button>
        <button
          type="button"
          onClick={() => setText(DEFAULT_SAMPLE)}
          style={{ background: '#e2e8f0', color: '#1e293b', border: '1px solid #cbd5e1' }}
        >
          Load Test Sample
        </button>
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '14px' }}>
          {/* Scan Summary Banner */}
          <div
            className="card"
            style={{
              background: '#f8fafc',
              borderLeft: '5px solid #2563eb',
              padding: '16px 20px',
            }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 'bold' }}>
              Scan Summary
            </h3>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              <span
                style={{
                  background: '#dcfce7',
                  color: '#166534',
                  fontWeight: 600,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              >
                ✓ {highConf.length} High-Confidence Findings (Automatically Masked)
              </span>
              <span
                style={{
                  background: '#fef3c7',
                  color: '#92400e',
                  fontWeight: 600,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              >
                ⚠ {lowConf.length} Low-Confidence Findings (Pending Review)
              </span>
            </div>
          </div>

          {/* 1. High-Confidence Discoveries */}
          {highConf.length > 0 && (
            <div className="card" style={{ padding: '20px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '2px solid #f1f5f9',
                  paddingBottom: '10px',
                  marginBottom: '16px',
                }}
              >
                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>
                  1. High-Confidence Discoveries (Automatically Masked)
                </h3>
                <span className="badge low">Protected / Masked</span>
              </div>

              <div style={{ display: 'grid', gap: '14px' }}>
                {highConf.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '8px',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: '15px', color: '#1e293b' }}>
                        {f.type}
                      </span>
                      <span className="badge low">
                        High Confidence ({Math.round(f.confidence * 100)}%)
                      </span>
                    </div>

                    <div style={{ fontSize: '13px', color: '#334155', lineHeight: '1.7' }}>
                      <div>
                        <strong>Detected Value:</strong>{' '}
                        <code
                          style={{
                            background: '#e0e7ff',
                            color: '#3730a3',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {f.masked}
                        </code>{' '}
                        <span style={{ color: '#64748b' }}>
                          (Original: <code>{f.originalValue || f.value}</code>)
                        </span>
                      </div>
                      {f.confidenceDetails && (
                        <div>
                          <strong>Confidence:</strong> High ({f.confidenceDetails})
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. Low-Confidence Flags */}
          {lowConf.length > 0 && (
            <div className="card" style={{ padding: '20px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '2px solid #f1f5f9',
                  paddingBottom: '10px',
                  marginBottom: '16px',
                }}
              >
                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>
                  2. Low-Confidence Flags (Requires Validation)
                </h3>
                <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                  Pending Review
                </span>
              </div>

              <div style={{ display: 'grid', gap: '14px' }}>
                {lowConf.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '8px',
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '8px',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: '15px', color: '#78350f' }}>
                        {f.type}
                      </span>
                      <span className="badge" style={{ background: '#fde68a', color: '#92400e' }}>
                        Validation Required ({Math.round(f.confidence * 100)}%)
                      </span>
                    </div>

                    <div style={{ fontSize: '13px', color: '#451a03', lineHeight: '1.7' }}>
                      <div>
                        <strong>Flagged Value:</strong>{' '}
                        <code
                          style={{
                            background: '#fef3c7',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {f.value}
                        </code>
                      </div>
                      {f.context && (
                        <div>
                          <strong>Context:</strong>{' '}
                          <em style={{ color: '#57534e' }}>{f.context}</em>
                        </div>
                      )}
                      {f.reason && (
                        <div style={{ marginTop: '4px' }}>
                          <strong>Reason for Flag:</strong> {f.reason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Masked Output Preview */}
          {result.maskedText && (
            <div className="card" style={{ padding: '20px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '15px' }}>
                Masked & Sanitized Payload Preview
              </h3>
              <pre
                style={{
                  background: '#0f172a',
                  color: '#38bdf8',
                  padding: '14px',
                  borderRadius: '8px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  fontFamily: 'monospace',
                }}
              >
                {result.maskedText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
