# NCstar

小说、漫画和视频站。读者用邮箱验证码注册登录，创作者可以立即发布或定时投稿，并选择按进度或按指定内容预览。

金额以分为整数保存。下单只生成待支付订单并跳到支付站，付款成功只认带约定密钥的回调。作者收入在 NCstar 展示，结算账户、提现和打款留在支付站。

## 本地运行

```bash
npm install
npm run dev
```

开发环境没有 SMTP 时，验证码写在 [邮件信箱](http://localhost:3000/dev/mailbox)。生产环境必须配置 `PAYMENT_SHARED_SECRET`、`SESSION_SECRET` 和 SMTP，信箱页面不会打开。

支付站默认是本机的 `/station`，用来演示验签、回调和结算查询。把 `PAYMENT_BASE_URL` 指到真实支付站后，创建订单会跳到那里。

## 环境变量

见 `.env.example`。

- `PLATFORM_FEE_BPS`：平台分成，万分比。`1000` 表示 10%，分成按分向下取整。
- `PAYMENT_SHARED_SECRET`：和支付站约定的 HMAC-SHA256 密钥。

## 支付约定

收银台参数、支付回调、结算通知和结算查询都用同一套签名：去掉 `sign` 和空字段，按参数名排序，拼成 `key=value&key=value`，用约定密钥做 HMAC-SHA256，结果为小写十六进制。

支付回调 `POST /api/payments/notify` 确认 `paid` 后，订单才变为已支付，并写一笔收入。同一订单重复回调不会再写收入。`refunded` 把订单改为已退款；若收入还在待结算，则冲销。

结算通知 `POST /api/payments/settlement`，或作者在收入页发起的支付站查询，只更新待结算或已结算，不改变支付状态。用户从支付站跳回 `/pay/return` 时，页面只展示当前订单。
