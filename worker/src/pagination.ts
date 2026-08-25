// 列表分页参数解析:page 从 1 开始,非法值回退默认;size 超限封顶
// requested 表示调用方显式传了 page/size —— 用于"带参分页、不带参保持旧返回结构"的兼容契约
export function parsePagination(
  c: { req: { query: (k: string) => string | undefined } },
  defaultSize: number,
  maxSize: number,
) {
  const pageRaw = c.req.query('page');
  const sizeRaw = c.req.query('size');
  const pageValue = Number(pageRaw);
  const sizeValue = Number(sizeRaw);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const size = Number.isSafeInteger(sizeValue) && sizeValue > 0
    ? Math.min(sizeValue, maxSize)
    : defaultSize;
  return { page, size, offset: (page - 1) * size, requested: pageRaw !== undefined || sizeRaw !== undefined };
}

// 模糊搜索:多列 OR LIKE,%/_/反斜杠转义,配 ESCAPE '\' 防止注入通配符
// 返回以 AND 开头的 WHERE 片段(无 q 时为空串)和绑定参数
export function searchFilter(
  c: { req: { query: (k: string) => string | undefined } },
  columns: string[],
) {
  const q = c.req.query('q')?.trim();
  if (!q) return { where: '', args: [] as string[] };
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const where = ` AND (${columns.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
  return { where, args: columns.map(() => `%${escaped}%`) };
}
