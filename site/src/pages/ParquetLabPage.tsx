import { LabPage } from '@/components/LabPage';
import { PARQUET_LAB } from '@/lib/parquet-lab';

/** 数据湖 · Parquet 互动原理实验室。图解页在 public/parquet-lab/。 */
export function ParquetLabPage() {
  return <LabPage lab={PARQUET_LAB} />;
}
