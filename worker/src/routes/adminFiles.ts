import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { adminAuth } from '../auth';
import { logAudit } from '../audit';
import { parsePagination, searchFilter } from '../pagination';

const MAX_FILE = 100 * 1024 * 1024; // 100MB

interface FileRow {
  id: number;
  filename: string;
  display_name: string;
  note: string;
  size: number;
  content_type: string;
  created_at: string;
}

const files = new Hono<AppEnv>();

files.use('/files', adminAuth);
files.use('/files/*', adminAuth);

// 列表：分页 + display_name/note 模糊搜索，新上传的在前
files.get('/files', async (c) => {
  const { page, size, offset } = parsePagination(c, 20, 100);
  const { where, args } = searchFilter(c, ['display_name', 'note']);
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM files WHERE 1=1${where}`)
    .bind(...args).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT id, filename, display_name, note, size, content_type, created_at
     FROM files WHERE 1=1${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(...args, size, offset).all<FileRow>();
  return c.json({ items: results, total: totalRow?.n ?? 0, page, size });
});

// 上传：任意格式，≤100MB；先写 R2 再落库，R2 失败不产生脏记录
files.post('/files', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ detail: '请选择文件' }, 400);
  if (file.size > MAX_FILE) return c.json({ detail: '文件超过 100MB 限制' }, 400);
  const displayName = file.name || 'unnamed';
  const dot = displayName.lastIndexOf('.');
  const ext = dot > 0 ? displayName.slice(dot).toLowerCase() : '';
  const key = `files/${crypto.randomUUID()}${ext}`;
  // 直接传 File（Blob）：R2 put 支持，避免 arrayBuffer() 二次拷贝撑爆 Workers 内存
  await c.env.FILES.put(key, file,
    file.type ? { httpMetadata: { contentType: file.type } } : undefined);
  const r = await c.env.DB.prepare(
    'INSERT INTO files (filename, display_name, size, content_type) VALUES (?, ?, ?, ?)'
  ).bind(key, displayName, file.size, file.type || '').run();
  await logAudit(c.env.DB, 'file_upload',
    (c.get('admin') as { username: string }).username, `上传文件「${displayName}」`);
  return c.json({ id: r.meta.last_row_id, filename: key });
});

// 下载：鉴权后从 R2 读流，强制 attachment，文件名用可重命名的 display_name
files.get('/files/:id/download', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?')
    .bind(Number(c.req.param('id'))).first<FileRow>();
  if (!row) return c.json({ detail: '文件不存在' }, 404);
  const obj = await c.env.FILES.get(row.filename);
  if (!obj) return c.json({ detail: '文件已丢失' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', row.content_type || 'application/octet-stream');
  headers.set('Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(row.display_name)}`);
  headers.set('Content-Length', String(row.size));
  return new Response(obj.body, { headers });
});

// 编辑：仅改 D1 元数据（R2 key 不变），display_name 去空白后不能为空
files.put('/files/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(id).first();
  if (!row) return c.json({ detail: '文件不存在' }, 404);
  const body = await c.req.json();
  const setParts: string[] = [];
  const params: unknown[] = [];
  if (body.display_name !== undefined) {
    const name = String(body.display_name).trim();
    if (!name) return c.json({ detail: '文件名不能为空' }, 400);
    setParts.push('display_name = ?');
    params.push(name);
  }
  if (body.note !== undefined) {
    setParts.push('note = ?');
    params.push(String(body.note).trim());
  }
  if (!setParts.length) return c.json({ detail: '没有要修改的内容' }, 400);
  params.push(id);
  await c.env.DB.prepare(`UPDATE files SET ${setParts.join(', ')} WHERE id = ?`).bind(...params).run();
  await logAudit(c.env.DB, 'file_update',
    (c.get('admin') as { username: string }).username, `更新文件 #${id}`);
  return c.json({ ok: true });
});

// 删除：R2 对象删除失败只打日志，仍删 D1 记录，避免脏记录阻塞管理操作
files.delete('/files/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<FileRow>();
  if (!row) return c.json({ detail: '文件不存在' }, 404);
  try {
    await c.env.FILES.delete(row.filename);
  } catch (e) {
    console.error('FILES delete failed:', row.filename, e);
  }
  await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  await logAudit(c.env.DB, 'file_delete',
    (c.get('admin') as { username: string }).username, `删除文件「${row.display_name}」`);
  return c.json({ ok: true });
});

export default files;
