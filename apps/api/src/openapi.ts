/** OpenAPI 3.0 description of the OnboardIQ API (served at /api/v1/openapi.json and rendered at /api/docs). */
type Op = { summary: string; roles?: string; body?: string; query?: string[]; multipart?: boolean; responses?: Record<string, string> };

const ops: Record<string, Record<string, Op>> = {
  '/auth/register': { post: { summary: 'Register an applicant account', body: 'Register' } },
  '/auth/login': { post: { summary: 'Log in (returns a JWT)', body: 'Login' } },
  '/auth/me': { get: { summary: 'Current user', roles: 'any' } },
  '/reference/meta': { get: { summary: 'Document types, statuses, reason codes, business date' } },
  '/reference/occupations': { get: { summary: 'Occupation list' } },
  '/health': { get: { summary: 'Health of API, database and AI service' } },
  '/applications/validate': { post: { summary: 'Validate the application form (422 with field names)', roles: 'APPLICANT', body: 'ApplicationInput' } },
  '/applications': {
    post: { summary: 'Submit application + >=3 .txt documents (multipart: form fields, files[], declared_types JSON array)', roles: 'APPLICANT', multipart: true, responses: { '202': 'Accepted, status SUBMITTED', '409': 'PAN already in flight', '413': 'File > 1 MB', '422': 'Validation error' } },
    get: { summary: 'Officer list / search (PAN masked)', roles: 'KYC_OFFICER, COMPLIANCE_OFFICER', query: ['status', 'q', 'from', 'to', 'limit'] },
  },
  '/applications/mine': { get: { summary: "Applicant's own applications (status timeline, plain-language reasons)", roles: 'APPLICANT' } },
  '/applications/{id}': { get: { summary: 'Application detail (applicant view for owners, full view for officers; officer views audited)', roles: 'owner or officer' } },
  '/applications/{id}/decision': { get: { summary: 'Decision API response (Section 6.3)', roles: 'officer' } },
  '/applications/{id}/documents': { post: { summary: 'Upload documents during resubmission (idempotent by SHA-256)', roles: 'APPLICANT (owner)', multipart: true } },
  '/applications/{id}/documents/{docId}': { delete: { summary: 'Remove a document during resubmission', roles: 'APPLICANT (owner)' } },
  '/applications/{id}/resubmit': { post: { summary: 'Resubmit after RESUBMISSION_REQUESTED (within 7 days)', roles: 'APPLICANT (owner)' } },
  '/applications/{id}/corrections': { post: { summary: 'Correct an extracted field with a reason (re-runs the rules)', roles: 'KYC_OFFICER', body: 'FieldCorrection', responses: { '409': 'Concurrent change / wrong status' } } },
  '/applications/{id}/recommendation': { post: { summary: 'Maker recommendation APPROVE / REJECT / REQUEST_RESUBMISSION (comment >= 10 chars)', roles: 'KYC_OFFICER', body: 'Recommendation', responses: { '409': 'Concurrent change' } } },
  '/applications/{id}/checker-decision': { post: { summary: 'Checker decision APPROVE / REJECT / SEND_BACK; maker and checker must differ (403)', roles: 'COMPLIANCE_OFFICER', body: 'CheckerDecision', responses: { '403': 'Same user as maker', '409': 'Concurrent change' } } },
  '/applications/{id}/summary': { get: { summary: 'AI-5 reviewer summary (<= 80 words, labelled, no recommendation)', roles: 'officer' } },
  '/applications/{id}/audit': { get: { summary: 'Full audit history of an application in order', roles: 'COMPLIANCE_OFFICER' } },
  '/applications/{id}/audit.csv': { get: { summary: 'Audit export (CSV, PAN masked)', roles: 'COMPLIANCE_OFFICER' } },
  '/documents/{docId}/text': { get: { summary: 'Document text (audited DOCUMENT_VIEWED)', roles: 'owner or officer' } },
  '/documents/{docId}/extract': { post: { summary: 'FR-3 extraction interface: doc_type + fields with confidence (long format)', roles: 'officer', query: ['provider'] } },
  '/files/{fileKey}': { get: { summary: 'Raw document by non-guessable key (audited)', roles: 'owner or officer' } },
  '/review/queue': { get: { summary: 'IN_REVIEW queue ordered by risk then submission time', roles: 'KYC_OFFICER' } },
  '/checker/queue': { get: { summary: 'PENDING_CHECKER queue', roles: 'COMPLIANCE_OFFICER' } },
  '/dashboard': { get: { summary: 'FR-10 dashboard', roles: 'COMPLIANCE_OFFICER', query: ['from', 'to'] } },
  '/dashboard/ai-feedback': { get: { summary: 'AI-4 officer corrections / correction rate', roles: 'COMPLIANCE_OFFICER' } },
  '/audit': { get: { summary: 'Global audit trail', roles: 'COMPLIANCE_OFFICER', query: ['application_id', 'event_type', 'limit'] } },
  '/admin/config': { get: { summary: 'Active rule configuration', roles: 'COMPLIANCE_OFFICER' }, put: { summary: 'Update rule configuration (new version)', roles: 'COMPLIANCE_OFFICER', body: 'ConfigPatch' } },
  '/admin/config/history': { get: { summary: 'Configuration versions', roles: 'COMPLIANCE_OFFICER' } },
  '/admin/settings': { get: { summary: 'Extraction provider and business date', roles: 'COMPLIANCE_OFFICER' }, put: { summary: 'Switch provider (mock|ai) / business date', roles: 'COMPLIANCE_OFFICER' } },
  '/admin/watchlists': { get: { summary: 'Sanctions and PEP entries', roles: 'COMPLIANCE_OFFICER' }, post: { summary: 'Add / update an entry (optional rescreen)', roles: 'COMPLIANCE_OFFICER' } },
  '/admin/watchlists/{listType}/{entryId}': { delete: { summary: 'Deactivate an entry', roles: 'COMPLIANCE_OFFICER' } },
  '/admin/watchlists/rescreen': { post: { summary: 'Re-screen open cases', roles: 'COMPLIANCE_OFFICER' } },
  '/admin/jobs/expire': { post: { summary: 'Close RESUBMISSION_REQUESTED cases past 7 days (also runs every minute)', roles: 'COMPLIANCE_OFFICER' } },
};

const schemas: Record<string, unknown> = {
  Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
  Register: { type: 'object', required: ['full_name', 'email', 'password'], properties: { full_name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 8 } } },
  ApplicationInput: {
    type: 'object',
    required: ['full_name', 'dob', 'gender', 'pan_number', 'aadhaar_last4', 'mobile', 'email', 'address', 'city', 'state', 'pincode', 'occupation_code', 'annual_income', 'kyc_consent'],
    properties: {
      full_name: { type: 'string' }, dob: { type: 'string', format: 'date' }, gender: { type: 'string', enum: ['M', 'F', 'O'] },
      pan_number: { type: 'string', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' }, aadhaar_last4: { type: 'string', pattern: '^[0-9]{4}$' },
      mobile: { type: 'string', pattern: '^[6-9][0-9]{9}$' }, email: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' },
      state: { type: 'string' }, pincode: { type: 'string', pattern: '^[1-9][0-9]{5}$' }, occupation_code: { type: 'string' },
      annual_income: { type: 'integer' }, kyc_consent: { type: 'boolean', enum: [true] },
    },
  },
  FieldCorrection: { type: 'object', required: ['doc_id', 'field_name', 'new_value', 'reason'], properties: { doc_id: { type: 'string' }, field_name: { type: 'string' }, new_value: { type: 'string' }, reason: { type: 'string' }, expected_version: { type: 'integer' } } },
  Recommendation: { type: 'object', required: ['recommendation', 'comment'], properties: { recommendation: { type: 'string', enum: ['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION'] }, comment: { type: 'string', minLength: 10 }, expected_version: { type: 'integer' } } },
  CheckerDecision: { type: 'object', required: ['decision', 'comment'], properties: { decision: { type: 'string', enum: ['APPROVE', 'REJECT', 'SEND_BACK'] }, comment: { type: 'string', minLength: 10 }, expected_version: { type: 'integer' } } },
  ConfigPatch: { type: 'object', additionalProperties: true, example: { name_match_threshold: 0.85 } },
  Error: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' }, fields: { type: 'object', additionalProperties: { type: 'string' } } } },
};

export function openApiSpec() {
  const paths: Record<string, unknown> = {};
  for (const [p, methods] of Object.entries(ops)) {
    const entry: Record<string, unknown> = {};
    for (const [m, op] of Object.entries(methods)) {
      const params = [
        ...[...p.matchAll(/\{(\w+)\}/g)].map((x) => ({ name: x[1], in: 'path', required: true, schema: { type: 'string' } })),
        ...(op.query ?? []).map((q) => ({ name: q, in: 'query', required: false, schema: { type: 'string' } })),
      ];
      entry[m] = {
        summary: op.summary,
        description: op.roles ? `Roles: ${op.roles}` : 'Public',
        ...(op.roles ? { security: [{ bearerAuth: [] }] } : {}),
        ...(params.length ? { parameters: params } : {}),
        ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${op.body}` } } } } } : {}),
        ...(op.multipart ? { requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } }, declared_types: { type: 'string', example: '["PAN_CARD","AADHAAR_CARD","ELECTRICITY_BILL"]' } } } } } } } : {}),
        responses: {
          '200': { description: 'OK' },
          ...Object.fromEntries(Object.entries(op.responses ?? {}).map(([k, v]) => [k, { description: v, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }])),
          ...(op.roles ? { '401': { description: 'Not authenticated' }, '403': { description: 'Role not allowed' } } : {}),
        },
      };
    }
    paths[p] = entry;
  }
  return {
    openapi: '3.0.3',
    info: { title: 'OnboardIQ API', version: '1.0.0', description: 'KYC onboarding, document verification and watchlist screening with maker-checker. All data synthetic.' },
    servers: [{ url: '/api/v1' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas },
    paths,
  };
}

export const swaggerHtml = `<!doctype html><html><head><meta charset="utf-8"><title>OnboardIQ API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({ url: '/api/v1/openapi.json', dom_id: '#ui' });</script></body></html>`;
