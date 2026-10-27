import { testDb } from '@n8n/backend-test-utils';
import { ScheduledJobOwnerType } from '@n8n/constants';
import type { ScheduledJob } from '@n8n/db';
import { ScheduledJobRepository, ScheduledTaskRepository } from '@n8n/db';
import { Container } from '@n8n/di';

describe('ScheduledJobRepository', () => {
	let jobRepo: ScheduledJobRepository;
	let taskRepo: ScheduledTaskRepository;

	beforeAll(async () => {
		await testDb.init();
		jobRepo = Container.get(ScheduledJobRepository);
		taskRepo = Container.get(ScheduledTaskRepository);
	});

	beforeEach(async () => {
		await testDb.truncate(['ScheduledTask', 'ScheduledJob']);
	});

	afterAll(async () => {
		await testDb.terminate();
	});

	const createJob = async (name: string, overrides: Partial<ScheduledJob> = {}) =>
		await jobRepo.save(
			jobRepo.create({
				name,
				ownerType: ScheduledJobOwnerType.SystemTask,
				ownerId: name,
				ownerMemberId: null,
				taskType: 'system:test',
				payload: {},
				kind: 'interval',
				intervalSeconds: 600,
				enabled: true,
				nextRunAt: new Date('2026-01-01T00:10:00.000Z'),
				maxAttempts: 1,
				...overrides,
			}),
		);

	const createRun = async (jobId: number, status: 'succeeded' | 'failed', finishedAt: Date) =>
		await taskRepo.save(
			taskRepo.create({
				jobId,
				taskType: 'system:test',
				payload: {},
				scheduledFor: finishedAt,
				runAt: finishedAt,
				status,
				finishedAt,
			}),
		);

	describe('findScheduleStatesByOwnerType', () => {
		it('reports a disabled or quarantined job as not runnable', async () => {
			await createJob('enabled');
			await createJob('disabled', { enabled: false });
			await createJob('quarantined', { orphanedAt: new Date('2026-01-01T00:00:00.000Z') });
			await createJob('workflow-job', { ownerType: ScheduledJobOwnerType.Workflow });

			const states = await jobRepo.findScheduleStatesByOwnerType(ScheduledJobOwnerType.SystemTask);

			const runnableByOwner = Object.fromEntries(
				states.map(({ ownerId, runnable }) => [ownerId, runnable]),
			);
			expect(runnableByOwner).toEqual({ enabled: true, disabled: false, quarantined: false });
		});

		it('returns the newest finish time of a succeeded run for each job', async () => {
			const OLDER_SUCCESS = new Date('2026-01-01T00:00:00.000Z');
			const NEWEST_SUCCESS = new Date('2026-01-01T00:10:00.000Z');
			const NEWER_FAILURE = new Date('2026-01-01T00:20:00.000Z');
			const succeededAndFailed = await createJob('succeeded-and-failed');
			const onlyFailed = await createJob('only-failed');
			await createRun(succeededAndFailed.id, 'succeeded', OLDER_SUCCESS);
			await createRun(succeededAndFailed.id, 'succeeded', NEWEST_SUCCESS);
			await createRun(succeededAndFailed.id, 'failed', NEWER_FAILURE);
			await createRun(onlyFailed.id, 'failed', NEWER_FAILURE);

			const states = await jobRepo.findScheduleStatesByOwnerType(ScheduledJobOwnerType.SystemTask);

			const lastSucceededByOwner = Object.fromEntries(
				states.map(({ ownerId, lastSucceededAt }) => [ownerId, lastSucceededAt]),
			);
			expect(lastSucceededByOwner).toEqual({
				'succeeded-and-failed': NEWEST_SUCCESS,
				'only-failed': null,
			});
		});
	});
});
