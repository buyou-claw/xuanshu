# 重放配置

从本轮轨迹读 `steps.jsonl`。取 `event: "finish"` 的动作 ID，避开观察、截图和其他不影响重放的动作。把 spec 放在本轮输出目录。保持原合成输入和端口隔离，每次重放从新 home 开始。

| 字段 | 取值 |
| --- | --- |
| `stepsFile` | 相对 spec 文件的本轮轨迹路径，例如 `scout/steps.jsonl` |
| `prelude` | 已执行的固定前置动作 ID，例如真实出现的首跑提示关闭动作 |
| `steps` | 保持原顺序的待重放动作 ID。填原始轨迹中的实际值 |
| `required` | 不能删的实际触发动作 ID，缺省为 `steps` 最后一项 |
| `checks` | `check` 参数数组。用 `target` 和 `state` 指定可见、隐藏、启用、禁用或精确值；控制台指纹用 `state: "console"`、`level` 和 `value` |
| `registryCount` | 藏库指纹需要落盘行数时填写。无效路径样板期望 0 |
| `unreachableWhen` | 可选。键为失败动作 ID，值为证实前置确实不可达的一组可见状态检查。定位超时本身不能排除候选 |
| `maxCandidates` | 缩减尝试预算。依据短路径规模设置，缺省 30 |

藏库无效路径可以用同一抽屉仍打开、原错误提示可见、「登记」禁用、注册表零行作为指纹。错误提示取本轮快照的实际文案。按任务把预期拒绝记为恢复覆盖。对产品异常，另写清楚权威期望与用户影响。

先写入本轮的 `replay-spec.json`。重放可能持续数分钟，用带会话 ID 的工具启动 `node scripts/experience/replay.mjs --spec <本轮目录>/replay-spec.json --out <本轮目录>/replay`，按需传 `--playwright-dir` 并有界轮询。也可在持久 Node REPL 启动，`runDir`、`repo` 和 `pwArgs` 来自[会话操作](windows-session.md)。

```javascript
var replayChild = spawn('node', ['scripts/experience/replay.mjs',
  '--spec', path.join(runDir, 'replay-spec.json'),
  '--out', path.join(runDir, 'replay'), ...pwArgs,
], { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
var replayStatus = { running: true };
var replayStderr = '';
replayChild.stdout.resume();
replayChild.stderr.setEncoding('utf8').on('data', chunk => { replayStderr += chunk; });
replayChild.once('error', error => { replayStatus = { error: error.message }; });
replayChild.once('close', (code, signal) => { replayStatus = { code, signal }; });
nodeRepl.write({ pid: replayChild.pid, replayStatus });
```

后续用 `nodeRepl.write({ replayStatus, replayStderr })` 轮询，也可在运行中读 `replay.json` 查看进度。结束后读 `replay/replay.json`、`spec.json` 和每次尝试的目录。只有 `stable-match` 与 `allShorterExcluded: true` 同时成立时，才在固定前置、必保触发和已枚举子序列的范围内称最短。不同结果、预算不足和前置不可判定分别记录。核对每个新 home 的停止记录及证据。若停止记录因端口复绑 `EADDRINUSE` 缺失，另用 `netstat` 和进程查询记录端口及本轮 PID 的实际状态。保留重放器的不可判定结论。
