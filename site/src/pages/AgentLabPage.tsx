import { LabPage } from '@/components/LabPage';
import { AGENT_LAB } from '@/lib/agent-lab';

/** Agent 互动原理实验室。图解页在 public/agent-lab/。 */
export function AgentLabPage() {
  return <LabPage lab={AGENT_LAB} />;
}
