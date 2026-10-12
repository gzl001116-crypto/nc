function yuanToCents(text) {
  const value = String(text ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const [yuan, frac = ''] = value.split('.');
  return Number(yuan) * 100 + Number((frac + '00').slice(0, 2));
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

const authForm = document.querySelector('[data-auth]');
authForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const action = event.submitter?.getAttribute('formaction') || form.action;
  const error = form.querySelector('[data-auth-error]');
  const status = form.querySelector('[data-auth-status]');
  error.textContent = '';
  status.textContent = '';
  const payload = Object.fromEntries(new FormData(form));
  const res = await fetch(action, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  if (!res.ok) {
    error.textContent = data.error || '没有完成';
    return;
  }
  if (String(action).includes('send-code')) {
    status.textContent = data.dev ? '验证码已写入开发信箱。' : '验证码已发到邮箱。';
    return;
  }
  const next = typeof payload.next === 'string' && payload.next.startsWith('/') && !payload.next.startsWith('//')
    ? payload.next
    : (String(form.action).includes('register') ? '/me' : '/');
  location.href = next;
});

const publishForm = document.querySelector('[data-publish]');
if (publishForm) {
  const centsNote = publishForm.querySelector('[data-cents]');
  const price = publishForm.querySelector('[name="priceYuan"]');
  const showCents = () => {
    const cents = yuanToCents(price.value);
    centsNote.textContent = cents === null ? '价格最多保留两位小数，保存为整数分。' : `将保存为 ${cents} 分。填 0 表示免费。`;
  };
  const sync = () => {
    const type = publishForm.type.value;
    publishForm.querySelector('[data-novel-field]').hidden = type === 'comic';
    publishForm.querySelector('[data-comic-field]').hidden = type !== 'comic';
    publishForm.querySelector('[data-video-field]').hidden = type !== 'video';
    const progress = publishForm.previewMode.value === 'progress';
    publishForm.querySelector('[data-progress-field]').hidden = !progress;
  };
  price.addEventListener('input', showCents);
  publishForm.addEventListener('change', sync);
  showCents();
  sync();
  publishForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = publishForm.querySelector('[data-publish-error]');
    error.textContent = '';
    const cents = yuanToCents(price.value);
    if (cents === null) {
      error.textContent = '价格须为非负数字，最多两位小数';
      return;
    }
    const body = new FormData(publishForm);
    body.set('priceCents', String(cents));
    if (body.get('publishMode') === 'schedule') {
      const at = new Date(body.get('publishAtLocal')).getTime();
      if (!Number.isFinite(at)) {
        error.textContent = '请选择定时投稿的时间';
        return;
      }
      body.set('publishAt', String(at));
    }
    const res = await fetch('/api/works', { method: 'POST', body, headers: { accept: 'application/json' } });
    const data = await readJson(res);
    if (!res.ok) {
      error.textContent = data.error || '没有发布';
      return;
    }
    location.href = `/works/${data.id}`;
  });
}

document.querySelector('[data-buy]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = form.querySelector('[data-buy-error]');
  error.textContent = '';
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ workId: Number(new FormData(form).get('workId')) }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    error.textContent = res.status === 401 ? '请先登录后再购买' : (data.error || '没有生成订单');
    return;
  }
  location.href = data.payUrl;
});

const previewVideo = document.querySelector('video[data-preview-percent]');
if (previewVideo) {
  const ratio = Number(previewVideo.dataset.previewPercent) / 100;
  previewVideo.addEventListener('timeupdate', () => {
    if (!Number.isFinite(previewVideo.duration) || previewVideo.duration === 0) return;
    if (previewVideo.currentTime > previewVideo.duration * ratio + 0.2) {
      previewVideo.pause();
      previewVideo.currentTime = Math.max(0, previewVideo.duration * ratio - 0.05);
      document.querySelector('[data-lock]')?.removeAttribute('hidden');
    }
  });
}

if (document.body.dataset.page === 'result' && document.body.dataset.status === 'pending') {
  const orderNo = document.body.dataset.orderNo;
  let times = 0;
  const timer = setInterval(async () => {
    times += 1;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderNo)}`, { headers: { accept: 'application/json' } });
      const data = await readJson(res);
      if (data.order && data.order.status !== 'pending') {
        clearInterval(timer);
        location.reload();
      }
    } catch {
      /* 结果页继续等待回调 */
    }
    if (times >= 15) clearInterval(timer);
  }, 2000);
}
