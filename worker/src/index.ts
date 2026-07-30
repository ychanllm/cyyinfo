import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import adminRoutes from './routes/admin';
import publicRoutes from './routes/public';
import storageRoutes from './routes/storage';

const app = new Hono<{ Bindings: Env }>();

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  // 部署后补充 Pages 域名
];

app.use('*', cors({
  origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]),
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// 安全响应头
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/admin', adminRoutes);
app.route('/api', publicRoutes);
app.route('/uploads', storageRoutes);

export default app;
