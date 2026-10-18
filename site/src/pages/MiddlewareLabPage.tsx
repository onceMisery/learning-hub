import { LabPage } from '@/components/LabPage';
import { MIDDLEWARE_LAB } from '@/lib/middleware-lab';

/** 中间件 · Pulsar 互动原理实验室。图解页在 public/middleware-lab/。 */
export function MiddlewareLabPage() {
  return <LabPage lab={MIDDLEWARE_LAB} />;
}
