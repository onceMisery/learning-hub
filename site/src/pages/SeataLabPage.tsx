import { LabPage } from '@/components/LabPage';
import { SEATA_LAB } from '@/lib/seata-lab';

/** 分布式事务 · Seata 互动原理实验室。图解页在 public/seata-lab/。 */
export function SeataLabPage() {
  return <LabPage lab={SEATA_LAB} />;
}
