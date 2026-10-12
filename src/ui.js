import { formatBps, formatCents } from './money.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function formatTime(ms) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(Number(ms)));
}

export function typeLabel(type) {
  return { novel: '小说', comic: '漫画', video: '影像' }[type] || '作品';
}

export function orderStatusLabel(status) {
  return { pending: '待支付', paid: '已支付', refunded: '已退款' }[status] || status;
}

export function ledgerStatusLabel(status) {
  return { pending_settlement: '待结算', settled: '已结算', reversed: '已冲回' }[status] || status;
}

export function workStatusLabel(status) {
  return { published: '已发布', scheduled: '定时投稿' }[status] || status;
}

export function priceText(cents) {
  return cents ? formatCents(cents) : '免费';
}

export function heatText(work) {
  if (!work?.heatEligible || work.heat === null || work.heat === undefined) return '';
  return `热度 ${(work.heat * 100).toFixed(1)}%`;
}

export function feeText(bps) {
  return formatBps(bps);
}

export function logoSvg(className = 'logo-mark') {
  return `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="16" fill="#141a28"/>
    <path fill="#e4b56a" d="M32 5.2 36.4 24.6 56.8 32 36.4 39.4 32 58.8 27.6 39.4 7.2 32 27.6 24.6Z"/>
    <path fill="#141a28" d="M32 17.2 34.8 27.6 45.6 32 34.8 36.4 32 46.8 29.2 36.4 18.4 32 29.2 27.6Z"/>
    <circle cx="32" cy="32" r="3.3" fill="#9fd4cb"/>
  </svg>`;
}

function header(user) {
  const account = user ? `
    <a href="/me">${esc(user.nickname)}</a>
    <a href="/publish">投稿</a>
    <a href="/me/orders">订单</a>
    <a href="/me/income">收入</a>
    <form method="post" action="/api/auth/logout"><button class="text-button" type="submit">退出</button></form>
  ` : `
    <a href="/login">登录</a>
    <a class="btn small gold" href="/register">注册</a>
  `;
  return `<header class="site-header">
    <a class="brand" href="/">${logoSvg()}<span>NCstar</span></a>
    <nav class="nav" aria-label="书库">
      <a href="/browse">书库</a>
      <a href="/browse?type=novel">小说</a>
      <a href="/browse?type=comic">漫画</a>
      <a href="/browse?type=video">影像</a>
      <a href="/browse?sort=heat">热度</a>
    </nav>
    <div class="nav-user">${account}</div>
  </header>`;
}

function footer() {
  return `<footer class="site-footer">
    <span>NCstar</span>
    <span>订单和作者收入在这里展示。收款、结算账户、提现和打款在青澜支付站完成。</span>
  </footer>`;
}

export function layout({ title, user, page, body, bodyAttrs = '' }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="NCstar：小说、漫画与影像。邮箱验证码登录，按分计价，支付结果以青澜回调为准。">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Outfit:wght@400;520;650&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body data-page="${esc(page)}" data-site="ncstar" ${bodyAttrs}>
  ${header(user)}
  <main>${body}</main>
  ${footer()}
  <script src="/js/app.js"></script>
</body>
</html>`;
}

export function qinglanPage({ title, body }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Outfit:wght@400;520;650&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body data-page="qinglan" data-site="qinglan">
  <header class="pay-header">
    <a href="/qinglan"><strong>青澜</strong><span>支付站</span></a>
    <p>结算账户、提现和打款留在这里。</p>
  </header>
  <main class="pay-main">${body}</main>
</body>
</html>`;
}

function browseHref({ sort = 'latest', type = '', q = '' }) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (sort && sort !== 'latest') params.set('sort', sort);
  if (q) params.set('q', q);
  const text = params.toString();
  return text ? `/browse?${text}` : '/browse';
}

export function sortBar({ sort, type, q }) {
  const sorts = [['latest', '最新'], ['heat', '热度'], ['price', '价格']];
  const types = [['', '全部'], ['novel', '小说'], ['comic', '漫画'], ['video', '影像']];
  return `<div class="sortbar">
    <div class="chips" role="tablist" aria-label="类型">
      ${types.map(([value, label]) => `<a class="${type === value ? 'is-on' : ''}" href="${esc(browseHref({ sort, type: value, q }))}">${label}</a>`).join('')}
    </div>
    <div class="chips" role="tablist" aria-label="排序">
      ${sorts.map(([value, label]) => `<a class="${sort === value ? 'is-on' : ''}" href="${esc(browseHref({ sort: value, type, q }))}">${label}</a>`).join('')}
    </div>
    <form class="search" method="get" action="/browse">
      ${type ? `<input type="hidden" name="type" value="${esc(type)}">` : ''}
      ${sort !== 'latest' ? `<input type="hidden" name="sort" value="${esc(sort)}">` : ''}
      <input name="q" value="${esc(q)}" placeholder="搜索标题" aria-label="搜索标题">
    </form>
  </div>`;
}

export function workCard(work) {
  const heat = heatText(work);
  const cover = work.cover_path
    ? ` has-image" style="background-image:url('/media/works/${Number(work.id)}/cover')"`
    : '';
  return `<a class="card" href="/works/${work.id}">
    <div class="card-cover ${esc(work.type)}${cover}">
      <span class="card-type">${typeLabel(work.type)}</span>
      <strong>${esc(work.title)}</strong>
    </div>
    <div class="card-body">
      <p class="card-author">${esc(work.author_nickname)}</p>
      <p>${esc(Array.from(work.summary || '').slice(0, 72).join(''))}</p>
      <p class="card-meta">
        <span>${esc(priceText(work.price_cents))}</span>
        <span>${work.view_count} 浏览</span>
        <span>${work.like_count} 赞</span>
        ${heat ? `<span class="heat">${heat}</span>` : ''}
      </p>
    </div>
  </a>`;
}

export { formatCents };
