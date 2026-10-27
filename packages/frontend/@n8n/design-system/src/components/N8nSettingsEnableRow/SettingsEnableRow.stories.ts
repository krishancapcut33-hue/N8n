import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';

import N8nSettingsEnableRow from './SettingsEnableRow.vue';
import N8nSettingsRowGroup from '../N8nSettingsRowGroup';

const meta = {
	title: 'Areas/Settings/EnableRow',
	component: N8nSettingsEnableRow,
	parameters: {
		docs: {
			description: {
				component:
					"The enable control for a settings feature. It renders the title, the description, and the switch. Pass a `feature` id and `show-badges` to render that feature's badges beside the title. The row reads the feature list and the instance plan.",
			},
		},
	},
} satisfies Meta<typeof N8nSettingsEnableRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: (args) => ({
		components: { N8nSettingsEnableRow, N8nSettingsRowGroup },
		setup: () => {
			const enabled = ref(false);
			return { args, enabled };
		},
		template: `
			<div style="max-width: 45rem;">
				<N8nSettingsRowGroup>
					<N8nSettingsEnableRow v-bind="args" v-model="enabled" />
				</N8nSettingsRowGroup>
			</div>
		`,
	}),
	args: {
		title: 'Enable Agents',
		description:
			'Allow users to build and run agents. Turning this off blocks new runs and cancels pending messages.',
		feature: 'agents',
		showBadges: true,
		maxDescriptionLines: 3,
	},
};
