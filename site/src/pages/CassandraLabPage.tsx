import { LabPage } from '@/components/LabPage';
import { CASSANDRA_LAB } from '@/lib/cassandra-lab';

/** 分布式数据库 · Cassandra 互动原理实验室。图解页在 public/cassandra-lab/。 */
export function CassandraLabPage() {
  return <LabPage lab={CASSANDRA_LAB} />;
}
