import { nanoid } from 'nanoid';

import { test, expect } from '../../../../../fixtures/base';

test.use({ viewport: { width: 1280, height: 800 } });

test.describe(
	'Logs panel node names',
	{ annotation: [{ type: 'owner', description: 'Lifecycle & Governance' }] },
	() => {
		for (const nodeName of [
			'Code',
			'Generate Daily Summary Report',
			'Send WhatsApp Daily Summary',
		]) {
			test(`should show "${nodeName}" in full beside execution output`, async ({ n8n, api }) => {
				const workflow = await api.workflows.createWorkflow({
					name: `Logs panel layout ${nanoid()}`,
					nodes: [
						{
							id: nanoid(),
							name: 'Start',
							type: 'n8n-nodes-base.manualTrigger',
							typeVersion: 1,
							position: [240, 300],
							parameters: {},
						},
						{
							id: nanoid(),
							name: nodeName,
							type: 'n8n-nodes-base.noOp',
							typeVersion: 1,
							position: [480, 300],
							parameters: {},
						},
					],
					connections: {
						Start: { main: [[{ node: nodeName, type: 'main', index: 0 }]] },
					},
				});

				try {
					await n8n.start.fromExistingWorkflow(workflow.id);
					const logs = n8n.canvas.logsPanel;
					await logs.open();
					await n8n.workflowComposer.executeWorkflowAndWaitForNotification('Successful');
					await expect(logs.getOverviewStatus()).toContainText('Success in');
					await expect(logs.getSelectedLogEntry()).toContainText(nodeName);
					await expect(logs.outputPanel.get()).toBeVisible();

					const label = logs.getNodeName(nodeName);
					await expect(label).toBeVisible();

					// LIGO-884: Check rendered text, since an ellipsis does not change textContent.
					await expect
						.poll(
							async () =>
								await label.evaluate(async (element) => {
									await element.ownerDocument.fonts.ready;
									return element.scrollWidth - element.clientWidth;
								}),
							{ message: `The default node list must show the full name "${nodeName}"` },
						)
						.toBe(0);
				} finally {
					await api.workflows.archive(workflow.id);
					await api.workflows.delete(workflow.id);
				}
			});
		}
	},
);

test.describe(
	'Compact logs panel',
	{ annotation: [{ type: 'owner', description: 'Lifecycle & Governance' }] },
	() => {
		test.use({ viewport: { width: 808, height: 800 } });

		test('should reserve space for both input and output beside chat', async ({ n8n, api }) => {
			const workflow = await api.workflows.createWorkflow({
				name: `Compact logs panel layout ${nanoid()}`,
				nodes: [
					{
						id: nanoid(),
						name: 'Chat',
						type: '@n8n/n8n-nodes-langchain.chatTrigger',
						typeVersion: 1.3,
						position: [240, 300],
						parameters: { options: {} },
					},
					{
						id: nanoid(),
						name: 'Code',
						type: 'n8n-nodes-base.noOp',
						typeVersion: 1,
						position: [480, 300],
						parameters: {},
					},
				],
				connections: {
					Chat: { main: [[{ node: 'Code', type: 'main', index: 0 }]] },
				},
			});

			try {
				await n8n.start.fromExistingWorkflow(workflow.id);
				const logs = n8n.canvas.logsPanel;
				await logs.open();
				await expect(logs.getManualChatInput()).toBeVisible();
				await logs.sendManualChatMessage('Compact layout');
				await expect(logs.getOverviewStatus()).toContainText('Success in');
				await expect(logs.getSelectedLogEntry()).toContainText('Code');
				await expect(logs.outputPanel.get()).toBeVisible();
				await logs.toggleInputPanel();
				await expect(logs.inputPanel.get()).toBeVisible();
				await expect(logs.outputPanel.get()).toBeVisible();

				for (const panel of [logs.inputPanel, logs.outputPanel]) {
					await expect
						.poll(async () => (await panel.get().boundingBox())?.width, {
							message: 'Each I/O pane must keep 200 px, allowing 1 px for the divider',
						})
						.toBeGreaterThanOrEqual(199);
				}
			} finally {
				await api.workflows.archive(workflow.id);
				await api.workflows.delete(workflow.id);
			}
		});
	},
);

test.describe(
	'Logs panel header actions',
	{ annotation: [{ type: 'owner', description: 'Lifecycle & Governance' }] },
	() => {
		test('should separate header buttons and match the chat reset button size', async ({
			n8n,
			api,
		}) => {
			const workflow = await api.workflows.createWorkflow({
				name: `Logs header actions ${nanoid()}`,
				nodes: [
					{
						id: nanoid(),
						name: 'Chat',
						type: '@n8n/n8n-nodes-langchain.chatTrigger',
						typeVersion: 1.3,
						position: [240, 300],
						parameters: { options: {} },
					},
					{
						id: nanoid(),
						name: 'Output',
						type: 'n8n-nodes-base.noOp',
						typeVersion: 1,
						position: [480, 300],
						parameters: {},
					},
				],
				connections: {
					Chat: { main: [[{ node: 'Output', type: 'main', index: 0 }]] },
				},
			});

			try {
				await n8n.start.fromExistingWorkflow(workflow.id);
				const logs = n8n.canvas.logsPanel;
				await logs.open();
				await logs.sendManualChatMessage('Check header spacing');
				await expect(logs.getOverviewStatus()).toContainText('Success in');
				await expect(logs.getSelectedLogEntry()).toContainText('Output');

				// Deselect the output so all three actions share the overview header.
				await logs.getSelectedLogEntry().click();
				await expect(logs.getSelectedLogEntry()).toHaveCount(0);
				await expect(logs.getClearExecutionButton()).toBeVisible();
				const buttons = logs.getOverviewHeaderButtons();
				await expect(buttons).toHaveCount(3);
				const resetSession = logs.getRefreshSessionButton();
				await expect(resetSession).toBeVisible();
				const resetSize = await resetSession.evaluate((button) => {
					const { width, height } = button.getBoundingClientRect();
					return { width, height };
				});

				// LIGO-507: Measure button boxes, not the space inside each button.
				for (const [index, name] of ['Clear execution', 'Actions', 'Collapse'].entries()) {
					await expect
						.soft(buttons.nth(index), `${name} must match the chat reset height`)
						.toHaveCSS('height', `${resetSize.height}px`);
				}
				for (const [index, name] of ['Actions', 'Collapse'].entries()) {
					const buttonIndex = index + 1;
					await buttons.nth(buttonIndex).hover();
					const layout = await buttons.evaluateAll((elements) =>
						elements.map((element) => {
							const { left, right, width } = element.getBoundingClientRect();
							return { left, right, width };
						}),
					);
					expect
						.soft(layout[buttonIndex].width, `${name} must match the chat reset width`)
						.toBe(resetSize.width);
					expect
						.soft(
							layout[buttonIndex].left - layout[index].right,
							`${name} must have a visible gap from the previous button on hover`,
						)
						.toBeGreaterThan(0);
				}
			} finally {
				await api.workflows.archive(workflow.id);
				await api.workflows.delete(workflow.id);
			}
		});
	},
);
