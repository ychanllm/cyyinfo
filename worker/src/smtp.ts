// 极简 SMTP 客户端（通过 cloudflare:sockets 的 TCP 连接实现）。
// 用于发送 QQ 邮箱邮件：smtp.qq.com:465 + 隐式 TLS + AUTH LOGIN。
// 说明：QQ 官方 SMTP 支持 465(SSL) 与 587(STARTTLS)。这里用 465 隐式 TLS，
// 因为 cloudflare:sockets 的 startTls() 升级在 workerd 生产环境有已知问题（升级后首读返回 done）。
import { connect } from 'cloudflare:sockets';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string; // 发件 QQ 邮箱地址
  pass: string; // QQ 邮箱 SMTP 授权码
  from: string; // 发件人地址（通常与 user 相同）
}

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function wrapBase64(b64: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
  return lines.join('\r\n');
}

function buildMessage(from: string, to: string, subject: string, text: string): string {
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${utf8Base64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].join('\r\n');
  const body = wrapBase64(utf8Base64(text || ' '));
  return `${headers}\r\n\r\n${body}\r\n`;
}

export async function sendEmail(cfg: SmtpConfig, to: string, subject: string, text: string): Promise<void> {
  // 隐式 TLS：连接即加密，无需 STARTTLS 升级
  const socket = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: 'on', allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = '';
  let step = '连接'; // 当前 SMTP 阶段，用于错误定位
  async function readLine(timeoutMs = 15000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (!buffer.includes('\n')) {
      if (Date.now() > deadline) throw new Error(`SMTP 读取超时（在步骤: ${step}）`);
      const { value, done } = await reader.read();
      if (done) throw new Error(`SMTP 连接被关闭（在步骤: ${step}）`);
      buffer += decoder.decode(value, { stream: true });
    }
    const idx = buffer.indexOf('\n');
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    return line;
  }
  async function write(s: string): Promise<void> {
    await writer.write(encoder.encode(s));
  }
  // 读取响应，直到多行响应的最后一行（code + ' '）或单行
  async function expect(code: string, timeoutMs?: number): Promise<string> {
    let line = '';
    while (true) {
      line = await readLine(timeoutMs);
      if (!line.startsWith(code)) throw new Error(`SMTP 期望 ${code}xx，实际收到: ${line}`);
      if (line.length === 3 || line[3] === ' ') break; // '-' 表示还有后续行
    }
    return line;
  }

  try {
    step = '220 问候'; await expect('220');
    step = 'EHLO'; await write(`EHLO cyyinfo.local\r\n`); await expect('250');
    step = 'AUTH LOGIN'; await write(`AUTH LOGIN\r\n`); await expect('334');
    step = '发用户'; await write(`${utf8Base64(cfg.user)}\r\n`); await expect('334');
    step = '发授权码'; await write(`${utf8Base64(cfg.pass)}\r\n`); await expect('235');
    step = 'MAIL FROM'; await write(`MAIL FROM:<${cfg.from}>\r\n`); await expect('250');
    step = 'RCPT TO'; await write(`RCPT TO:<${to}>\r\n`); await expect('250');
    step = 'DATA'; await write(`DATA\r\n`); await expect('354');
    step = '邮件正文'; await write(buildMessage(cfg.from, to, subject, text));
    step = '结束符'; await write(`.\r\n`); await expect('250');
    step = 'QUIT'; await write(`QUIT\r\n`); await expect('221');
  } finally {
    try { await writer.close(); } catch { /* 忽略 */ }
  }
}
