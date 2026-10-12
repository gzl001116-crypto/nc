import fs from 'node:fs';
import { makeConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { seedIfEmpty } from './seed.js';

const config = makeConfig();
fs.mkdirSync(config.uploadDir, { recursive: true });
const db = openDatabase(config.dbFile);
if (config.seed) {
  const seeded = seedIfEmpty(db, config);
  if (seeded) console.log('已写入示例作品。作者 lin@ncstar.local ，读者 tang@ncstar.local ，密码 ncstar-demo-8。登录仍需要验证码。');
}
if (config.sharedSecret === 'dev-qinglan-secret-change-me') {
  console.warn('正在使用默认的青澜验签密钥，只适合本地演示。');
}
const app = createApp({ db, config });
app.listen(config.port, config.host, () => {
  console.log(`NCstar 已启动 ${config.publicBaseUrl}`);
});
