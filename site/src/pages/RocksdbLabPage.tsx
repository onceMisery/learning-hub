import { LabPage } from '@/components/LabPage';
import { ROCKSDB_LAB } from '@/lib/rocksdb-lab';

/** 存储引擎 · RocksDB 互动原理实验室。图解页在 public/rocksdb-lab/。 */
export function RocksdbLabPage() {
  return <LabPage lab={ROCKSDB_LAB} />;
}
