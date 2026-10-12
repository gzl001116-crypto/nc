export const TYPE_LABEL = {
  novel: "小说",
  comic: "漫画",
  video: "视频",
} as const;

export const ORDER_STATUS_LABEL = {
  pending: "待支付",
  paid: "已支付",
  refunded: "已退款",
} as const;

export const SETTLEMENT_LABEL = {
  pending: "待结算",
  settled: "已结算",
  void: "已冲销",
} as const;

export type WorkType = keyof typeof TYPE_LABEL;
export type OrderStatus = keyof typeof ORDER_STATUS_LABEL;
export type SettlementStatus = keyof typeof SETTLEMENT_LABEL;
