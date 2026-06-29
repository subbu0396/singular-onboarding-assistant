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

/**
 * Mock Salesforce lookup. Returns either a found Account or a not-found marker.
 * Real implementation (Track B) will be:
 *
 *   GET /services/data/v60.0/query/?q=SELECT+Name,Industry,...+FROM+Account+WHERE+Name+LIKE+'%{clientName}%'+LIMIT+1
 *   Authorization: Bearer {access_token}
 *
 * with token refresh on 401.
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

  // Case-insensitive partial match — same behavior as a real SOQL LIKE query.
  const normalized = clientName.trim().toLowerCase();
  const hit = Object.entries(MOCK_ACCOUNTS).find(
    ([name]) => name.toLowerCase().includes(normalized) || normalized.includes(name.toLowerCase())
  );

  if (!hit) {
    return {
      found: false,
      reason: `No Salesforce Account matched "${clientName}". Fall back to form data.`,
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
