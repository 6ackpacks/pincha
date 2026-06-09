import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.2,
  environment: process.env.NODE_ENV,
  enabled: !!process.env.SENTRY_DSN,
});
