import { formatCents } from './money.js';
import {
  esc, feeText, formatTime, heatText, layout, ledgerStatusLabel, orderStatusLabel,
  priceText, sortBar, typeLabel, workCard, workStatusLabel,
} from './ui.js';

function alert(text) {
  return text ? `<p class="alert" role="alert">${esc(text)}</p>` : '';
}

function grid(works, empty) {
  if (!works.length) return `<p class="empty">${empty}</p>`;
  return `<div class="grid">${works.map(workCard).join('')}</div>`;
}

export function renderHome({ user, heat, latest }) {
  return layout({
    title: 'NCstar',
    user,
    page: 'home',
    body: `
      <section class="hero">
        <div>
          <p class="eyebrow">小说 · 漫画 · 影像</p>
          <h1>夜里还亮着的那颗星。</h1>
          <p class="lede">在 NCstar 发布作品，设定读者能预览的进度或一段单独的内容。价格按分保存。付款是否成功，只看青澜支付站的签名回调。</p>
          <div class="hero-actions">
            <a class="btn gold" href="/browse">进入书库</a>
            <a class="btn ghost" href="/publish">投稿</a>
          </div>
        </div>
        <div class="hero-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <path fill="#e4b56a" d="M32 4 37.2 24.8 58 32 37.2 39.2 32 60 26.8 39.2 6 32 26.8 24.8Z"/>
            <path fill="#10141c" d="M32 16 35.2 27.4 47 32 35.2 36.6 32 48 28.8 36.6 17 32 28.8 27.4Z"/>
            <circle cx="32" cy="32" r="3.4" fill="#9fd4cb"/>
          </svg>
        </div>
      </section>
      <section class="portals" aria-label="入口">
        <a href="/browse?type=novel"><span>小说</span><strong>把一封信读完</strong></a>
        <a href="/browse?type=comic"><span>漫画</span><strong>一页一页翻过去</strong></a>
        <a href="/browse?type=video"><span>影像</span><strong>看到作者允许的进度</strong></a>
      </section>
      <section>
        <div class="section-head"><h2>热度</h2><a href="/browse?sort=heat">查看全部</a></div>
        <p class="note">热度 = 点赞人数 / 浏览人数。只有浏览人数超过 100 的作品参与排序，不足的不显示。同一账号只记一次浏览，未登录不计。</p>
        ${grid(heat, '还没有浏览超过 100 的作品。')}
      </section>
      <section>
        <div class="section-head"><h2>最新</h2><a href="/browse">查看全部</a></div>
        ${grid(latest, '书库还是空的。')}
      </section>`,
  });
}

export function renderBrowse({ user, works, sort, type, q }) {
  const heatNote = sort === 'heat'
    ? '<p class="note">这一栏按点赞人数与浏览人数的比例从高到低排列。浏览人数不超过 100 的作品不在这里。</p>'
    : '';
  return layout({
    title: '书库 · NCstar',
    user,
    page: 'browse',
    body: `
      <section class="section-head"><h1>书库</h1></section>
      ${sortBar({ sort, type, q })}
      ${heatNote}
      ${grid(works, sort === 'heat' ? '还没有浏览超过 100 的作品。' : '没有符合的作品。')}`,
  });
}

export function renderWork({ user, work }) {
  const heat = heatText({ heatEligible: work.heatEligible, heat: work.heat });
  const locked = work.access !== 'full';
  let reading = '';
  if (work.type === 'novel') {
    const text = locked && work.previewMode === 'content' ? work.previewText : work.body;
    const empty = locked && work.previewMode === 'progress' && !work.shownChars;
    reading = `<article class="paper">
      ${empty ? '<p>按当前进度，预览还不到一个字。</p>' : `<div class="prose${work.bodyTruncated ? ' is-truncated' : ''}">${esc(text)}</div>`}
    </article>`;
  } else if (work.type === 'comic') {
    const images = work.pages.map((page) => `<img src="${esc(page.url)}" alt="${esc(work.title)}">`).join('');
    reading = `<article class="pages">
      ${locked && work.previewMode === 'content' ? `<div class="paper"><div class="prose">${esc(work.previewText)}</div></div>` : ''}
      ${images || (locked ? '<p class="note">购买后可以看到画页。</p>' : '<p class="note">还没有画页。</p>')}
    </article>`;
  } else {
    const previewAttr = locked && work.previewMode === 'progress' && work.videoUrl
      ? ` data-preview-percent="${Number(work.previewPercent)}"`
      : '';
    reading = `<article class="stage">
      ${work.videoUrl ? `<video controls preload="metadata" src="${esc(work.videoUrl)}"${previewAttr}></video>` : '<p class="note">还没有可播放的片源。</p>'}
      ${locked && work.previewMode === 'content' ? `<div class="paper"><div class="prose">${esc(work.previewText)}</div></div>` : ''}
      <p class="lock" data-lock hidden>已到预览进度。购买后可以继续看。</p>
    </article>`;
  }
  const previewNote = work.previewMode === 'progress'
    ? `未购买时按进度预览前 ${work.previewPercent}%。`
    : '未购买时只显示作者准备的预览内容，不展示正文、其余画页或片源。';
  const buy = !work.mine && work.priceCents > 0 && work.access !== 'full' ? `
    <form method="post" action="/api/orders" data-buy>
      <input type="hidden" name="workId" value="${work.id}">
      <input type="hidden" name="next" value="/works/${work.id}">
      <button class="btn gold" type="submit">${work.pendingOrderNo ? '继续前往青澜支付' : '去青澜支付'}</button>
      <p class="form-error" data-buy-error></p>
    </form>` : '';
  const like = work.status === 'published' ? `
    <form method="post" action="/api/works/${work.id}/like">
      <input type="hidden" name="next" value="/works/${work.id}">
      <button class="btn ghost" type="submit">${work.liked ? '已赞' : '点赞'}</button>
    </form>` : '';
  return layout({
    title: `${work.title} · NCstar`,
    user,
    page: 'work',
    body: `
      <article class="work">
        <p class="eyebrow">${typeLabel(work.type)} · ${esc(work.author.nickname)}</p>
        <h1>${esc(work.title)}</h1>
        <p class="lede">${esc(work.summary)}</p>
        <p class="card-meta">
          <span title="${work.priceCents} 分">${esc(priceText(work.priceCents))}</span>
          <span data-views>${work.viewCount} 浏览</span>
          <span data-likes>${work.likeCount} 赞</span>
          ${heat ? `<span class="heat">${heat}</span>` : ''}
          ${work.purchased ? '<span class="heat">已购买</span>' : ''}
        </p>
        ${work.mine ? '<p class="note">这是你的作品，你看到的是完整内容。</p>' : `<p class="note">${previewNote}</p>`}
        ${work.status === 'scheduled' ? `<p class="note">定时投稿：${esc(formatTime(work.publishAt))} 前，读者看不到。</p>` : ''}
        <div class="row-actions">${like}${buy}</div>
        ${reading}
      </article>`,
  });
}

export function renderAuth({ user, config, mode, query }) {
  const login = mode === 'login';
  const next = query.next || '/';
  return layout({
    title: `${login ? '登录' : '注册'} · NCstar`,
    user,
    page: 'auth',
    body: `
      <section class="auth-card">
        <p class="eyebrow">${login ? '欢迎回来' : '建立账号'}</p>
        <h1>${login ? '邮箱登录' : '邮箱注册'}</h1>
        <p class="note">注册和登录都要邮箱验证码。验证码 10 分钟内有效。</p>
        ${alert(query.error)}
        ${query.sent ? `<p class="note">验证码已发送到 ${esc(query.email || '你的邮箱')}。${config.devMailbox ? '当前未配置发信，可在开发信箱查看。' : ''}</p>` : ''}
        <form class="stack" method="post" action="${login ? '/api/auth/login' : '/api/auth/register'}" data-auth>
          <input type="hidden" name="purpose" value="${login ? 'login' : 'register'}">
          <input type="hidden" name="returnTo" value="${login ? '/login' : '/register'}">
          <input type="hidden" name="next" value="${esc(next)}">
          <label>邮箱<input name="email" type="email" required maxlength="120" value="${esc(query.email || '')}" autocomplete="email"></label>
          ${login ? '' : '<label>昵称<input name="nickname" required maxlength="20" autocomplete="nickname"></label>'}
          <label>验证码<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
          <label>密码<input name="password" type="password" required minlength="8" maxlength="72" autocomplete="${login ? 'current-password' : 'new-password'}"></label>
          <div class="row-actions">
            <button class="btn ghost" type="submit" formaction="/api/auth/send-code" formnovalidate>获取验证码</button>
            <button class="btn gold" type="submit">${login ? '登录' : '注册'}</button>
          </div>
          <p class="note" data-auth-status></p>
          <p class="form-error" data-auth-error></p>
        </form>
        ${config.devMailbox ? '<p><a class="text-link" href="/dev/mailbox">打开开发信箱</a></p>' : ''}
        <p>${login ? '<a class="text-link" href="/register">还没有账号</a>' : '<a class="text-link" href="/login">已有账号，去登录</a>'}</p>
      </section>`,
  });
}

export function renderPublish({ user, error }) {
  return layout({
    title: '投稿 · NCstar',
    user,
    page: 'publish',
    body: `
      <section class="auth-card wide">
        <p class="eyebrow">投稿</p>
        <h1>发布一部作品</h1>
        <p class="note">价格按元填写，保存时换成整数分。可以选择让读者预览进度，或只看一段你另写的内容。定时投稿到点之前不会出现在书库。</p>
        ${alert(error)}
        <form class="stack" method="post" action="/api/works" enctype="multipart/form-data" data-publish>
          <label>类型
            <select name="type" required>
              <option value="novel">小说</option>
              <option value="comic">漫画</option>
              <option value="video">影像</option>
            </select>
          </label>
          <label>标题<input name="title" required maxlength="40"></label>
          <label>简介<textarea name="summary" maxlength="240"></textarea></label>
          <label>价格（元）<input name="priceYuan" inputmode="decimal" value="0" required></label>
          <p class="note" data-cents>将保存为 0 分。填 0 表示免费。</p>
          <fieldset>
            <legend>读者未购买时看到什么</legend>
            <label class="choice"><input type="radio" name="previewMode" value="progress" checked> 预览进度</label>
            <label class="choice"><input type="radio" name="previewMode" value="content"> 预览内容</label>
            <label data-progress-field>进度（1–99）<input name="previewPercent" type="number" min="1" max="99" value="20"></label>
            <label>预览内容<textarea name="previewText" maxlength="2000" placeholder="选择“预览内容”时必填。这段不会从正文里自动截取。"></textarea></label>
          </fieldset>
          <label data-novel-field>正文<textarea name="body" rows="10"></textarea></label>
          <label>封面<input name="cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
          <label data-comic-field hidden>漫画页<input name="pages" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>
          <label data-video-field hidden>视频<input name="video" type="file" accept="video/mp4,video/webm"></label>
          <fieldset>
            <legend>发布时间</legend>
            <label class="choice"><input type="radio" name="publishMode" value="now" checked> 立即发布</label>
            <label class="choice"><input type="radio" name="publishMode" value="schedule"> 定时投稿</label>
            <label>发布时间<input name="publishAtLocal" type="datetime-local"></label>
          </fieldset>
          <button class="btn gold" type="submit">发布</button>
          <p class="form-error" data-publish-error></p>
        </form>
      </section>`,
  });
}

export function renderStudio({ user, works }) {
  const rows = works.length ? works.map((work) => `
    <tr>
      <td><a href="/works/${work.id}">${esc(work.title)}</a></td>
      <td>${typeLabel(work.type)}</td>
      <td>${esc(priceText(work.price_cents))}</td>
      <td>${workStatusLabel(work.status)}${work.status === 'scheduled' ? ` · ${esc(formatTime(work.publish_at))}` : ''}</td>
      <td>${work.view_count}</td>
      <td>${work.like_count}</td>
    </tr>`).join('') : '<tr><td colspan="6">还没有作品。</td></tr>';
  return layout({
    title: '我的作品 · NCstar',
    user,
    page: 'studio',
    body: `
      <section class="section-head"><h1>${esc(user.nickname)} 的作品</h1><a class="btn small gold" href="/publish">新投稿</a></section>
      <div class="table-wrap">
        <table>
          <thead><tr><th>标题</th><th>类型</th><th>价格</th><th>状态</th><th>浏览</th><th>点赞</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`,
  });
}

export function renderOrders({ user, orders }) {
  const rows = orders.length ? orders.map((order) => `
    <tr>
      <td><a href="/orders/${esc(order.orderNo)}/result">${esc(order.orderNo)}</a></td>
      <td><a href="/works/${order.workId}">${esc(order.workTitle)}</a></td>
      <td>${esc(order.authorNickname)}</td>
      <td title="${order.amountCents} 分">${esc(formatCents(order.amountCents))}</td>
      <td>${orderStatusLabel(order.status)}</td>
      <td>${esc(formatTime(order.createdAt))}</td>
    </tr>`).join('') : '<tr><td colspan="6">还没有订单。</td></tr>';
  return layout({
    title: '我的订单 · NCstar',
    user,
    page: 'orders',
    body: `
      <section class="section-head"><h1>我的订单</h1></section>
      <p class="note">订单在 NCstar 生成，不在这里收款。待支付的订单要到青澜完成付款，状态只在支付站回调后改变。</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>订单号</th><th>作品</th><th>作者</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`,
  });
}

export function renderIncome({ user, summary, entries, wallet, feeLabel, error, synced }) {
  const sums = summary.length ? summary.map((row) => `
    <tr>
      <td><a href="/works/${row.work_id}">${esc(row.title)}</a></td>
      <td>${typeLabel(row.type)}</td>
      <td title="${row.paid_cents} 分">${esc(formatCents(row.paid_cents))}</td>
      <td title="${row.pending_cents} 分">${esc(formatCents(row.pending_cents))}</td>
      <td title="${row.settled_cents} 分">${esc(formatCents(row.settled_cents))}</td>
    </tr>`).join('') : '<tr><td colspan="5">还没有作品。</td></tr>';
  const lines = entries.length ? entries.map((row) => `
    <tr>
      <td>${esc(formatTime(row.created_at))}</td>
      <td>${esc(row.title)}</td>
      <td>${esc(row.order_no)}</td>
      <td>${esc(row.buyer_nickname)}</td>
      <td title="${row.gross_cents} 分">${esc(formatCents(row.gross_cents))}</td>
      <td title="${row.platform_fee_cents} 分">${esc(formatCents(row.platform_fee_cents))}</td>
      <td title="${row.author_cents} 分">${esc(formatCents(row.author_cents))}</td>
      <td>${ledgerStatusLabel(row.status)}</td>
      <td>${orderStatusLabel(row.order_status)}</td>
      <td>${row.status === 'pending_settlement' && row.order_status === 'paid' ? `
        <form method="post" action="/api/income/sync-settlement">
          <input type="hidden" name="orderNo" value="${esc(row.order_no)}">
          <button class="text-button" type="submit">查询</button>
        </form>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="10">支付成功后，这里会记下一笔收入。</td></tr>';
  return layout({
    title: '收入 · NCstar',
    user,
    page: 'income',
    body: `
      <section class="section-head"><h1>作者收入</h1></section>
      ${alert(error)}
      ${synced ? '<p class="note">已向青澜查询结算状态。</p>' : ''}
      <p class="note">已支付是读者实付总额。待结算和已结算是作者所得。平台分成 ${esc(feeLabel)}，在入账时按整数分计算。已结算以青澜的通知或查询为准。青澜只把结果显示在这里，NCstar 不向银行卡打款。</p>
      <p>已绑定客户编号 <strong>${esc(user.qinglanCustomerId)}</strong></p>
      <div class="row-actions">
        <a class="btn gold" href="${esc(wallet)}">在青澜打开结算账户</a>
        <form method="post" action="/api/income/sync-settlement"><button class="btn ghost" type="submit">查询全部待结算</button></form>
      </div>
      <h2>按作品</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>作品</th><th>类型</th><th>已支付</th><th>待结算</th><th>已结算</th></tr></thead>
          <tbody>${sums}</tbody>
        </table>
      </div>
      <h2>账本</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>作品</th><th>订单</th><th>买家</th><th>总额</th><th>平台分成</th><th>作者所得</th><th>结算</th><th>订单状态</th><th></th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
      </div>`,
  });
}

export function renderResult({ user, order, sync }) {
  const hint = {
    pending: '支付站还没有用有效签名确认这笔订单。从青澜跳回来，只能看到这个状态，不会被当成付款成功。',
    paid: '青澜的支付回调已经确认。作者收入记入账本一次，重复回调不会再记。',
    refunded: '这笔订单已退款。若当时还在待结算，作者收入已冲回。',
  }[order.status];
  return layout({
    title: `订单 ${order.orderNo} · NCstar`,
    user,
    page: 'result',
    bodyAttrs: `data-order-no="${esc(order.orderNo)}" data-status="${esc(order.status)}"`,
    body: `
      <section class="auth-card">
        <p class="eyebrow">支付结果</p>
        <h1>${orderStatusLabel(order.status)}</h1>
        <p class="pay-amount">${esc(formatCents(order.amountCents))}</p>
        <dl class="facts">
          <div><dt>订单号</dt><dd>${esc(order.orderNo)}</dd></div>
          <div><dt>作品</dt><dd><a href="/works/${order.workId}">${esc(order.workTitle)}</a></dd></div>
          <div><dt>买家</dt><dd>${esc(order.buyerNickname)}</dd></div>
          <div><dt>作者</dt><dd>${esc(order.authorNickname)}</dd></div>
          <div><dt>金额</dt><dd title="${order.amountCents} 分">${esc(formatCents(order.amountCents))}</dd></div>
        </dl>
        <p class="note">${hint}</p>
        ${sync === 'retry' ? '<p class="note">青澜说刚才的通知没有送达。若状态仍是待支付，可以回到收银台重新通知。</p>' : ''}
        <div class="row-actions">
          ${order.status === 'pending' ? `
            <form method="post" action="/api/orders/${esc(order.orderNo)}/pay">
              <button class="btn gold" type="submit">返回青澜</button>
            </form>` : `<a class="btn gold" href="/works/${order.workId}">回到作品</a>`}
          <a class="btn ghost" href="/me/orders">我的订单</a>
        </div>
      </section>`,
  });
}

export function renderMailbox({ user, rows }) {
  const list = rows.length ? `<ul class="plain">${rows.map((row) => `
    <li><strong>${esc(row.code)}</strong> ${esc(row.email)} · ${row.purpose === 'register' ? '注册' : '登录'} · ${esc(formatTime(row.created_at))}</li>
  `).join('')}</ul>` : '<p class="empty">信箱是空的。</p>';
  return layout({
    title: '开发信箱 · NCstar',
    user,
    page: 'mailbox',
    body: `
      <section class="auth-card wide">
        <h1>开发信箱</h1>
        <p class="note">没有配置 SMTP 时，验证码写在这里。配置发信之后，这个页面会关闭。</p>
        ${list}
      </section>`,
  });
}

export function renderNotFound({ user }) {
  return layout({
    title: '没有找到 · NCstar',
    user,
    page: 'missing',
    body: `<section class="auth-card"><h1>这页不在星图上</h1><p><a class="text-link" href="/browse">回书库</a></p></section>`,
  });
}
