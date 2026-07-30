const WORKER = 'https://cyyinfo-api.<你的子域>.workers.dev'; // 部署任务时替换为真实域名

export const onRequest: PagesFunction = async ({ request, params }) => {
  const url = new URL(request.url);
  const path = (params.path as string[]).join('/');
  const prefix = url.pathname.startsWith('/api') ? '/api' : '/uploads';
  const target = `${WORKER}${prefix}/${path}${url.search}`;
  return fetch(new Request(target, request));
};
