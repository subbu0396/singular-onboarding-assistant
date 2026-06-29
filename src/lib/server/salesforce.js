// Salesforce client for Skill 1 (Client Info).
//
// Phase 2 Track A: returns mock Account data for a small set of demo clients,
// "not found" for everything else. The shape of the returned object IS the
// contract Track B will fulfill against the real Salesforce REST API.
//
// Default field mapping (Track B will read these from Salesforce.Account):
//   Standard fields:
//     - Name              → clientName
//     - Industry          → industry (translated via INDUSTRY_MAP below)
//     - BillingCountry    → primaryMarket (translated via COUNTRY_TO_MARKET)
//     - AnnualRevenue     → informational, not surfaced to the form
//
//   Custom fields (you create these in your SF org, or rename to match
//   whatever your existing custom fields are called):
//     - Platforms__c              (multipicklist) → platforms
//     - Current_MMP__c            (picklist)      → currentMmp
//     - Attribution_Model__c      (picklist)      → attributionModel
//     - Target_Go_Live__c         (date)          → targetGoLiveDate
//     - Account_Tier__c           (picklist)      → informational
//
// If your org uses different custom field names, change the field names in
// the mock objects below — Track B's real-API code will read whatever names
// the mock defines.

const MOCK_ACCOUNTS = {
  'Airtel Digital': {
    Name: 'Airtel Digital',
    Industry: 'Telecommunications',
    BillingCountry: 'India',
    AnnualRevenue: 5_000_000_000,
    Platforms__c: 'iOS;Android',
    Current_MMP__c: 'AppsFlyer',
    Attribution_Model__c: 'Multi-Touch',
    Target_Go_Live__c: '2026-08-15',
    Account_Tier__c: 'Enterprise',
  },
  'Acme Gaming': {
    Name: 'Acme Gaming',
    Industry: 'Gaming',
    BillingCountry: 'United States',
    Platforms__c: 'iOS;Android;Unity',
    Current_MMP__c: 'Adjust',
    Attribution_Model__c: 'Last Touch',
    Target_Go_Live__c: '2026-07-30',
    Account_Tier__c: 'Mid-Market',
  },
  'Flipkart Shopping': {
    Name: 'Flipkart Shopping',
    Industry: 'E-commerce',
    BillingCountry: 'India',
    AnnualRevenue: 2_000_000_000,
    Platforms__c: 'iOS;Android;React Native',
    Current_MMP__c: 'Branch',
    Attribution_Model__c: 'Data Driven',
    Target_Go_Live__c: '2026-09-01',
    Account_Tier__c: 'Enterprise',
  },
};

const MIN_QUERY_LENGTH = 3;

function normalizeName(value) {
  // Trim, lowercase, collapse internal whitespace to a single space.
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Mock Salesforce lookup. Returns either a found Account or a not-found marker.
 * Real implementation (Track B) will be:
 *
 *   GET /services/data/v60.0/query/?q=SELECT+Name,Industry,...+FROM+Account+WHERE+Name='{clientName}'+LIMIT+1
 *   Authorization: Bearer {access_token}
 *
 * with token refresh on 401. Strict equality (not LIKE) — the SE is expected
 * to enter the canonical Account name. Fuzzy matching belongs in a separate
 * "pick from a search" UI, not in the lookup tool.
 */
export async function lookupSalesforceClient({ clientName }) {
  // Simulate network latency so the UI tool-call indicator is visible.
  await new Promise((r) => setTimeout(r, 400));

  if (!clientName || typeof clientName !== 'string') {
    return {
      found: false,
      reason: 'No client name provided',
      _source: 'salesforce_mock',
    };
  }

  const normalizedInput = normalizeName(clientName);

  if (normalizedInput.length < MIN_QUERY_LENGTH) {
    return {
      found: false,
      reason: `Client name "${clientName}" is too short for a Salesforce lookup (minimum ${MIN_QUERY_LENGTH} characters). Fall back to form data.`,
      _source: 'salesforce_mock',
    };
  }

  // Strict case-insensitive equality on the normalized name.
  const hit = Object.entries(MOCK_ACCOUNTS).find(
    ([name]) => normalizeName(name) === normalizedInput
  );

  if (!hit) {
    return {
      found: false,
      reason: `No Salesforce Account exactly matched "${clientName}". Fall back to form data.`,
      _source: 'salesforce_mock',
    };
  }

  return {
    found: true,
    account: hit[1],
    _source: 'salesforce_mock',
  };
}

export function isSalesforceConfigured() {
  // Phase 2 Track A: always available (mock). Track B will check for an
  // active OAuth token bound to the requesting SE.
  return true;
}

// --- Phase 2 Track B: real Salesforce REST lookup ---
//
// Used when the SE has connected their Salesforce account via OAuth. The
// session shape comes from src/lib/server/session.js:
//   { access_token, refresh_token, instance_url, issued_at, identity? }

const SF_API_VERSION = 'v60.0';
const DEFAULT_LOGIN_HOST = 'https://login.salesforce.com';

// Standard fields only — these exist in every Salesforce dev org out of the
// box. To pull richer data, your org needs custom fields like Platforms__c,
// Current_MMP__c, etc., and you'd add them to the SELECT list below.
const ACCOUNT_FIELDS = [
  'Id',
  'Name',
  'Industry',
  'BillingCountry',
  'BillingState',
  'Website',
  'AnnualRevenue',
];

function escapeSoql(value) {
  // SOQL strings escape single quote and backslash.
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const loginHost = process.env.SALESFORCE_LOGIN_HOST || DEFAULT_LOGIN_HOST;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('refresh_token', refreshToken);

  const res = await fetch(`${loginHost}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('SF token refresh failed', res.status, body);
    return null;
  }

  return await res.json();
}

async function querySalesforceAccount(accessToken, instanceUrl, clientName) {
  const soql = `SELECT ${ACCOUNT_FIELDS.join(', ')} FROM Account WHERE Name = '${escapeSoql(clientName)}' LIMIT 1`;
  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query/?q=${encodeURIComponent(soql)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return { res, soql };
}

/**
 * Real Salesforce Account lookup. Strict case-insensitive equality on Name —
 * matches the mock's behavior so the agent's expectations don't change when
 * we swap from Track A to Track B.
 *
 * Behavior on missing/expired session: returns { found: false, reason } so
 * the agent falls back to use_form_data. Token refresh is attempted once on
 * a 401.
 *
 * Returns the same shape as lookupSalesforceClient (the mock):
 *   { found, account?, reason?, _source }
 *
 * Plus optionally { _refreshed_session } when the access token was refreshed
 * — the route handler uses this to update the cookie.
 */
export async function lookupSalesforceClientReal(
  { clientName },
  session
) {
  if (!session?.access_token || !session?.instance_url) {
    return {
      found: false,
      reason: 'Salesforce is not connected. Fall back to form data.',
      _source: 'salesforce_real',
    };
  }

  if (!clientName || typeof clientName !== 'string') {
    return {
      found: false,
      reason: 'No client name provided',
      _source: 'salesforce_real',
    };
  }

  const normalizedInput = clientName.trim();
  if (normalizedInput.length < MIN_QUERY_LENGTH) {
    return {
      found: false,
      reason: `Client name "${clientName}" is too short for a Salesforce lookup (minimum ${MIN_QUERY_LENGTH} characters). Fall back to form data.`,
      _source: 'salesforce_real',
    };
  }

  let { res } = await querySalesforceAccount(
    session.access_token,
    session.instance_url,
    normalizedInput
  );

  let refreshedSession = null;

  if (res.status === 401 && session.refresh_token) {
    const refreshed = await refreshAccessToken(session.refresh_token);
    if (refreshed?.access_token) {
      refreshedSession = {
        ...session,
        access_token: refreshed.access_token,
        instance_url: refreshed.instance_url || session.instance_url,
        issued_at: Number(refreshed.issued_at) || Date.now(),
      };
      ({ res } = await querySalesforceAccount(
        refreshedSession.access_token,
        refreshedSession.instance_url,
        normalizedInput
      ));
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Salesforce query failed', res.status, body);
    return {
      found: false,
      reason: `Salesforce query failed (${res.status}). Fall back to form data.`,
      _source: 'salesforce_real',
      ...(refreshedSession ? { _refreshed_session: refreshedSession } : {}),
    };
  }

  const data = await res.json();
  if (!data.records || data.records.length === 0) {
    return {
      found: false,
      reason: `No Salesforce Account exactly matched "${clientName}". Fall back to form data.`,
      _source: 'salesforce_real',
      ...(refreshedSession ? { _refreshed_session: refreshedSession } : {}),
    };
  }

  // Strip the "attributes" envelope Salesforce adds to every record.
  const { attributes, ...account } = data.records[0];

  return {
    found: true,
    account,
    _source: 'salesforce_real',
    ...(refreshedSession ? { _refreshed_session: refreshedSession } : {}),
  };
}
