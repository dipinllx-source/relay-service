/**
 * Claude Code / Codex / Gemini CLI / Droid CLI 教程「一键配置」脚本生成器。
 *
 * 与 OpenClaw 教程同一思路：页面里填一次 API Key，生成可整段粘贴执行的脚本。
 * 脚本主体统一交给 Node.js 执行（安装这些 CLI 的前提就是有 Node.js），
 * 这样三个平台共用同一份逻辑，只有外层包装不同：
 *   - macOS / Linux：node - <<'EOF' ... EOF
 *   - Windows PowerShell：@' ... '@ | node -
 *
 * 约束：
 * - 脚本内容保持纯 ASCII。Windows PowerShell 5.1 向原生程序管道传文本时默认按
 *   ASCII 编码，中文会变成 "?"；因此占位符用 YOUR_API_KEY，提示信息用英文。
 * - 只合并/更新本服务相关字段，保留用户已有配置；改动前把原文件备份为 *.bak。
 * - 外层不含 # 注释行（macOS zsh 默认未开启 interactive_comments）。
 */

export const SCRIPT_KEY_PLACEHOLDER = 'YOUR_API_KEY'

const js = (value) => JSON.stringify(value)

/** 把 Node 脚本包装成可直接粘贴执行的命令 */
export const wrapNodeScript = (platform, bodyLines) =>
  platform === 'windows'
    ? ["@'", ...bodyLines, "'@ | node -"]
    : ["node - <<'EOF'", ...bodyLines, 'EOF']

/** 各脚本共用的前导：API Key 校验、JSON 读写 */
const preamble = (apiKey) => [
  "const fs = require('fs'), path = require('path'), os = require('os');",
  `const KEY = ${js(apiKey || SCRIPT_KEY_PLACEHOLDER)};`,
  String.raw`if (KEY === 'YOUR_API_KEY' || !/^[\w.\-]+$/.test(KEY)) { console.error('Please replace YOUR_API_KEY with your API key, then run again.'); process.exit(1); }`,
  'const home = os.homedir();',
  "const readJson = (f) => { if (!fs.existsSync(f)) return {}; const t = fs.readFileSync(f, 'utf8').trim(); if (!t) return {}; fs.copyFileSync(f, f + '.bak'); try { return JSON.parse(t); } catch (e) { console.error('Cannot parse ' + f + ' as JSON. Fix or remove it, then run again.'); process.exit(1); } };",
  "const writeFile = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, { mode: 0o600 }); console.log('Updated ' + f); };",
  "const writeJson = (f, obj) => writeFile(f, JSON.stringify(obj, null, 2) + '\\n');"
]

/** Claude Code：写入 ~/.claude/settings.json 的 env，并跳过首次登录引导 */
export const buildClaudeCodeScript = (platform, { baseUrl, apiKey }) =>
  wrapNodeScript(platform, [
    ...preamble(apiKey),
    "const settingsFile = path.join(home, '.claude', 'settings.json');",
    'const settings = readJson(settingsFile);',
    `settings.env = Object.assign({}, settings.env, { ANTHROPIC_BASE_URL: ${js(baseUrl)}, ANTHROPIC_AUTH_TOKEN: KEY });`,
    'delete settings.env.ANTHROPIC_API_KEY;',
    'writeJson(settingsFile, settings);',
    "const stateFile = path.join(home, '.claude.json');",
    'const state = readJson(stateFile);',
    'state.hasCompletedOnboarding = true;',
    'writeJson(stateFile, state);'
  ])

/** Codex：更新 ~/.codex/config.toml 中 crs 相关项（保留其余配置）+ auth.json */
export const buildCodexScript = (platform, { baseUrl, apiKey, model }) => {
  const head = [
    'model_provider = "crs"',
    `model = ${js(model)}`,
    'disable_response_storage = true',
    'preferred_auth_method = "apikey"'
  ]
  const crs = [
    '[model_providers.crs]',
    'name = "crs"',
    `base_url = ${js(baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = true'
  ]
  return wrapNodeScript(platform, [
    ...preamble(apiKey),
    "const dir = process.env.CODEX_HOME || path.join(home, '.codex');",
    "const tomlFile = path.join(dir, 'config.toml');",
    "const old = fs.existsSync(tomlFile) ? fs.readFileSync(tomlFile, 'utf8') : '';",
    "if (old) fs.copyFileSync(tomlFile, tomlFile + '.bak');",
    'const top = [], rest = []; let section = null;',
    String.raw`for (const line of old.split(/\r?\n/)) { const m = line.match(/^\s*\[+([^\]]+)\]/); if (m) section = m[1].trim(); if (section === null) { if (!/^\s*(model_provider|model|disable_response_storage|preferred_auth_method)\s*=/.test(line)) top.push(line); } else if (section !== 'model_providers.crs') { rest.push(line); } }`,
    `const head = ${js(head)};`,
    `const crs = ${js(crs)};`,
    String.raw`const block = (a) => a.join('\n').trim();`,
    String.raw`writeFile(tomlFile, [block(head), block(top), block(rest), block(crs)].filter(Boolean).join('\n\n') + '\n');`,
    "const authFile = path.join(dir, 'auth.json');",
    'const auth = readJson(authFile);',
    'auth.OPENAI_API_KEY = KEY;',
    'writeJson(authFile, auth);'
  ])
}

/**
 * Gemini CLI：三个环境变量写成用户级环境变量，并在 settings.json 里选定 API Key 认证。
 *
 * 不写 ~/.gemini/.env：Gemini CLI 只在「受信任文件夹」里读取该文件，
 * 非交互（-p）或未信任的目录下会报 must specify the GEMINI_API_KEY。
 * macOS / Linux 写入 shell 配置文件中带标记的一段（重复执行只替换这一段），
 * Windows 用 setx 写入用户级环境变量。
 */
export const buildGeminiScript = (platform, { baseUrl, apiKey, model }) =>
  wrapNodeScript(platform, [
    ...preamble(apiKey),
    `const vars = { GOOGLE_GEMINI_BASE_URL: ${js(baseUrl)}, GEMINI_API_KEY: KEY, GEMINI_MODEL: ${js(model)} };`,
    "if (process.platform === 'win32') { for (const k of Object.keys(vars)) require('child_process').execFileSync('setx', [k, vars[k]], { stdio: 'ignore' }); console.log('Saved user environment variables. Open a new PowerShell window before running gemini.'); } else {",
    "const sh = process.env.SHELL || '';",
    "const rc = path.join(home, /zsh/.test(sh) || (!/bash/.test(sh) && process.platform === 'darwin') ? '.zshrc' : '.bashrc');",
    "const begin = '# >>> relay-service gemini-cli >>>', end = '# <<< relay-service gemini-cli <<<';",
    "let text = fs.existsSync(rc) ? fs.readFileSync(rc, 'utf8') : '';",
    "if (text) fs.copyFileSync(rc, rc + '.bak');",
    'const from = text.indexOf(begin), to = text.indexOf(end);',
    'if (from !== -1 && to > from) text = text.slice(0, from) + text.slice(to + end.length);',
    String.raw`const block = [begin].concat(Object.keys(vars).map((k) => 'export ' + k + "='" + vars[k] + "'"), [end]).join('\n');`,
    String.raw`writeFile(rc, text.replace(/\s*$/, '') + (text.trim() ? '\n\n' : '') + block + '\n');`,
    "console.log('Open a new terminal, or run: source ' + rc); }",
    "const settingsFile = path.join(home, '.gemini', 'settings.json');",
    'const settings = readJson(settingsFile);',
    'settings.security = Object.assign({}, settings.security);',
    "settings.security.auth = Object.assign({}, settings.security.auth, { selectedType: 'gemini-api-key' });",
    'writeJson(settingsFile, settings);'
  ])

/** Droid CLI：在 ~/.factory/settings.json 的 customModels 中按 model+baseUrl 更新 */
export const buildDroidScript = (platform, { models, apiKey }) =>
  wrapNodeScript(platform, [
    ...preamble(apiKey),
    "const settingsFile = path.join(home, '.factory', 'settings.json');",
    'const settings = readJson(settingsFile);',
    `const mine = ${js(models)}.map((m) => Object.assign(m, { apiKey: KEY }));`,
    'const others = (Array.isArray(settings.customModels) ? settings.customModels : []).filter((m) => !mine.some((n) => n.model === m.model && n.baseUrl === m.baseUrl));',
    'settings.customModels = others.concat(mine);',
    'writeJson(settingsFile, settings);'
  ])
