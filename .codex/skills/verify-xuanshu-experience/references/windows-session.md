# Windows 会话操作

在仓库根用 Node 22+ 和 pnpm 执行。已有工具可直接管理子进程时，启动 `node scripts/experience/session.mjs --out`，传入一个不存在的 `ux-reports` 子目录作为参数，父目录先建好。保持 stdin 管道打开，每次发送一个 UTF-8 JSON 行，读完回复再发下一条。Windows 上若默认 PowerShell 报 CET，执行只读 CLI 和 pnpm 时用 `cmd.exe`，会话用下列 Node REPL 方式。

## Node REPL 会话

下列代码在持久 Node REPL 中执行一次。运行前若用另一份 checkout，改 `repo`。它只调用仓库原有执行器；保留同一个 REPL 直到关停。

```javascript
var fs = await import('node:fs/promises');
var path = await import('node:path');
var { spawn, execFile } = await import('node:child_process');
var { createInterface } = await import('node:readline');
var { promisify } = await import('node:util');
var exec = promisify(execFile);
var repo = 'E:/other/ai_project/xuanshu';
var reports = path.join(repo, 'ux-reports');
await fs.mkdir(reports, { recursive: true });
var runDir = await fs.mkdtemp(path.join(reports, 'verify-xuanshu-'));
var scoutDir = path.join(runDir, 'scout');
var pwDir = 'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
var defaultPw = (await exec('node', ['--input-type=module', '-e',
  'import {resolvePlaywright} from "./scripts/ux/collect/browser.mjs"; console.log(Boolean(resolvePlaywright()));',
], { cwd: repo, windowsHide: true })).stdout.trim() === 'true';
var pwArgs = defaultPw ? [] : ['--playwright-dir', pwDir];
if (!defaultPw) await fs.access(path.join(pwDir, 'package.json'));
var child = spawn('node', ['scripts/experience/session.mjs', '--out', scoutDir, ...pwArgs], {
  cwd: repo, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
var exit = new Promise(resolve => {
  child.once('error', error => resolve({ error: error.message }));
  child.once('close', (code, signal) => resolve({ code, signal }));
});
var stderr = '';
child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
var replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
var receive = async () => {
  const next = await replies.next();
  if (next.done) throw new Error(stderr || 'Experience session closed');
  return JSON.parse(next.value);
};
var send = async action => {
  child.stdin.write(JSON.stringify(action) + '\n');
  return receive();
};
var closeScout = async () => {
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('{"type":"close"}\n');
  return exit;
};
var ready;
var readyError;
receive().then(reply => { ready = reply; }, error => { readyError = error.message; });
nodeRepl.write({ runDir, pid: child.pid });
```

在后续 REPL 调用用 `nodeRepl.write({ ready, readyError })` 轮询启动。首次安装可能超过默认工具超时，保留这组句柄，等待期间查看 `scout/` 下新增的日志。只读取一次启动回复。收到错误或预算用尽时调用 `closeScout()`，让现有会话收尾，再核对 `scout/steps.jsonl`、`service.jsonl` 和可用的 `doctor-N.json`。收到 `ready: true` 后发送操作。

```javascript
var observation = await send({ type: 'observe', reason: '从根入口确认实际界面及可用导航' });
nodeRepl.write(observation);
if (observation.ok) await nodeRepl.emitImage(await fs.readFile(path.join(scoutDir, observation.result.screenshot)));
```

每次等上一个请求返回再发下一条。复用 `send` 发 `click`、`fill`、`press`、`check`、`registry`、`restart` 或 `verify-live`。业务错误和 `ok:false` 分别读取。对于 `check` 还须核对 `result.matches`。回归脚本可能需两分钟，设足够的 REPL 超时。长操作后检查原证据再解释结果。

## 运行中的进程核对

以下代码检查本轮实际监听者。重启后重新执行。先确认 `env.home` 属于本轮，`started.launcherPid` 来自同一运行的服务日志。WMIC 缺席时用可用的只读 Windows 进程查询核对等价字段；记录任何无法核对的项目。

```javascript
var jsonl = async file => (await fs.readFile(path.join(scoutDir, file), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
var env = JSON.parse(await fs.readFile(path.join(scoutDir, 'environment.json'), 'utf8'));
var started = (await jsonl('service.jsonl')).findLast(row => row.event === 'started');
var listeners = async () => (await exec('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true })).stdout
  .split(/\r?\n/).map(line => line.trim().split(/\s+/))
  .filter(fields => fields[1] === '127.0.0.1:' + env.port && fields[3] === 'LISTENING');
var sockets = await listeners();
if (sockets.length !== 1 || !/^\d+$/.test(sockets[0][4])) throw new Error('Expected one isolated listener');
var owner = Number(sockets[0][4]);
var info = (await exec('wmic.exe', ['process', 'where', 'ProcessId=' + owner, 'get', 'ParentProcessId,CommandLine', '/value'], {
  windowsHide: true,
})).stdout;
var parent = Number(info.match(/ParentProcessId=(\d+)/)?.[1]);
var argv = info.match(/CommandLine=([^\r\n]+)/)?.[1] ?? '';
var own = parent === started.launcherPid
  && argv.toLowerCase().includes(env.home.toLowerCase())
  && argv.includes('bin.js')
  && argv.includes('--port ' + env.port);
nodeRepl.write({ own, owner, parent, launcher: started.launcherPid, port: env.port });
if (!own) throw new Error('Listener ownership not verified');
```

核对同一 `generation` 的 `auth`、`boot` 与可见界面。需要人工兜底关停时，先按上述方式核对 launcher 和监听进程的归属。优先关闭 stdin，只有确认该 PID 是本轮仍在运行的进程才处理其进程树。

## 封存

```javascript
nodeRepl.write(await closeScout());
var last = (await jsonl('service.jsonl')).findLast(row => row.event === 'stopped');
nodeRepl.write({ stopped: last, listeners: await listeners(), artifacts: await fs.readdir(scoutDir) });
```

若会话在写 `environment.json` 前失败，从本轮 `service.jsonl` 读取已有端口和停止记录。没有启动记录时没有应用实例可关。完整运行须有 `portReleased: true`、没有同一端口的监听者、截图仍可打开、trace ZIP 可读，并能从 `persistence.jsonl` 找到落盘读数。检查失败就保留证据并报告。
