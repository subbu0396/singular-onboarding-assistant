import { createClient } from '@supabase/supabase-js';
import { VoyageAIClient } from 'voyageai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function embed(text) {
  const voyage = new VoyageAIClient({
    apiKey: process.env.VOYAGE_API_KEY,
  });

  const response = await voyage.embed({
    input: [text],
    model: 'voyage-3-lite',
  });

  return response.data[0].embedding;
}

const patterns = [
  {
    platform: 'Generic',
    category: 'S2S Postbacks',
    title: 'S2S postback URL structure and required parameters',
    content: `S2S postback URLs must include: click_id (attribution token from ad network), event_name (must match configured event in dashboard), revenue (for purchase events, in advertiser currency), currency (ISO 4217), and timestamp (Unix epoch). Common failure: sending revenue without currency causes postback rejection. Test with a curl POST before SDK goes live. Retry logic: implement exponential backoff with max 3 retries on 5xx responses. 2xx on postback endpoint does not confirm attribution — check dashboard event log for confirmation.`,
  },
  {
    platform: 'Generic',
    category: 'OAuth 2.0',
    title: 'OAuth 2.0 integration checklist and common failures',
    content: `OAuth 2.0 setup requires: client_id and client_secret stored server-side only (never in mobile app binary), redirect_uri must exactly match registered URI including trailing slash, scope must include all required permissions upfront. Common failures: token expiry not handled (implement refresh token rotation), redirect_uri mismatch (case-sensitive), PKCE required for mobile apps (RFC 7636). Test with: authorization code flow first, then verify refresh works independently. Token storage: use secure keychain on iOS, EncryptedSharedPreferences on Android.`,
  },
  {
    platform: 'Generic',
    category: 'SDK Init',
    title: 'iOS SDK initialization sequence and common issues',
    content: `iOS SDK must be initialized in AppDelegate.application didFinishLaunchingWithOptions before any other SDK calls. Do not initialize in viewDidLoad — attribution data will be missed for cold starts. Required: API key, app bundle ID. Optional but recommended: customUserId set before first event for cross-device attribution. SKAdNetwork: register SKAdNetworkItems in Info.plist for all ad network partners before submission. ATT prompt must be shown before any IDFA access — implement ATTrackingManager.requestTracking in a contextual moment, not on app launch.`,
  },
  {
    platform: 'Generic',
    category: 'SDK Init',
    title: 'Android SDK initialization and ProGuard rules',
    content: `Android SDK initialized in Application.onCreate(), not in Activity. Add ProGuard/R8 rules to prevent SDK class stripping in release builds — missing ProGuard rules is the most common cause of attribution working in debug but failing in production. Required permissions: INTERNET, ACCESS_NETWORK_STATE. For installs via Google Play: referrer attribution requires INSTALL_REFERRER broadcast receiver registration in AndroidManifest. Test install attribution using ADB with: adb shell am broadcast -a com.android.vending.INSTALL_REFERRER.`,
  },
  {
    platform: 'Snowflake',
    category: 'Data Export',
    title: 'Snowflake connector setup and schema conventions',
    content: `Snowflake data export requires: dedicated service account with USAGE on database, USAGE on schema, SELECT on all tables. Do not use ACCOUNTADMIN role in production. Warehouse sizing: start with X-SMALL for daily batch, scale to SMALL for hourly. Auto-suspend: set to 60 seconds to avoid idle compute cost. Schema convention: raw events in RAW schema, transformed in ANALYTICS. Common issue: timestamp columns arrive as VARCHAR in some connectors — cast to TIMESTAMP_NTZ in transformation layer. Partition by event_date for query performance on large tables.`,
  },
  {
    platform: 'BigQuery',
    category: 'Data Export',
    title: 'BigQuery dataset configuration and streaming inserts',
    content: `BigQuery setup requires service account JSON key with roles: BigQuery Data Editor, BigQuery Job User. Store key in Secret Manager, not in environment variables for production. Dataset location: choose region matching your data residency requirements — cannot change after creation. Streaming inserts vs batch load: streaming has 0 latency but costs more and has 1-hour eventual consistency window. Batch load via GCS is cheaper and strongly consistent — preferred for attribution data. Partition table by _PARTITIONTIME for cost control. Clustering on event_name and platform reduces scan cost by 60-80%.`,
  },
  {
    platform: 'Generic',
    category: 'Attribution',
    title: 'Attribution discrepancy root causes and resolution steps',
    content: `Attribution discrepancies between MMP and ad network fall into four categories:
1. Time zone mismatch — confirm both systems use UTC or same offset
2. Click lookback window mismatch — MMP default 7 days, network may report 30 days
3. View-through attribution — disable on MMP side if network counts VTA but MMP does not
4. Reattribution window — organic re-engagements counted as paid by network
Resolution sequence: export raw click logs from both sides, join on click_id, identify unmatched rows, classify discrepancy type. Acceptable discrepancy threshold: under 5% is normal, 5-15% needs investigation, over 15% indicates systematic issue.`,
  },
  {
    platform: 'Generic',
    category: 'Webhook Setup',
    title: 'Webhook reliability patterns and deduplication',
    content: `Production webhooks require: HTTPS endpoint only, response within 5 seconds (offload processing to queue), return 200 immediately and process async. Deduplication: store event_id in Redis or DB with TTL of 24 hours, reject duplicate event_ids before processing. Retry handling: implement idempotent processing — retried webhooks must produce the same result as first delivery. Signature verification: validate HMAC-SHA256 signature header on every request before processing payload. Circuit breaker: if endpoint returns 5xx for 10 consecutive requests, pause delivery and alert client team.`,
  },
  {
    platform: 'Generic',
    category: 'Testing',
    title: 'End-to-end attribution testing sequence',
    content: `Pre-launch testing sequence:
1. SDK init test: confirm SDK initializes without crash, check device appears in dashboard within 60 seconds
2. Organic install test: fresh install with no click — confirm attributed as organic in dashboard
3. Click-to-install test: click test tracking link, install app, open — confirm attributed to correct campaign within 5 minutes
4. Event test: trigger each mapped event, confirm name, parameters, and revenue appear correctly in dashboard
5. Postback test: confirm postback received by ad network test endpoint (use webhook.site for initial validation)
6. Re-engagement test: click deep link on existing install — confirm re-engagement event fires and is attributed correctly
7. Uninstall test (optional): uninstall app, confirm uninstall event appears in dashboard within 24 hours`,
  },
  {
    platform: 'React Native',
    category: 'SDK Init',
    title: 'React Native SDK integration patterns and bridge issues',
    content: `React Native SDK integration requires native modules on both iOS and Android — pure JS implementation not available for most attribution SDKs. Run pod install after adding iOS native module. Common issue: Metro bundler caches stale native module — run react-native start --reset-cache after any native change. For Expo: use bare workflow, not managed workflow, for attribution SDK support. Deep linking: configure both iOS Universal Links (apple-app-site-association) and Android App Links (assetlinks.json) for deferred deep link attribution to work. Test on physical device — iOS Simulator does not support IDFA and will always return zeros for device ID.`,
  },
];

async function seed() {
  console.log(`Seeding ${patterns.length} patterns...`);

  for (const pattern of patterns) {
    const textToEmbed = `${pattern.platform} ${pattern.category} ${pattern.title} ${pattern.content}`;

    const embedding = await embed(textToEmbed);

    const { error } = await supabase.from('integration_patterns').insert({
      platform: pattern.platform,
      category: pattern.category,
      title: pattern.title,
      content: pattern.content,
      embedding,
    });

    if (error) {
      console.error(`Failed to insert: ${pattern.title}`, error);
    } else {
      console.log(`✓ ${pattern.title}`);
    }

    await new Promise((r) => setTimeout(r, 21000));
  }

  console.log('Seeding complete.');
}

seed().catch(console.error);
