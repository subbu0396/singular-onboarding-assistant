export const runtime = 'edge';

import { cookies } from 'next/headers';
import { ATL_SESSION_COOKIE_NAME } from '@/lib/server/session';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(ATL_SESSION_COOKIE_NAME);

  return Response.json({ ok: true });
}
