import '@/styles/globals.css';
import Head from 'next/head';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Singular Onboarding Assistant</title>
        <meta name="description" content="AI-powered onboarding document generator for Singular integrations" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>S</text></svg>" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
