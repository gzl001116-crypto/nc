const PURPOSE_LABEL = { register: '注册', login: '登录' };

export async function deliverCode({ config, email, purpose, code }) {
  if (!config.smtp) return { delivered: config.devMailbox ? 'mailbox' : 'none' };
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.sendMail({
    from: config.smtp.from,
    to: email,
    subject: `NCstar ${PURPOSE_LABEL[purpose] || ''}验证码`,
    text: `你的 NCstar 验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略这封邮件。`,
  });
  return { delivered: 'smtp' };
}
