import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './types';
import adminRoutes from './routes/admin';
import publicRoutes from './routes/public';
import usersRoutes from './routes/users';
import pointsRoutes from './routes/points';
import likesRoutes from './routes/likes';
import adminPrizesRoutes from './routes/adminPrizes';
import storageRoutes from './routes/storage';
import dishesRoutes, { adminDishes } from './routes/dishes';
import storesRoutes, { adminStores } from './routes/stores';

// Hono 实例自带 fetch 方法：Worker（wrangler deploy / miniflare 测试）用 export default，
// Pages Functions 用 hono/cloudflare-pages 的 handle(app)，两种部署形态共用同一份代码
export const app = new Hono<AppEnv>();

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://cyyinfo.pages.dev',
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
app.route('/api/admin', adminPrizesRoutes);
app.route('/api', publicRoutes);
app.route('/api', usersRoutes);
app.route('/api', pointsRoutes);
app.route('/api/likes', likesRoutes);
app.route('/api/dishes', dishesRoutes);
app.route('/api/admin/dishes', adminDishes);
app.route('/api/stores', storesRoutes);
app.route('/api/admin/stores', adminStores);
app.route('/uploads', storageRoutes);

export default app;
