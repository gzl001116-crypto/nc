import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { listMailbox } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "邮件信箱", robots: { index: false, follow: false } };

export default function MailboxPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const mails = listMailbox(getDb());
  return (
    <div className="stack">
      <div>
        <h1>开发邮件信箱</h1>
        <p className="muted">没有配置 SMTP 时，验证码会留在这里。生产环境不提供这个页面。</p>
      </div>
      {mails.length === 0 ? <div className="empty">还没有邮件。</div> : mails.map((mail) => (
        <article key={mail.id} className="panel">
          <p className="meta"><span>{mail.email}</span><span>{formatDateTime(mail.created_at)}</span></p>
          <h2>{mail.subject}</h2>
          <p>{mail.body}</p>
        </article>
      ))}
    </div>
  );
}
