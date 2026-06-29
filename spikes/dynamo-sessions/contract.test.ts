/**
 * Run Flue's OWN AgentExecutionStore contract suite against our adapter's
 * executionStore (DynamoDB sessions + in-memory SQLite machinery). Each test
 * gets a fresh store with a unique session-table partition (via a per-test
 * table) — but since sessions are keyed by id and tests use distinct ids, one
 * shared Local table is fine; we clear it in cleanup by recreating connect().
 */
import { defineStoreContractTests } from '@flue/runtime/test-utils';
import { dynamoAdapter } from './adapter.ts';

defineStoreContractTests('DynamoDB-sessions adapter', {
	async create() {
		const adapter = dynamoAdapter({
			tableName: 'flue-sessions', region: 'us-west-2', endpoint: 'http://localhost:8000',
		});
		await adapter.migrate?.();
		const { executionStore } = await adapter.connect();
		return executionStore;
	},
});
