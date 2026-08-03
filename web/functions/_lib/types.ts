export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  JWT_SECRET: string;
  JWT_EXPIRE_HOURS: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  REMINDER_TOKEN: string; // GitHub Actions 定时触发 /api/reminders/check 用的 token
}

export interface AdminPayload {
  sub: number;
  username: string;
  role: 'admin';
}

export interface GuestPayload {
  role: 'guest';
}
