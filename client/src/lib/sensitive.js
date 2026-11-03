// Spots files whose NAME suggests sensitive content. Only the name is looked at;
// file contents are never read. Each hit carries a weight; the sum is the score.

const RULES = [
  // identity & government
  [/\b(passport|driver'?s?\s*licen[cs]e|licen[cs]e\b|national\s*id|aadha?ar|pan\s*card|ssn|social\s*security|birth\s*cert|visa\b|green\s*card)/i, 'identity', 3],
  // money
  [/\b(payroll|salar(y|ies)|payslip|pay\s*slip|bank\s*(statement|details)|iban|swift|routing|credit\s*card|debit\s*card|tax(es)?\b|tfn|w-?2\b|1099|gst\b|invoice|budget|p&l|profit\s*(and|&)\s*loss|balance\s*sheet|financial)/i, 'financial', 2],
  // secrets
  [/\b(password|passwd|pwd|secret|api[\s_-]?key|token|credential|\.env\b|private[\s_-]?key|\.pem\b|\.p12\b|\.pfx\b|keystore|2fa|backup\s*codes?|recovery\s*codes?|wifi|door\s*code)/i, 'credentials', 4],
  // legal & HR
  [/\b(contract|agreement|nda\b|non-?disclosure|termination|resignation|offer\s*letter|performance\s*review|disciplinary|grievance|lawsuit|settlement|will\b|power\s*of\s*attorney)/i, 'legal/HR', 2],
  // health
  [/\b(medical|health|diagnos|prescription|lab\s*results?|insurance|clinic|hospital|therapy|vaccin)/i, 'medical', 2],
  // explicit markers
  [/\b(confidential|private|internal\s*only|do\s*not\s*(share|distribute)|restricted|secret|sensitive)/i, 'marked confidential', 3],
  // customer / personal data
  [/\b(customers?|clients?|members?|users?|subscribers?|patients?|students?|employees?|staff|contacts?)\s*(list|data|database|db|export|records?)|\bcrm\b|mailing\s*list|phone\s*numbers?|addresses|dob\b/i, 'personal data', 2],
  // source & infra
  [/\b(kubeconfig|terraform|\.tfstate|docker-?compose|id_rsa|authorized_keys|config\.(json|ya?ml)|database\s*dump|\.sql\b|\.bak\b)/i, 'infrastructure', 3],
]

export function sensitivity(name) {
  if (!name) return { score: 0, hits: [] }
  const hits = []
  let score = 0
  for (const [re, label, weight] of RULES) {
    if (re.test(name)) { hits.push(label); score += weight }
  }
  return { score, hits }
}

export const SENSITIVE_THRESHOLD = 2
