import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { ApiError } from './lib/errors.js';
import { docsPage, openApiDocument } from './openapi.js';
import { adminRouter } from './routes/admin.js';
import { applicationsRouter } from './routes/applications.js';
import { cronRouter } from './routes/cron.js';
import { meRouter } from './routes/me.js';
import { publicRouter } from './routes/public.js';

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);


  app.use(
    '/api/docs',
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
        },
      },
    }),
  );
  app.use(helmet());

  
  app.use(
    cors({
      origin(origin, callback) {
        const allowed =
          !origin || config.allowedOrigins.includes(origin) || (!config.isProduction && LOCAL_ORIGIN.test(origin));
        callback(null, allowed);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Market'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '100kb' }));

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  api.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  api.get('/docs', (_req, res) => {
    res.type('html').send(docsPage);
  });

  api.use('/cron', cronRouter);
  api.use('/admin', adminRouter);
  api.use('/applications', applicationsRouter);
  api.use('/me', meRouter);
  api.use('/', publicRouter);

  app.use('/api', api);

  app.use((_req, _res, next) => {
    next(new ApiError(404, 'not_found', 'There is nothing at this address.'));
  });


  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) });
      return;
    }

    const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
    if (status === 400 || status === 413) {
      res.status(status).json({
        error: status === 413 ? 'body_too_large' : 'invalid_json',
        message: status === 413 ? 'The request is too large.' : 'The request body is not valid JSON.',
      });
      return;
    }

    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side.' });
  });

  return app;
}
