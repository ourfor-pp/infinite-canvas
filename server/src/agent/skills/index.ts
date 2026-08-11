export type BuiltInAgentSkill = {
    id: string;
    name: string;
    description: string;
    instructions: string;
};

const skills: readonly BuiltInAgentSkill[] = [];

export function listBuiltInAgentSkills() {
    return skills.map((skill) => ({ ...skill }));
}

export function getBuiltInAgentSkill(id: string) {
    return skills.find((skill) => skill.id === id);
}
