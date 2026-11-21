import type { AgentResult, EngineeringTask } from '../core/contracts.ts';

/**
 * A future provider implements this interface behind a trusted orchestration service.
 * Phase-specific approvals, budget enforcement, and isolation belong to that service.
 */
export interface DevinAdapter {
  dispatch(request: {
    task: EngineeringTask;
    phase: 'investigation' | 'repair' | 'validation';
    approvalReference: string;
  }): Promise<{ sessionId: string }>;
  result(sessionId: string): Promise<AgentResult | null>;
}

export const disabledDevinAdapter: DevinAdapter = {
  async dispatch() {
    throw new Error('Devin dispatch is disabled.');
  },
  async result() {
    throw new Error('Devin dispatch is disabled.');
  },
};
