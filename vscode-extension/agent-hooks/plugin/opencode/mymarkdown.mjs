// The label hook as an OpenCode plugin, for both API generations: 1.x calls server() for a
// hooks object, 2.x calls setup(ctx). Either way a write runs the same hook script with a
// Claude-shaped payload and the nudge is appended to the tool result the model reads, and the
// skill folder is registered so the model can open it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(here, "..", "hooks", "markdown-labels.cjs");
const SKILLS = path.resolve(here, "..", "skills");
// OpenCode's tool names, and the payload each becomes: write/edit carry a path, patches text.
const WRITES = { write: "Write", edit: "Edit", apply_patch: "apply_patch", patch: "apply_patch" };

/** The hook's nudge for one tool call, or "" when there is nothing to say. */
function nudge(tool, args, cwd) {
  const name = WRITES[tool];
  if (!name || !args || typeof args !== "object") return Promise.resolve("");
  const tool_input = name === "apply_patch" ? { input: args.patchText } : { file_path: args.filePath ?? args.path };
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(process.execPath.includes("node") ? process.execPath : "node", [HOOK], { cwd, stdio: ["pipe", "pipe", "ignore"] });
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out).hookSpecificOutput?.additionalContext ?? "");
      } catch {
        resolve("");
      }
    });
    child.on("error", () => resolve(""));
    child.stdin.end(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: name, tool_input, cwd }));
  });
}

/** Every skill in the plugin, in the shape 2.x's editor takes. */
function skills() {
  return fs.readdirSync(SKILLS).flatMap((id) => {
    const file = path.join(SKILLS, id, "SKILL.md");
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    const description = match && /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim();
    return [{ id, name: id, ...(description && { description }), path: file, content: match ? match[2] : text }];
  });
}

async function server({ directory, worktree }) {
  const cwd = worktree || directory;
  return {
    config: async (config) => {
      config.skills ??= {};
      config.skills.paths ??= [];
      if (!config.skills.paths.includes(SKILLS)) config.skills.paths.push(SKILLS);
    },
    "tool.execute.after": async (input, output) => {
      const note = await nudge(input.tool, input.args, cwd);
      if (note) output.output = `${output.output ?? ""}\n\n${note}`;
    },
  };
}

async function setup(ctx) {
  if (!ctx?.tool?.hook || !ctx.skill?.transform) return; // 1.x calls setup too, with its own ctx
  const cwd = ctx.location?.directory;
  await ctx.skill.transform((editor) => {
    for (const skill of skills()) {
      try {
        editor.add(skill);
      } catch {
        // A skill the host rejects must not take the hook down with it.
      }
    }
  });
  await ctx.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return;
    const note = await nudge(event.tool, event.input, cwd);
    if (!note) return;
    const content = event.result?.content;
    event.result = {
      ...event.result,
      content: Array.isArray(content) ? [...content, { type: "text", text: note }] : `${content ?? ""}\n\n${note}`,
    };
  });
}

export default { id: "mymarkdown", server, setup };
