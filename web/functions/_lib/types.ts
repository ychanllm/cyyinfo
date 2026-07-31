export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  JWT_SECRET: string;
  JWT_EXPIRE_HOURS: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
}

export interface AdminPayload {
  sub: number;
  username: string;
  role: 'admin';
}

export interface GuestPayload {
  role: 'guest';
}
