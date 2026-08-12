import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";

export type BuiltInAgentSkill = {
    id: string;
    name: string;
    description: string;
};

type SourceSkill = BuiltInAgentSkill & { directory: string; allowedTools: string[] };

export function listBuiltInAgentSkills() {
    return readSourceSkills().map(({ directory: _directory, allowedTools: _allowedTools, ...skill }) => skill);
}

export function getBuiltInAgentSkill(id: string) {
    return listBuiltInAgentSkills().find((skill) => skill.id === id);
}

export function syncBuiltInAgentSkills(workspace: string) {
    const skills = readSourceSkills();
    const targetRoot = resolve(workspace, ".claude", "skills");
    const digest = createHash("sha256");
    skills.forEach((skill) => hashDirectory(digest, skill.directory));
    const hash = digest.digest("hex");
    const result = () => ({ skills: skills.map((skill) => skill.id), allowedTools: resolveAllowedTools(skills, targetRoot) });
    if (existsSync(resolve(targetRoot, ".content-hash")) && readFileSync(resolve(targetRoot, ".content-hash"), "utf8") === hash) return result();
    const parent = resolve(targetRoot, "..");
    const temporary = resolve(parent, `.skills-next-${randomUUID()}`);
    const previous = resolve(parent, `.skills-previous-${randomUUID()}`);
    mkdirSync(temporary, { recursive: true });
    for (const skill of skills) {
        cpSync(skill.directory, resolve(temporary, skill.id), { recursive: true, force: true, dereference: true });
    }
    writeFileSync(resolve(temporary, ".content-hash"), hash, "utf8");
    try {
        if (existsSync(targetRoot)) renameSync(targetRoot, previous);
        renameSync(temporary, targetRoot);
        rmSync(previous, { recursive: true, force: true });
    } catch (error) {
        if (!existsSync(targetRoot) && existsSync(previous)) renameSync(previous, targetRoot);
        throw error;
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
    return result();
}

function hashDirectory(hash: ReturnType<typeof createHash>, directory: string, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        const path = resolve(directory, entry.name);
        const name = `${prefix}/${entry.name}`;
        hash.update(name);
        if (entry.isDirectory()) hashDirectory(hash, path, name);
        else if (statSync(path).isFile()) hash.update(readFileSync(path));
    }
}

function readSourceSkills(): SourceSkill[] {
    return readdirSync(config.agentSkillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const directory = resolve(config.agentSkillsDir, entry.name);
            const source = readFileSync(resolve(directory, "SKILL.md"), "utf8");
            const metadata = parseSkillMetadata(source);
            if (metadata.id !== entry.name) throw new Error(`Skill 目录名必须与 SKILL.md name 一致：${entry.name}`);
            return { ...metadata, directory, allowedTools: parseSkillAllowedTools(source) };
        })
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function parseSkillAllowedTools(source: string) {
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || "";
    const lines = frontmatter.split(/\r?\n/);
    const index = lines.findIndex((line) => /^allowed-tools\s*:/i.test(line));
    if (index < 0) return [];
    const inline = lines[index].replace(/^allowed-tools\s*:\s*/i, "").trim();
    const values = inline ? (inline.startsWith("[") && inline.endsWith("]") ? inline.slice(1, -1).split(",") : inline.split(/\s+/)) : [];
    if (!inline) {
        for (const line of lines.slice(index + 1)) {
            if (!/^\s+/.test(line)) break;
            const item = line.match(/^\s*-\s*(.+?)\s*$/)?.[1];
            if (item) values.push(item);
        }
    }
    return Array.from(new Set(values.map((value) => unquote(value.trim())).filter((value) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(value))));
}

function resolveAllowedTools(skills: SourceSkill[], targetRoot: string) {
    return Array.from(new Set(skills.flatMap((skill) => skill.allowedTools.map((name) => name.replaceAll("${CLAUDE_SKILL_DIR}", resolve(targetRoot, skill.id))))));
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
