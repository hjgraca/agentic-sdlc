import { defineStoreContractTests } from '@flue/runtime/test-utils';
import { s3Adapter } from './adapter.ts';

defineStoreContractTests('S3-sessions adapter', {
	async create() {
		const adapter = s3Adapter({
			bucket: 'flue-sessions', region: 'us-east-1', endpoint: 'http://localhost:9100',
		});
		await adapter.migrate?.();
		const { executionStore } = await adapter.connect();
		return executionStore;
	},
});
