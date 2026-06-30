export const runtime = 'edge';

import { readGoogleSession } from '@/lib/server/session';
import { getEngineeringCalendarId } from '@/lib/server/googleCalendar';

export async function GET(req) {
  const session = await readGoogleSession(req);
  if (!session?.access_token) return Response.json({ connected: false });
  return Response.json({
    connected: true,
    identity: session.identity || null,
    expiresAt: session.expires_at || null,
    engineeringCalendarConfigured: Boolean(getEngineeringCalendarId()),
  });
}
