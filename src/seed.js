import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './authlib.js';

const NOVEL = `夜班船靠岸时，灯塔已经灭了一半。林夏把信夹在星图里，纸边还沾着盐。她数过，从北港到这里要跨过七个没有名字的湾。湾里的人不用钟表，只看潮水把石头没过第几道痕。

信上只写了一句：星还在旧位置，人已经不在了。

她没有立刻回。码头的风把衣角吹得发硬。有人在卖热汤，汤面浮着一圈油，像一小块不肯散的月亮。林夏站了一会儿，把信纸翻到背面，画了今天看到的那颗偏西的星。它不在任何一版印刷的图上，却亮得过分老实。

“你又在改图。”船老大手里的绳子还滴水。

“图如果不肯改，船就会撞上没有画出来的地方。”

老人笑了一声，把绳子扔上桩。桩是新的，木头还香。林夏把星图卷好，塞进外套内袋。内袋靠着心跳，纸慢慢暖了。她知道明天还得把这句话写完：星可以新，路得自己量。`;

const SHORT = `短笺的正文比预览长得多。购买之前，读者只能看见作者单独写下的预览，不应看到这句以及后面的港口、夜航和那盏临时点亮的灯。若这句出现在未购买的页面上，预览就泄漏了。`;

const HUNDRED = `未满一百次浏览的作品，即使点赞很多，也不进入热度栏。这篇短文用来占住“最新”和“价格”，让热度榜留出空位。风从页边吹过去，数字停在门槛这边。`;

const LATER = `这篇航线还没有到发布时间。读者现在不该看见正文。定时到点之后，它才会出现在书库里。`;

function panel(title, caption) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#f6f1e7"/>
  <rect x="46" y="46" width="808" height="1108" fill="none" stroke="#241c16" stroke-width="4"/>
  <circle cx="450" cy="360" r="90" fill="#e4b56a"/>
  <circle cx="450" cy="360" r="18" fill="#16343a"/>
  <text x="80" y="560" font-size="48" font-family="serif" fill="#241c16">${title}</text>
  <text x="80" y="660" font-size="32" font-family="serif" fill="#241c16">${caption}</text>
</svg>`;
}

export function seedIfEmpty(db, config) {
  const count = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
  if (count > 0) return false;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const now = Date.now();
  const passwordHash = hashPassword('ncstar-demo-8');
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, nickname, qinglan_customer_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    const authorId = Number(insertUser.run('lin@ncstar.local', passwordHash, '林昭', 'QLCSEEDAUTHOR0001', now).lastInsertRowid);
    insertUser.run('tang@ncstar.local', passwordHash, '唐宁', 'QLCSEEDREADER0001', now);
    const viewers = [];
    for (let i = 1; i <= 210; i += 1) {
      viewers.push(Number(insertUser.run(
        `v${i}@seed.ncstar.local`,
        passwordHash,
        `路人${i}`,
        `QLCSEED${String(i).padStart(6, '0')}`,
        now,
      ).lastInsertRowid));
    }
    const insertWork = db.prepare(`
      INSERT INTO works (
        author_id, type, title, summary, cover_path, body, price_cents, preview_mode,
        preview_percent, preview_text, publish_at, status, published_at, view_count, like_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `);
    const specs = [
      {
        type: 'novel', title: '北港来信', summary: '一封没有写完的回信，和一颗不在旧星图上的星。',
        body: NOVEL, price: 2800, mode: 'progress', percent: 20, preview: '',
        at: now - 86400000 * 5, status: 'published', views: 128, likes: 46,
      },
      {
        type: 'comic', title: '星图手记', summary: '四格港口夜话。未购买时只看见预览文字。',
        body: '', price: 3600, mode: 'content', percent: null,
        preview: '四格草稿：港口、星图、北风，和一颗新星。购买后可看全部画页。',
        at: now - 86400000 * 4, status: 'published', views: 210, likes: 40, comic: true,
      },
      {
        type: 'novel', title: '短笺', summary: '预览是作者另写的一段，不是正文的开头。',
        body: SHORT, price: 600, mode: 'content', percent: null,
        preview: '这是作者留给路人的预览。正文要等购买之后。',
        at: now - 86400000 * 2, status: 'published', views: 101, likes: 8,
      },
      {
        type: 'novel', title: '未满百', summary: '点赞很多，但浏览还没有超过一百，所以不进热度栏。',
        body: HUNDRED, price: 1200, mode: 'progress', percent: 30, preview: '',
        at: now - 86400000, status: 'published', views: 90, likes: 70,
      },
      {
        type: 'video', title: '潮声一分钟', summary: '一分钟潮声。示例没有片源，上传的视频会在作品页播放。',
        body: '片源由作者上传后播放。', price: 900, mode: 'progress', percent: 15, preview: '',
        at: now - 3600_000, status: 'published', views: 86, likes: 60,
      },
      {
        type: 'novel', title: '后天的航线', summary: '还在定时投稿里，到点之前书库不会出现。',
        body: LATER, price: 1500, mode: 'progress', percent: 10, preview: '',
        at: now + 2 * 86400000, status: 'scheduled', views: 0, likes: 0,
      },
    ];
    const ids = specs.map((spec) => Number(insertWork.run(
      authorId, spec.type, spec.title, spec.summary, spec.body, spec.price, spec.mode,
      spec.percent, spec.preview, spec.at, spec.status, spec.status === 'published' ? spec.at : null,
      now, now,
    ).lastInsertRowid));
    const comicId = ids[1];
    const captions = [
      ['港口', '灯一盏盏亮起来'],
      ['星图', '她把图摊在膝上'],
      ['北风', '纸角被风掀起'],
      ['新星', '有一颗不在旧图上'],
    ];
    const insertAsset = db.prepare(`
      INSERT INTO work_assets (work_id, kind, path, mime, sort_order) VALUES (?, 'page', ?, 'image/svg+xml', ?)
    `);
    captions.forEach((item, index) => {
      const filename = `seed-comic-${index + 1}.svg`;
      fs.writeFileSync(path.join(config.uploadDir, filename), panel(item[0], item[1]));
      insertAsset.run(comicId, filename, index);
    });
    const viewStmt = db.prepare('INSERT INTO work_views (user_id, work_id, created_at) VALUES (?, ?, ?)');
    const likeStmt = db.prepare('INSERT INTO work_likes (user_id, work_id, created_at) VALUES (?, ?, ?)');
    specs.forEach((spec, index) => {
      if (spec.status !== 'published') return;
      for (let i = 0; i < spec.views; i += 1) viewStmt.run(viewers[i], ids[index], now);
      for (let i = 0; i < spec.likes; i += 1) likeStmt.run(viewers[i], ids[index], now);
    });
    db.prepare(`
      UPDATE works SET
        view_count = (SELECT COUNT(*) FROM work_views WHERE work_id = works.id),
        like_count = (SELECT COUNT(*) FROM work_likes WHERE work_id = works.id)
    `).run();
  });
  tx();
  return true;
}
