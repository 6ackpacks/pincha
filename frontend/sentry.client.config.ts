import * as Sentry from "@sentry/nextjs";

const isDev = process.env.NODE_ENV === "development";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: isDev ? 1.0 : 0.2,
  replaysOnErrorSampleRate: isDev ? 0 : 1.0,
  replaysSessionSampleRate: isDev ? 0 : 0.05,

  integrations: [
    Sentry.browserTracingIntegration({
      instrumentPageLoad: true,
      instrumentNavigation: true,
      enableLongTask: true,
      enableLongAnimationFrame: true,
      enableInp: true,
      enableHTTPTimings: true,
    }),
    ...(!isDev
      ? [Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false })]
      : []),
  ],

  environment: process.env.NODE_ENV,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  debug: false,
  tracePropagationTargets: [/^\/api\//],
});
