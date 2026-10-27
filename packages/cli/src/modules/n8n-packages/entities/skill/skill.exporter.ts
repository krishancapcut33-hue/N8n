import type { User } from '@n8n/db';
import { Service } from '@n8n/di';

import { SkillService, skillScopeOf, toAgentSkill } from '@/modules/skills/skill.service';
import type { ResolvedSkillRow } from '@/modules/skills/skill.repository';

import { projectScopedDirectory, writeManifestEntry } from '../../io/manifest-entry';
import type { PackageWriter } from '../../io/package-writer';
import type { ManifestEntry } from '../../spec/manifest.schema';
import { serializedSkillSchema, type SerializedSkill } from '../../spec/serialized/skill.schema';
import { PackageExportBlockedError } from '../package-export.errors';

export interface SkillExportRequest {
	user: User;
	writer: PackageWriter;
	/** The exported Agents and the skills they reference. */
	agents: Array<{ agentId: string; projectId: string; skillIds: string[] }>;
	/** Project package targets. Without them, every skill goes to the top-level `skills/`. */
	projectTargetsById?: Map<string, string>;
}

/** Writes the latest version of every skill that the exported Agents reference, once each. */
@Service()
export class SkillExporter {
	constructor(private readonly skillService: SkillService) {}

	async export(request: SkillExportRequest): Promise<ManifestEntry[]> {
		const skillIds = [...new Set(request.agents.flatMap(({ skillIds: ids }) => ids))];
		if (skillIds.length === 0) return [];
		const projectOfAgent = new Map(request.agents.map((agent) => [agent.agentId, agent.projectId]));
		const rows = await this.skillService.findLatest(skillIds);
		const canRead = await this.skillService.accessCheck(request.user, 'read');
		const entries: ManifestEntry[] = [];
		for (const id of skillIds) {
			const row = rows.get(id);
			if (!row) {
				throw new PackageExportBlockedError(`Skill "${id}" does not exist. Export aborted.`);
			}
			const ownerProjectId =
				row.skill.projectId ?? projectOfAgent.get(row.skill.agentId ?? '') ?? undefined;
			if (!canRead(row.skill, ownerProjectId ?? null)) {
				throw new PackageExportBlockedError(
					`You cannot read skill "${row.version.name}" (${id}). Export aborted.`,
				);
			}
			const directory = projectScopedDirectory(
				'skills',
				ownerProjectId,
				request.projectTargetsById,
			);
			entries.push(
				await writeManifestEntry(
					request.writer,
					'skills',
					directory,
					{ id, name: row.version.name },
					serializeSkill(row),
				),
			);
		}
		return entries;
	}
}

function serializeSkill(row: ResolvedSkillRow): SerializedSkill {
	const { agentId } = row.skill;
	return serializedSkillSchema.parse({
		id: row.skill.id,
		scope: skillScopeOf(row.skill),
		...(agentId ? { agentId } : {}),
		skill: toAgentSkill(row),
		frontmatter: row.version.frontmatter,
	});
}
