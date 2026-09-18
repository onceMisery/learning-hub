/**
 * 生成唯一 ID。
 * 为什么不用自增数字：本地数据与未来可能的云端数据需要全局唯一，
 * 且 IndexedDB 里自增要额外维护计数器（并发写入还会冲突）。
 */
export const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
