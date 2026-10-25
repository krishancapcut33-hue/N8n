import { createTestingPinia } from '@pinia/testing';
import { fireEvent } from '@testing-library/vue';
import { nextTick } from 'vue';

import { createComponentRenderer } from '@/__tests__/render';

import { ASSISTANT_AGENT_PROJECT_ID } from '../assistantAgentThreads';
import AssistantConfirmationCard from '../AssistantConfirmationCard.vue';
import type { AssistantConfirmationInput } from '../assistantConfirmation';

const push = vi.hoisted(() => ({
	listeners: [] as Array<(event: { type: string; data: Record<string, unknown> }) => void>,
}));

vi.mock('@/app/stores/pushConnection.store', () => ({
	usePushConnectionStore: () => ({
		addEventListener: (listener: (typeof push.listeners)[number]) => {
			push.listeners.push(listener);
			return () => {
				push.listeners = push.listeners.filter((l) => l !== listener);
			};
		},
	}),
}));

vi.mock('../../components/InstanceAiMcpConnectCard.vue', () => ({
	default: {
		props: ['servers', 'readOnly'],
		emits: ['resolve'],
		template:
			'<button data-test-id="stub-mcp-connect" @click="$emit(\'resolve\', { approved: true, connectedSlugs: [\'linear\'] })" />',
	},
}));

// The setup cards pull in many stores. These stubs check that the card hands them
// its submit callback and the project, and forwards what they send.
function submitStub(testId: string, body: Record<string, unknown>) {
	return {
		default: {
			props: ['submit', 'projectId'],
			template: `<button data-test-id="${testId}" :data-project-id="projectId" @click="submit(${JSON.stringify(body).replace(/"/g, "'")})" />`,
		},
	};
}

vi.mock('../../components/InstanceAiCredentialSetup.vue', () =>
	submitStub('stub-credential-setup', {
		kind: 'credentialSelection',
		credentials: { slackApi: 'cred-1' },
	}),
);
vi.mock('../../workflowSetup/InstanceAiWorkflowSetup.vue', () =>
	submitStub('stub-workflow-setup', { kind: 'approval', approved: false }),
);
vi.mock('../../components/InstanceAiChannelSetup.vue', () =>
	submitStub('stub-channel-setup', { kind: 'approval', approved: true }),
);

vi.mock('../../components/InstanceAiQuestions.vue', () => ({
	default: {
		props: ['questions', 'introMessage', 'disabled'],
		emits: ['submit'],
		template:
			"<button data-test-id=\"stub-questions\" @click=\"$emit('submit', [{ questionId: 'q1', question: 'Which?', selectedOptions: ['a'] }])\" />",
	},
}));

const renderComponent = createComponentRenderer(AssistantConfirmationCard, {
	pinia: createTestingPinia(),
});

describe('AssistantConfirmationCard', () => {
	beforeEach(() => {
		push.listeners = [];
	});

	it('submits the answers of a questions card', async () => {
		const { getByTestId, emitted } = renderComponent({
			props: {
				input: {
					requestId: 'req-q',
					message: 'A few questions',
					inputType: 'questions',
					questions: [{ id: 'q1', question: 'Which?', type: 'single', options: ['a', 'b'] }],
				},
			},
		});

		await fireEvent.click(getByTestId('assistant-agent-questions'));

		expect(emitted().submit).toEqual([
			[{ kind: 'questions', answers: [{ questionId: 'q1', selectedOptions: ['a'] }] }],
		]);
	});

	it('submits domain access through the resume data, not a thread', async () => {
		const { getByTestId, emitted } = renderComponent({
			props: {
				input: {
					requestId: 'req-1',
					message: 'Allow access?',
					domainAccess: { url: 'https://example.com/a', host: 'example.com' },
				},
			},
		});

		await fireEvent.click(getByTestId('domain-access-allow-once'));

		expect(emitted().submit).toEqual([
			[{ kind: 'domainAccessApprove', domainAccessAction: 'allow_once' }],
		]);
	});

	describe('a sent answer', () => {
		const continueInput = { requestId: 'req-2', message: 'Paused', inputType: 'continue' as const };

		it('submits the continue card as an approval, once while the chat sends it', async () => {
			const { getByTestId, emitted, rerender } = renderComponent({
				props: { input: continueInput },
			});

			await fireEvent.click(getByTestId('assistant-agent-continue'));
			// The chat marks the card resolved while it sends the answer.
			await rerender({ input: continueInput, disabled: true });
			await fireEvent.click(getByTestId('assistant-agent-continue'));

			expect(emitted().submit).toEqual([[{ kind: 'approval', approved: true }]]);
		});

		it('can be answered again when the chat is busy and refuses the answer', async () => {
			const { getByTestId, emitted } = renderComponent({ props: { input: continueInput } });

			await fireEvent.click(getByTestId('assistant-agent-continue'));
			await nextTick();

			expect(getByTestId('assistant-agent-continue')).toBeEnabled();
			await fireEvent.click(getByTestId('assistant-agent-continue'));
			expect(emitted().submit).toHaveLength(2);
		});

		it('resets the inner card when the chat refuses the answer', async () => {
			const questionsInput = {
				requestId: 'req-q2',
				message: 'A few questions',
				inputType: 'questions' as const,
				questions: [{ id: 'q1', question: 'Which?', type: 'single' as const, options: ['a', 'b'] }],
			};
			const { getByTestId, emitted } = renderComponent({ props: { input: questionsInput } });
			const firstQuestions = getByTestId('assistant-agent-questions');

			// The chat is busy: it keeps the card, so the inner card remounts with no answer.
			await fireEvent.click(firstQuestions);
			await nextTick();

			const secondQuestions = getByTestId('assistant-agent-questions');
			expect(secondQuestions).not.toBe(firstQuestions);
			await fireEvent.click(secondQuestions);
			expect(emitted().submit).toHaveLength(2);
		});
	});

	it('submits the typed answer of a text card', async () => {
		const { getByTestId, getByPlaceholderText, emitted } = renderComponent({
			props: { input: { requestId: 'req-t', message: 'What is the channel?', inputType: 'text' } },
		});

		await fireEvent.update(getByPlaceholderText('Type your answer...'), '#general');
		await fireEvent.click(getByTestId('assistant-agent-text-submit'));

		expect(emitted().submit).toEqual([
			[{ kind: 'approval', approved: true, userInput: '#general' }],
		]);
	});

	it('offers always allow for a scoped tool and submits a session approval', async () => {
		const { getByTestId, emitted } = renderComponent({
			props: {
				input: {
					requestId: 'req-aa',
					message: 'Run the workflow',
					severity: 'info',
					toolName: 'workflow_builder_executions',
					args: { action: 'run', workflowId: 'wf-1' },
				},
			},
		});

		await fireEvent.click(getByTestId('approval-card-always-allow'));

		expect(emitted().submit).toEqual([[{ kind: 'approval', approved: true, scope: 'session' }]]);
	});

	it('titles a plain approval with the tool phrase and shows the details, not the raw arguments', () => {
		const { getByTestId } = renderComponent({
			props: {
				input: {
					requestId: 'req-run',
					message: 'Run this workflow live',
					severity: 'warning',
					toolName: 'workflow_builder_executions',
					args: { action: 'run', workflowId: 'wf-1' },
					resourceName: 'Daily weather',
					approvalDetails: { action: 'run-workflow', summary: 'Fetch the forecast' },
				},
			},
		});

		const card = getByTestId('assistant-agent-approval');
		expect(card).toHaveTextContent('Assistant wants to run Daily weather');
		expect(card).toHaveTextContent('Fetch the forecast');
		expect(card).not.toHaveTextContent('workflowId');
	});

	it('does not offer always allow for a destructive action', () => {
		const { queryByTestId } = renderComponent({
			props: {
				input: {
					requestId: 'req-d',
					message: 'Delete the workflow',
					severity: 'destructive',
					toolName: 'workflow_builder_workflows',
					args: { action: 'delete', workflowId: 'wf-1' },
				},
			},
		});

		expect(queryByTestId('approval-card-always-allow')).not.toBeInTheDocument();
	});

	it('submits the MCP connect card as an mcpConnect body', async () => {
		const { getByTestId, emitted } = renderComponent({
			props: {
				input: {
					requestId: 'req-7',
					message: 'Connect tools',
					mcpConnectRequest: { servers: [] },
				},
			},
		});

		await fireEvent.click(getByTestId('assistant-agent-mcp-connect'));

		expect(emitted().submit).toEqual([
			[{ kind: 'mcpConnect', approved: true, connectedSlugs: ['linear'] }],
		]);
	});

	it('submits the credential destination decision with its origin', async () => {
		const { getByText, emitted } = renderComponent({
			props: {
				input: {
					requestId: 'req-10',
					message: 'Send credential',
					credentialDestination: { origin: 'https://api.example.com', nodeNames: ['HTTP Request'] },
				},
			},
		});

		await fireEvent.click(getByText('Use destination'));

		expect(emitted().submit).toEqual([
			[{ kind: 'credentialDestination', approved: true, origin: 'https://api.example.com' }],
		]);
	});

	it('shows a plan review as not available, without actions', () => {
		const { getByTestId, queryByRole } = renderComponent({
			props: {
				input: { requestId: 'req-u', message: 'Review the plan', inputType: 'plan-review' },
			},
		});

		expect(getByTestId('assistant-agent-unsupported-card')).toHaveTextContent('Review the plan');
		expect(queryByRole('button')).not.toBeInTheDocument();
	});

	// Minimal payloads: the card only needs each field to choose its setup variant.
	it.each<[string, string, Record<string, unknown>, Record<string, unknown>]>([
		[
			'workflow setup',
			'stub-workflow-setup',
			{ setupRequests: [{ id: 'x' }] },
			{ kind: 'approval', approved: false },
		],
		[
			'credential setup',
			'stub-credential-setup',
			{ credentialRequests: [{ credentialType: 'slackApi' }] },
			{ kind: 'credentialSelection', credentials: { slackApi: 'cred-1' } },
		],
		[
			'channel setup',
			'stub-channel-setup',
			{ channelConfig: { integrationType: 'slack', agentId: 'agent-1' } },
			{ kind: 'approval', approved: true },
		],
	])(
		'submits %s through the resume data, in the thread project',
		async (_name, testId, fields, body) => {
			const input = { requestId: 'req-s', message: 'Set up Slack', ...fields };
			const { getByTestId, emitted } = renderComponent({
				props: { input: input as AssistantConfirmationInput },
				global: { provide: { [ASSISTANT_AGENT_PROJECT_ID as symbol]: 'project-thread' } },
			});

			expect(getByTestId(testId)).toHaveAttribute('data-project-id', 'project-thread');
			await fireEvent.click(getByTestId(testId));

			expect(emitted().submit).toEqual([[body]]);
		},
	);

	it('submits a gateway resource decision', async () => {
		const { getByTestId, emitted } = renderComponent({
			props: {
				input: {
					requestId: 'req-9',
					message: 'Read a file',
					inputType: 'resource-decision',
					resourceDecision: {
						toolGroup: 'filesystem',
						resource: '/tmp/a.txt',
						description: 'Read /tmp/a.txt',
						options: ['denyOnce', 'allowOnce', 'allowForSession'],
					},
				},
			},
		});

		await fireEvent.click(getByTestId('gateway-decision-deny'));

		expect(emitted().submit).toEqual([
			[{ kind: 'resourceDecision', resourceDecision: 'denyOnce' }],
		]);
	});

	describe('test listener', () => {
		const testListenerInput = {
			requestId: 'req-11',
			message: 'Send a test request',
			testListener: {
				workflowId: 'wf-1',
				deadlineAt: new Date().toISOString(),
				triggers: [{ nodeName: 'Webhook', method: 'POST', url: 'https://n8n.test/webhook-test/a' }],
			},
		};

		it('submits a cancel as a denied approval', async () => {
			const { getByTestId, emitted } = renderComponent({ props: { input: testListenerInput } });

			await fireEvent.click(getByTestId('assistant-agent-test-listener-cancel'));

			expect(emitted().submit).toEqual([[{ kind: 'approval', approved: false }]]);
		});

		it('settles from the test webhook push event of its workflow', () => {
			const { emitted } = renderComponent({ props: { input: testListenerInput } });

			for (const listener of push.listeners) {
				listener({ type: 'testWebhookReceived', data: { workflowId: 'other', executionId: 'x' } });
				listener({ type: 'testWebhookReceived', data: { workflowId: 'wf-1', executionId: 'e-1' } });
			}

			expect(emitted().submit).toEqual([[{ kind: 'approval', approved: true, userInput: 'e-1' }]]);
		});
	});
});
