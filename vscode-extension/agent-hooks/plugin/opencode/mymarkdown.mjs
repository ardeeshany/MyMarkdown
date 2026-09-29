// The label hook as an OpenCode plugin, for both API generations: 1.x (the opencode-ai package)
// calls server() for a hooks object, 2.x (@opencode/cli, with the @opencode/plugin API) calls
// setup(ctx). Either way a write runs the same hook script with a Claude-shaped payload and the
// nudge is appended to the tool result the model reads, and the skill folder is registered so
// the model can open it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(here, "..", "hooks", "markdown-labels.cjs");
const SKILLS = path.resolve(here, "..", "skills");
// OpenCode's tool names, and the payload each becomes. 1.x: write/edit take {filePath},
// apply_patch {patchText}; 2.x: write/edit take {path}, patch {patchText}.
const WRITES = { write: "Write", edit: "Edit", apply_patch: "apply_patch", patch: "apply_patch" };
// The other agents' project variables, each of which the hook prefers over the payload's cwd.
const PROJECT_VARS = ["CLAUDE_PROJECT_DIR", "QODER_PROJECT_DIR", "DEVIN_PROJECT_DIR", "COPILOT_PROJECT_DIR", "AUGMENT_PROJECT_DIR", "CURSOR_PROJECT_DIR"];

/** The hook's nudge for one tool call, or "" when there is nothing to say. */
function nudge(tool, args, cwd) {
  const name = WRITES[tool];
  if (!name || !args || typeof args !== "object") return Promise.resolve("");
  const tool_input = name === "apply_patch" ? { input: args.patchText } : { file_path: args.filePath ?? args.path };
  return new Promise((resolve) => {
    let out = "";
    // Bun-compiled OpenCode and npm-installed OpenCode (opencode-linux-x64/bin/opencode) both
    // have an execPath that is not Node but whose full path can still contain the substring
    // "node" (e.g. under node_modules); check the binary's own basename, and fall back to the
    // "node" on PATH, so we never spawn OpenCode itself with the hook as its argument.
    const node = /^node(\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : "node";
    // A hook that never exits must not leave the tool call pending forever; every other host
    // runs this hook with the same 15 s timeout, and Node kills the child and fires "close".
    // The hook takes the project from the payload's cwd, so the spawn runs beside the hook: a
    // project folder must not be its working directory, since Windows looks a bare "node" up
    // there before PATH. An OpenCode started inside another agent's session inherits that
    // agent's project variable, which the hook would take over the directory OpenCode names.
    const env = { ...process.env };
    for (const key of PROJECT_VARS) delete env[key];
    const child = spawn(node, [HOOK], { cwd: path.dirname(HOOK), env, stdio: ["pipe", "pipe", "ignore"], timeout: 15000 });
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out).hookSpecificOutput?.additionalContext ?? "");
      } catch {
        resolve("");
      }
    });
    child.on("error", () => resolve(""));
    child.stdin.end(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: name, tool_input, cwd, agent: "opencode" }));
  });
}

/** Every skill in the plugin, in the shape 2.x's editor takes. */
function skills() {
  return fs.readdirSync(SKILLS).flatMap((id) => {
    const file = path.join(SKILLS, id, "SKILL.md");
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    const field = (key) => match && new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1])?.[1]?.trim();
    const description = field("description");
    // 2.x names a skill by its front matter, as its own loader does, and the folder otherwise.
    return [{ id, name: field("name") || id, ...(description && { description }), path: file, content: match ? match[2] : text }];
  });
}

async function server({ directory }) {
  // 1.x's write, edit and apply_patch resolve a relative path against the instance directory;
  // worktree is the git root, or "/" outside git, so a write from a subfolder would miss.
  const cwd = directory;
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
