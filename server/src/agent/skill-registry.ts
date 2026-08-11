import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";

export type BuiltInAgentSkill = {
    id: string;
    name: string;
    description: string;
};

type SourceSkill = BuiltInAgentSkill & { directory: string };

export function listBuiltInAgentSkills() {
    return readSourceSkills().map(({ directory: _directory, ...skill }) => skill);
}

export function getBuiltInAgentSkill(id: string) {
    return listBuiltInAgentSkills().find((skill) => skill.id === id);
}

export function syncBuiltInAgentSkills(workspace: string) {
    const skills = readSourceSkills();
    const targetRoot = resolve(workspace, ".claude", "skills");
    const expected = new Set(skills.map((skill) => skill.id));
    mkdirSync(targetRoot, { recursive: true });
    for (const entry of readdirSync(targetRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !expected.has(entry.name)) rmSync(resolve(targetRoot, entry.name), { recursive: true, force: true });
    }
    for (const skill of skills) {
        const target = resolve(targetRoot, skill.id);
        rmSync(target, { recursive: true, force: true });
        cpSync(skill.directory, target, { recursive: true, force: true, dereference: true });
    }
    return skills.map((skill) => skill.id);
}

function readSourceSkills(): SourceSkill[] {
    return readdirSync(config.agentSkillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const directory = resolve(config.agentSkillsDir, entry.name);
            const source = readFileSync(resolve(directory, "SKILL.md"), "utf8");
            const metadata = parseSkillMetadata(source);
            if (metadata.id !== entry.name) throw new Error(`Skill 目录名必须与 SKILL.md name 一致：${entry.name}`);
            return { ...metadata, directory };
        })
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function parseSkillMetadata(source: string): BuiltInAgentSkill {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error("SKILL.md 缺少 YAML frontmatter");
    const fields = new Map<string, string>();
    for (const line of match[1].split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator >= 0) fields.set(line.slice(0, separator).trim(), unquote(line.slice(separator + 1).trim()));
    }
    const id = fields.get("name") || "";
    const description = fields.get("description") || "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !description) throw new Error("SKILL.md 的 name 或 description 无效");
    const displayName = source.slice(match[0].length).match(/^#\s+(.+)$/m)?.[1]?.trim();
    return { id, name: displayName || id, description };
}

function unquote(value: string) {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
    return value;
}
