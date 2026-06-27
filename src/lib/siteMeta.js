export const SITE_NAME = 'MMP Onboarding Assistant';
export const SITE_DESCRIPTION =
  'AI-powered onboarding document generator for mobile measurement and attribution platforms';
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://singular-onboarding-assistant.vercel.app');
