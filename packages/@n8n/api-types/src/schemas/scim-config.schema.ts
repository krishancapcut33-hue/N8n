import { z } from 'zod';

import type { ProjectIcon } from './project.schema';

/**
 * What n8n does when the identity provider deletes a user.
 * - `disable`: deactivate the user and keep the user's work.
 * - `delete`: delete the user. `dataAction` tells what happens to the work.
 *   An admin is only deactivated and keeps their work. The instance owner is
 *   never deactivated or deleted.
 */
export const scimOnDeleteSchema = z.enum(['disable', 'delete']);

/**
 * What happens to the work of a user that SCIM deletes.
 * - `transfer`: move the workflows and credentials to the transfer target.
 * - `delete`: delete them together with the personal project of the user.
 */
export const scimDataActionSchema = z.enum(['transfer', 'delete']);

/** How n8n applies `DELETE /scim/v2/Users/:id`. */
export const scimDeprovisioningPolicySchema = z.object({
	onDelete: scimOnDeleteSchema,
	dataAction: scimDataActionSchema,
	/**
	 * The project that gets the work of a deleted user. Null sends the work to
	 * the personal project of the instance owner.
	 */
	transferProjectId: z.string().min(1).nullable(),
});

export type ScimDeprovisioningPolicy = z.infer<typeof scimDeprovisioningPolicySchema>;

/** The stored transfer target, as the SCIM settings page shows it. */
export type ScimTransferTarget = {
	projectId: string;
	/**
	 * `person` is the personal project of a user. `project` is a team project.
	 * Null when the project no longer exists.
	 */
	kind: 'person' | 'project' | null;
	/** Full name of the person, or the project name. Null when the project no longer exists. */
	name: string | null;
	/** Only for `person`. */
	email?: string;
	/** Only for `project`. */
	icon?: ProjectIcon | null;
	/**
	 * False when the project no longer exists or the person is deactivated.
	 * SCIM DELETE then sends the work to the personal project of the owner.
	 */
	valid: boolean;
};

/**
 * A section of the transfer target picker.
 * - `people`: the personal projects of active users.
 * - `projects`: the team projects.
 */
export const scimTransferTargetTypeSchema = z.enum(['people', 'projects']);

/** A person in the transfer target picker: the personal project of an active user. */
export type ScimTransferTargetPerson = {
	projectId: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	/** Slug of the global role, for example `global:admin`. */
	role: string;
};

/** A team project in the transfer target picker. */
export type ScimTransferTargetProject = {
	projectId: string;
	name: string;
	icon: ProjectIcon | null;
	/** Number of users with a role in the project. */
	memberCount: number;
	/** Number of workflows that the project owns, archived workflows excluded. */
	workflowCount: number;
};

type ScimTransferTargetSection<Item> = {
	/** Number of valid targets in this section that match the search. */
	total: number;
	/** One page of the matches. */
	items: Item[];
};

/**
 * Response of `GET /rest/scim/transfer-targets`. Every item is a valid
 * transfer target for the SCIM deprovisioning policy.
 *
 * People come in this order: the owner, the admins, then every other role.
 * Each group is sorted by name. Projects are sorted by name.
 */
export type ScimTransferTargetsResponse = {
	/** Absent when the request asks for `projects` only. */
	people?: ScimTransferTargetSection<ScimTransferTargetPerson>;
	/** Absent when the request asks for `people` only. */
	projects?: ScimTransferTargetSection<ScimTransferTargetProject>;
};

/** Response of `GET /rest/scim/config`. */
export type ScimConfigResponse = {
	enabled: boolean;
	hasToken: boolean;
	/** Last four characters of the token, or null without a token. */
	tokenHint: string | null;
	baseUrl: string;
	onDelete: ScimDeprovisioningPolicy['onDelete'];
	dataAction: ScimDeprovisioningPolicy['dataAction'];
	/**
	 * Null when no target is stored. SCIM DELETE then sends the work to the
	 * personal project of the owner.
	 */
	transferTarget: ScimTransferTarget | null;
};
