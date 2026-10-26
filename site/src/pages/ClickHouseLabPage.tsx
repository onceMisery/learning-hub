import { LabPage } from '@/components/LabPage';
import { CLICKHOUSE_LAB } from '@/lib/clickhouse-lab';

/** 分析引擎 · ClickHouse 互动原理实验室。图解页在 public/clickhouse-lab/。 */
export function ClickHouseLabPage() {
  return <LabPage lab={CLICKHOUSE_LAB} />;
}
