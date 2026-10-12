"use client";

import { useState } from "react";
import Link from "next/link";

export function AuthForm({
  mode,
  nextPath,
  devMailbox,
}: {
  mode: "login" | "register";
  nextPath: string;
  devMailbox: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [wait, setWait] = useState(0);
  const [pending, setPending] = useState(false);

  async function sendCode() {
    setError("");
    setInfo("");
    const response = await fetch("/api/auth/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose: mode }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error || "验证码发送失败");
      return;
    }
    setInfo(mode === "login" ? "如果这个邮箱已注册，验证码已发送。" : "验证码已发送。");
    setWait(60);
    const timer = window.setInterval(() => {
      setWait((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, displayName, code }),
    });
    const data = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error || "提交失败");
      return;
    }
    location.href = nextPath || "/";
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <div>
        <h1>{mode === "login" ? "登录" : "注册"}</h1>
        <p className="muted">使用邮箱和验证码。验证码 10 分钟内有效。</p>
      </div>
      {mode === "register" ? (
        <label>
          名字
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={30} required />
        </label>
      ) : null}
      <label>
        邮箱
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label>
        密码
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required />
      </label>
      <label>
        验证码
        <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required />
      </label>
      <div className="actions">
        <button className="btn-line" type="button" onClick={sendCode} disabled={wait > 0}>
          {wait > 0 ? `${wait} 秒后可重发` : "获取验证码"}
        </button>
        <button className="btn" type="submit" disabled={pending}>{pending ? "提交中" : mode === "login" ? "登录" : "注册"}</button>
      </div>
      {info ? <p className="muted">{info}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {devMailbox ? <p className="muted">开发环境可在 <Link href="/dev/mailbox" target="_blank">邮件信箱</Link> 查看验证码。</p> : null}
      <p className="muted">
        {mode === "login" ? <Link href={`/register?next=${encodeURIComponent(nextPath)}`}>没有账号，去注册</Link> : <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>已有账号，去登录</Link>}
      </p>
    </form>
  );
}
