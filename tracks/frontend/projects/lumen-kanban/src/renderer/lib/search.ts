import type { Card } from '@shared/types';

/**
 * 搜索谓词抽成纯函数，让"数据库层查询"和"UI 层实时过滤"共用同一份逻辑，
 * 避免两处规则不一致导致"搜索结果和列表对不上"的经典 bug。
 */
export function matchesKeyword(card: Card, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [card.title, card.notes, ...card.tags].join(' ').toLowerCase();
  return haystack.includes(needle);
}
