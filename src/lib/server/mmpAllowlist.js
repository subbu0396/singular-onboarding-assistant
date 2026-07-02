// MMP / martech domain → platform allowlist.
//
// The app is meant for SEs across the mobile-measurement / engagement /
// analytics ecosystem, not any one vendor. When a Google sign-in comes back,
// we look at the email's domain to (a) decide whether to admit them at all
// and (b) tag their profile with which platform they work for.
//
// Add domains here to onboard more SEs. Keep the mapping curated — a domain
// entry here is an implicit statement that people at that domain should have
// access to this tool.

export const MMP_DOMAIN_ALLOWLIST = {
  // Attribution / MMP
  'singular.net': 'Singular',
  'appsflyer.com': 'AppsFlyer',
  'adjust.com': 'Adjust',
  'branch.io': 'Branch',
  'kochava.com': 'Kochava',
  'tenjin.io': 'Tenjin',
  'airbridge.io': 'Airbridge',
  'rockerbox.com': 'Rockerbox',

  // Engagement / marketing automation
  'clevertap.com': 'CleverTap',
  'moengage.com': 'MoEngage',
  'webengage.com': 'WebEngage',
  'braze.com': 'Braze',
  'iterable.com': 'Iterable',
  'netcorecloud.com': 'Netcore Smartech',
  'netcore.co.in': 'Netcore Smartech',

  // Analytics
  'amplitude.com': 'Amplitude',
  'mixpanel.com': 'Mixpanel',

  // AdTech / retargeting
  'criteo.com': 'Criteo',

  // CDP / data infrastructure
  'mparticle.com': 'mParticle',
  'segment.com': 'Segment',
  'twilio.com': 'Segment',
};

/**
 * Look up the MMP platform for a given email. Returns null if the email's
 * domain isn't on the allowlist — the caller should refuse the sign-in.
 */
export function mmpForEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  return MMP_DOMAIN_ALLOWLIST[domain] || null;
}

export function isAllowedEmail(email) {
  return mmpForEmail(email) !== null;
}
