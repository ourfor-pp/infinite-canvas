import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import matter from "gray-matter";
import { config } from "../config.js";

export type BuiltInAgentSkill = {
    id: string;
    name: string;
    description: string;
};

type SourceSkill = BuiltInAgentSkill & { directory: string; allowedTools: string[] };

export function listBuiltInAgentSkills(skillIds?: readonly string[]) {
    return selectSkills(skillIds).map(({ directory: _directory, allowedTools: _allowedTools, ...skill }) => skill);
}

export function getBuiltInAgentSkill(id: string) {
    const skill = readSourceSkills().find((item) => item.id === id);
    if (!skill) return undefined;
    const { directory: _directory, allowedTools: _allowedTools, ...metadata } = skill;
    return metadata;
}

export function syncBuiltInAgentSkills(workspace: string, skillIds: readonly string[], engine: "builtin" | "codex" = "builtin") {
    const skills = selectSkills(skillIds);
    const targetRoot = resolve(workspace, engine === "codex" ? ".agents" : ".claude", "skills");
    const digest = createHash("sha256").update(engine).update("skill-sync-v2");
    skills.forEach((skill) => { digest.update(skill.id); hashDirectory(digest, skill.directory); });
    const hash = digest.digest("hex");
    const result = () => ({ skills: skills.map((skill) => skill.id), allowedTools: resolveAllowedTools(skills, targetRoot) });
    if (existsSync(resolve(targetRoot, ".content-hash")) && readFileSync(resolve(targetRoot, ".content-hash"), "utf8") === hash) return result();
    const parent = resolve(targetRoot, "..");
    const temporary = resolve(parent, `.skills-next-${randomUUID()}`);
    const previous = resolve(parent, `.skills-previous-${randomUUID()}`);
    mkdirSync(temporary, { recursive: true });
    for (const skill of skills) {
        cpSync(skill.directory, resolve(temporary, skill.id), { recursive: true, force: true, dereference: true });
        if (engine === "codex") {
            const path = resolve(temporary, skill.id, "SKILL.md");
            writeFileSync(path, codexSkillContent(readFileSync(path, "utf8")), "utf8");
        }
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

export function validateBuiltInAgentSkills(skillIds: readonly string[], autoAllowedTools: readonly string[]) {
    const skills = selectSkills(skillIds);
    const allowed = new Set(autoAllowedTools);
    for (const skill of skills) {
        const invalid = skill.allowedTools.filter((tool) => !allowed.has(tool));
        if (invalid.length) throw new Error(`Skill ${skill.id} 声明了当前场景不可自动执行的工具：${invalid.join("、")}`);
    }
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
    return findSkillDirectories(config.agentSkillsDir)
        .map((directory) => {
            const source = readFileSync(resolve(directory, "SKILL.md"), "utf8");
            const metadata = parseSkillMetadata(source);
            if (metadata.id !== basename(directory)) throw new Error(`Skill 目录名必须与 SKILL.md name 一致：${basename(directory)}`);
            return { ...metadata, directory, allowedTools: parseSkillAllowedTools(source) };
        })
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function findSkillDirectories(root: string): string[] {
    if (existsSync(resolve(root, "SKILL.md"))) return [root];
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => findSkillDirectories(resolve(root, entry.name)));
}

function selectSkills(skillIds?: readonly string[]) {
    const skills = readSourceSkills();
    if (!skillIds) return skills;
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    const missing = skillIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`Agent 场景引用了不存在的 Skill：${missing.join("、")}`);
    return skillIds.map((id) => byId.get(id)!);
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

export function codexSkillContent(source: string) {
    const parsed = matter(source);
    delete parsed.data["allowed-tools"];
    const body = parsed.content.replace(/\b(?:Read|Write|Edit|Glob|Grep|LS)\b/g, "工程文件工具");
    return matter.stringify(body, parsed.data);
}
