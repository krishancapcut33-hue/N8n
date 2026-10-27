import { testDb } from '@n8n/backend-test-utils';
import { GlobalConfig } from '@n8n/config';
import { Settings, SettingsRepository } from '@n8n/db';
import { Container } from '@n8n/di';
import { DataSource, type InsertEvent } from '@n8n/typeorm';
import type { Cipher, InstanceSettings } from 'n8n-core';
import { mock } from 'vitest-mock-extended';

import { SOURCE_CONTROL_PREFERENCES_DB_KEY } from '@/modules/source-control.ee/constants';
import { generateSshKeyPair } from '@/modules/source-control.ee/source-control-helper.ee';
import { SourceControlPreferencesService } from '@/modules/source-control.ee/source-control-preferences.service.ee';
import { SourceControlConfig } from '@/modules/source-control.ee/source-control.config';

vi.mock('@/modules/source-control.ee/source-control-helper.ee', () => ({
	generateSshKeyPair: vi.fn(),
}));

const SSH_KEYS = 'features.sourceControl.sshKeys';

describe('Source control preferences initialization', () => {
	let repository: SettingsRepository;
	const cipher = mock<Cipher>();

	const createService = (isMultiMain = false) =>
		new SourceControlPreferencesService(
			mock<InstanceSettings>({ n8nFolder: '', isMultiMain }),
			mock(),
			cipher,
			repository,
			new SourceControlConfig(),
			mock(),
		);

	beforeAll(async () => {
		Container.get(GlobalConfig).database.postgresdb.poolSize = 3;
		await testDb.init();
		repository = Container.get(SettingsRepository);
	});

	beforeEach(async () => {
		await testDb.truncate(['Settings']);
		cipher.encryptV2.mockImplementation(async (value) => `encrypted:${value}`);
		let generated = 0;
		vi.mocked(generateSshKeyPair).mockImplementation(async () => {
			generated++;
			return { privateKey: `private-${generated}`, publicKey: `public-${generated}` };
		});
	});

	afterEach(() => vi.restoreAllMocks());
	afterAll(async () => await testDb.terminate());

	it.each([false, true])(
		'initializes two mains concurrently and keeps one shared key pair (keys exist: %s)',
		async (keysExist) => {
			if (keysExist) {
				await repository.save({
					key: SSH_KEYS,
					value: JSON.stringify({
						publicKey: 'public-1',
						encryptedPrivateKey: 'encrypted:private-1',
					}),
					loadOnStartup: true,
				});
			}
			const findOne = repository.findOne.bind(repository);
			let missingReads = 0;
			let releaseReads = () => {};
			const readGate = new Promise<void>((resolve) => {
				releaseReads = resolve;
			});
			vi.spyOn(repository, 'findOne').mockImplementation(async (options) => {
				const stored = await findOne(options);
				if (!stored && missingReads < 2) {
					missingReads++;
					if (missingReads === 2) releaseReads();
					await readGate;
				}
				return stored;
			});
			const racedKey = keysExist ? SOURCE_CONTROL_PREFERENCES_DB_KEY : SSH_KEYS;
			// Wait until both inserts have passed any persistence existence checks.
			let arrivals = 0;
			let release = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const subscriber = {
				listenTo: () => Settings,
				async beforeInsert({ entity }: InsertEvent<Settings>) {
					if (entity?.key !== racedKey) return;
					arrivals++;
					if (arrivals === 2) release();
					await gate;
				},
			};
			const dataSource = Container.get(DataSource);
			dataSource.subscribers.push(subscriber);
			const mains = [createService(true), createService(true)];

			try {
				const results = await Promise.allSettled(
					mains.map(async (main) => await main.loadFromDbAndApplySourceControlPreferences()),
				);
				expect(results).toEqual([
					expect.objectContaining({ status: 'fulfilled' }),
					expect.objectContaining({ status: 'fulfilled' }),
				]);
				const storedKeys = await repository.findByKey(SSH_KEYS);
				const storedPreferences = await repository.findByKey(SOURCE_CONTROL_PREFERENCES_DB_KEY);

				expect(arrivals).toBe(2);
				expect(storedKeys?.loadOnStartup).toBe(true);
				expect(
					[1, 2].map((number) => ({
						publicKey: `public-${number}`,
						encryptedPrivateKey: `encrypted:private-${number}`,
					})),
				).toContainEqual(JSON.parse(storedKeys!.value));
				expect(await mains[0].getPublicKey()).toBe(await mains[1].getPublicKey());
				expect(results[0]).toEqual(results[1]);
				expect(storedPreferences?.loadOnStartup).toBe(true);
				expect(JSON.parse(storedPreferences!.value)).toMatchObject({ environmentsVersion: 'v2' });

				await createService().loadFromDbAndApplySourceControlPreferences();
				expect(await repository.findByKey(SSH_KEYS)).toEqual(storedKeys);
			} finally {
				dataSource.subscribers.splice(dataSource.subscribers.indexOf(subscriber), 1);
			}
		},
	);

	it('preserves existing keys during initialization and replaces them on explicit regeneration', async () => {
		const main = createService();
		await main.loadFromDbAndApplySourceControlPreferences();
		const originalKeys = await repository.findByKey(SSH_KEYS);

		await createService().loadFromDbAndApplySourceControlPreferences();
		expect(await repository.findByKey(SSH_KEYS)).toEqual(originalKeys);

		await main.generateAndSaveKeyPair('rsa');
		expect(await repository.findByKey(SSH_KEYS)).not.toEqual(originalKeys);
		expect(vi.mocked(generateSshKeyPair)).toHaveBeenLastCalledWith('rsa');
		expect(main.getPreferences().keyGeneratorType).toBe('rsa');
	});
});
