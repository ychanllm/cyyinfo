export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  JWT_SECRET: string;
  JWT_EXPIRE_HOURS: string;
  LOGIN_RATE_LIMITER?: RateLimit;
  REGISTER_RATE_LIMITER?: RateLimit;
  PASSCODE_RATE_LIMITER?: RateLimit;
  MESSAGE_RATE_LIMITER?: RateLimit;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
}

export interface Variables {
  admin: { id: number; username: string };
  user: { id: number; username: string };
  liker: { id: number; username: string };
}

export type AppEnv = { Bindings: Env; Variables: Variables };

export interface AdminPayload {
  sub: number;
  username: string;
  role: 'admin';
}

export interface GuestPayload {
  role: 'guest';
}

export interface UserPayload {
  sub: number;
  username: string;
  role: 'user';
}
