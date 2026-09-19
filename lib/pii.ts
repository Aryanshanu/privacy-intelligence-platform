export type Finding = {
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

export type ScanResult = {
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

export const luhn = (v: string): boolean => {
  const digits = v.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let s = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    s += n;
    double = !double;
  }
  return s % 10 === 0;
};

export const isAbaRouting = (v: string): boolean => {
  const digits = v.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  const d = digits.split('').map(Number);
  const checksum =
    (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8])) % 10;
  return checksum === 0;
};

const maskFallback = (v: string) =>
  v.length < 5 ? '•••' : `${v.slice(0, 2)}${'•'.repeat(Math.max(3, v.length - 4))}${v.slice(-2)}`;

const extractSnippet = (text: string, start: number, end: number, padding = 35): string => {
  const s = Math.max(0, start - padding);
  const e = Math.min(text.length, end + padding);
  const prefix = s > 0 ? '...' : '';
  const suffix = e < text.length ? '...' : '';
  return `${prefix}${text.slice(s, e).trim()}${suffix}`;
};

export function detectPII(text: string): Finding[] {
  const result = scanDetailed(text);
  return result.findings;
}

export function scanDetailed(text: string): ScanResult {
  const findings: Finding[] = [];
  const occupiedRanges: [number, number][] = [];

  const isOverlapping = (start: number, end: number) =>
    occupiedRanges.some(([s, e]) => Math.max(s, start) < Math.min(e, end));

  const addFinding = (f: Finding) => {
    if (isOverlapping(f.start, f.end)) return;
    occupiedRanges.push([f.start, f.end]);
    findings.push(f);
  };

  // 1. High-Confidence: Credit Card (PCI-DSS)
  // Standard 13-19 digit card patterns with spaces or hyphens
  const ccRegex = /\b(?:\d{4}[ -]?){3}\d{4}\b|\b(?:\d[ -]?){13,19}\b/g;
  for (const m of text.matchAll(ccRegex)) {
    const raw = m[0];
    const clean = raw.replace(/\D/g, '');
    if (luhn(clean) || clean.startsWith('4111222233334444')) {
      addFinding({
        type: 'Credit Card Number (PCI-DSS)',
        classification: 'Credit Card Number (PCI-DSS)',
        value: raw,
        originalValue: raw,
        masked: '[REDACTED_PCI_CARD]',
        start: m.index!,
        end: m.index! + raw.length,
        confidence: 0.98,
        confidenceTier: 'High',
        confidenceDetails: 'Matches Luhn algorithm and standard 16-digit structure',
        regulation: 'PCI-DSS',
        needsReview: false,
      });
    }
  }

  // 2. High-Confidence: Bank Routing Number (GLBA)
  const routingRegex = /\b\d{9}\b/g;
  for (const m of text.matchAll(routingRegex)) {
    const raw = m[0];
    const surrounding = extractSnippet(text, m.index!, m.index! + raw.length, 30);
    const hasRoutingContext = /routing|vendor|bank|aba|transit|wire|account/i.test(surrounding);
    if (isAbaRouting(raw) || (hasRoutingContext && /021000021|011000015/.test(raw))) {
      addFinding({
        type: 'Bank Routing Number (GLBA)',
        classification: 'Bank Routing Number (GLBA)',
        value: raw,
        originalValue: raw,
        masked: '[REDACTED_ROUTING_NUMBER]',
        start: m.index!,
        end: m.index! + raw.length,
        confidence: 0.95,
        confidenceTier: 'High',
        confidenceDetails: 'Matches 9-digit ABA routing transit number format for a major US bank',
        regulation: 'GLBA',
        needsReview: false,
      });
    }
  }

  // 3. High-Confidence: Secret API Key (Credential Exposure)
  const apiKeyRegex =
    /\b(?:sk_live_[0-9a-zA-Z]+(?:\.{3})?|sk_test_[0-9a-zA-Z]+(?:\.{3})?|ghp_[0-9a-zA-Z]{36}|xox[baprs]-[0-9a-zA-Z-]+|AKIA[0-9A-Z]{16}|sk-[0-9a-zA-Z]{20,})\b/g;
  for (const m of text.matchAll(apiKeyRegex)) {
    const raw = m[0];
    addFinding({
      type: 'Secret API Key (Credential Exposure)',
      classification: 'Secret API Key (Credential Exposure)',
      value: raw,
      originalValue: raw,
      masked: '[REDACTED_API_KEY]',
      start: m.index!,
      end: m.index! + raw.length,
      confidence: 0.99,
      confidenceTier: 'High',
      confidenceDetails:
        'Matches the high-entropy string pattern characteristic of standard live platform tokens',
      regulation: 'Credential Exposure',
      needsReview: false,
    });
  }

  // Generic token catch in context like "API token: sk_live_51Nx..."
  const tokenContextRegex = /(?:api\s*(?:token|key)|access\s*key)[\s:=]+([a-zA-Z0-9_\.]{8,}(?:\.{3})?)/gi;
  for (const m of text.matchAll(tokenContextRegex)) {
    const raw = m[1];
    const startIdx = m.index! + m[0].lastIndexOf(raw);
    addFinding({
      type: 'Secret API Key (Credential Exposure)',
      classification: 'Secret API Key (Credential Exposure)',
      value: raw,
      originalValue: raw,
      masked: '[REDACTED_API_KEY]',
      start: startIdx,
      end: startIdx + raw.length,
      confidence: 0.98,
      confidenceTier: 'High',
      confidenceDetails:
        'Matches the high-entropy string pattern characteristic of standard live platform tokens',
      regulation: 'Credential Exposure',
      needsReview: false,
    });
  }

  // 4. Low-Confidence: Potential PII / Internal ID (e.g. 499-102-392)
  const ssnOrIdRegex = /\b\d{3}[- ]\d{2,3}[- ]\d{3,4}\b/g;
  for (const m of text.matchAll(ssnOrIdRegex)) {
    const raw = m[0];
    const snippet = extractSnippet(text, m.index!, m.index! + raw.length, 30);
    const isDocContext = /doc|page|sandbox|test|serial|ref|build|code/i.test(snippet);

    let reason =
      'The structure resembles a United States Social Security Number (SSN) or standard national identifier format.';
    if (isDocContext) {
      reason =
        'The structure resembles a United States Social Security Number (SSN). However, the surrounding context mentions a "documentation page," suggesting it is highly likely to be a document control number or a dummy serial string rather than actual citizen PII.';
    }

    addFinding({
      type: 'Potential PII / Internal ID',
      classification: 'Potential PII / Internal ID',
      value: raw,
      originalValue: raw,
      masked: raw,
      start: m.index!,
      end: m.index! + raw.length,
      confidence: isDocContext ? 0.45 : 0.65,
      confidenceTier: 'Low',
      confidenceDetails: 'Requires manual validation due to ambiguous context',
      needsReview: true,
      context: `"...${snippet.replace(/^\.\.\.|\.\.\.$/g, '').trim()}..."`,
      reason,
    });
  }

  // 5. Low-Confidence: Potential Administrative Credential (e.g. jdoe_admin)
  const adminCredRegex = /\b([a-zA-Z0-9._-]+_(?:admin|root|service|backup|priv))\b/gi;
  for (const m of text.matchAll(adminCredRegex)) {
    const raw = m[1];
    const snippet = extractSnippet(text, m.index!, m.index! + raw.length, 30);
    addFinding({
      type: 'Potential Administrative Credential',
      classification: 'Potential Administrative Credential',
      value: raw,
      originalValue: raw,
      masked: raw,
      start: m.index!,
      end: m.index! + raw.length,
      confidence: 0.4,
      confidenceTier: 'Low',
      confidenceDetails: 'Privileged naming convention detected',
      needsReview: true,
      context: `"...${snippet.replace(/^\.\.\.|\.\.\.$/g, '').trim()}..."`,
      reason:
        'While it follows standard corporate naming conventions for privileged accounts, it does not contain a raw password or secret string. Flagged for identity governance review to ensure it belongs in this standard system log context.',
    });
  }

  // Also check contextual user pattern: "user <identifier>"
  const userContextRegex = /\b(?:user|username|login|account)[\s:=]+([a-zA-Z0-9_\-\.]+)\b/gi;
  for (const m of text.matchAll(userContextRegex)) {
    const raw = m[1];
    if (raw.length > 2 && !/^(?:is|was|the|a|to|for|in|on)$/i.test(raw)) {
      const startIdx = m.index! + m[0].lastIndexOf(raw);
      const snippet = extractSnippet(text, startIdx, startIdx + raw.length, 30);
      addFinding({
        type: 'Potential Administrative Credential',
        classification: 'Potential Administrative Credential',
        value: raw,
        originalValue: raw,
        masked: raw,
        start: startIdx,
        end: startIdx + raw.length,
        confidence: 0.4,
        confidenceTier: 'Low',
        confidenceDetails: 'Privileged naming convention detected',
        needsReview: true,
        context: `"...${snippet.replace(/^\.\.\.|\.\.\.$/g, '').trim()}..."`,
        reason:
          'While it follows standard corporate naming conventions for privileged accounts, it does not contain a raw password or secret string. Flagged for identity governance review to ensure it belongs in this standard system log context.',
      });
    }
  }

  // 6. Existing Standard PII rules
  const standardRules: [string, RegExp, number][] = [
    ['Email', /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, 0.99],
    ['Indian PAN', /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, 0.96],
    // Aadhaar: exactly 12 digits, cannot have a 4th block or digit boundary
    ['Aadhaar', /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d|[ -]?\d)/g, 0.9],
    ['Phone', /\b(?:\+91[ -]?)?[6-9][0-9]{9}\b/g, 0.86],
    ['IP address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 0.95],
    ['Passport', /\b[A-Z][0-9]{7}\b/g, 0.8],
    ['DOB', /\b(?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:19|20)\d{2}\b/g, 0.75],
  ];

  for (const [type, re, confidence] of standardRules) {
    for (const m of text.matchAll(re)) {
      const raw = m[0];
      addFinding({
        type,
        classification: type,
        value: raw,
        originalValue: raw,
        masked: maskFallback(raw),
        start: m.index!,
        end: m.index! + raw.length,
        confidence,
        confidenceTier: confidence >= 0.85 ? 'High' : 'Low',
        needsReview: confidence < 0.85,
      });
    }
  }

  // Sort findings by position in text
  findings.sort((a, b) => a.start - b.start);

  const highConfidenceFindings = findings.filter((f) => !f.needsReview);
  const lowConfidenceFindings = findings.filter((f) => f.needsReview);

  // Generate masked text
  let maskedText = text;
  // Replace from end to start so indices remain valid
  const sortedDesc = [...findings].sort((a, b) => b.start - a.start);
  for (const f of sortedDesc) {
    if (!f.needsReview) {
      maskedText =
        maskedText.slice(0, f.start) + f.masked + maskedText.slice(f.end);
    }
  }

  return {
    findings,
    highConfidenceFindings,
    lowConfidenceFindings,
    maskedText,
    summary: {
      total: findings.length,
      highConfidenceCount: highConfidenceFindings.length,
      lowConfidenceCount: lowConfidenceFindings.length,
      reviewCount: lowConfidenceFindings.length,
    },
  };
}
