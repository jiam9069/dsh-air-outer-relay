# dsh-air-outer-relay

DSH Cordis 插件：在 DSH 进程内运行一个本地兼容中继，让仅接受 Claude Code / Codex 客户端指纹的 Air Outer 端点可由 DSH 使用。

- 上游默认：`https://ps.air-outer.com`
- 本地默认：`http://127.0.0.1:8788/v1`
- 模型：`gpt-5.6-sol`、`claude-opus-5`
- 不依赖 Python、httpx 或额外守护进程
- 根据模型自动探测客户端指纹，成功后按模型缓存
- DSH 卸载插件时自动关闭 HTTP 服务器

> 这不是公开反向代理。默认仅监听回环地址；不要把监听地址改成 `0.0.0.0`，除非前面有访问控制和 TLS。

## 工作原理

Air Outer 除 Bearer key 外还检查客户端指纹。插件按顺序尝试：

- `claude*` 模型：Claude CLI → Codex Rust CLI → Codex SDK → OpenAI SDK
- 其他模型：Codex Rust CLI → Codex SDK → OpenAI SDK → Claude CLI

只有 `401`/`403` 或明确的鉴权错误文本才会切换指纹；参数错误、限流等响应直接返回，不会误重试。成功指纹按模型缓存在内存中。

## 安装

### 从 GitHub 安装

```bash
cd ~/.dsh/profiles/web
npm install github:jiam9069/dsh-air-outer-relay
```

包内 `cordis.patch.yml` 会将插件挂载进 DSH bundle。重启 DSH 后生效。

如果当前 DSH 安装方式不自动合并 bundle patch，在用户 profile 的 `cordis.patch.yml` 添加：

```yaml
- insert:
    - id: dsh-air-outer-relay
      name: dsh-air-outer-relay
```

### DSH 模型配置

在 `~/.dsh/settings.yaml` 配置 pi-ai route：

```yaml
llm-pi-ai:
  providers:
    air-outer:
      displayName: AgentRouter 中转站
      apiKeyEnv: AIR_OUTER_API_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:8788/v1
      models:
        - id: gpt-5.6-sol
          name: GPT-5.6-Sol
          contextWindow: 262144
          maxTokens: 32768
        - id: claude-opus-5
          name: Claude Opus 5
          contextWindow: 200000
          maxTokens: 32768
```

在 DSH Web 的模型设置页保存 `AIR_OUTER_API_KEY`，或在启动 DSH 前导出：

```bash
export AIR_OUTER_API_KEY='your-key'
```

插件优先转发客户端请求中的 `Authorization`；只有请求没有该头时才读取环境变量。

## 插件设置

在 `~/.dsh/settings.yaml` 中可选配置：

```yaml
air-outer-relay:
  enabled: true
  host: 127.0.0.1
  port: 8788
  upstream: https://ps.air-outer.com
  apiKeyEnv: AIR_OUTER_API_KEY
  timeoutMs: 600000
  maxBodyBytes: 8388608
  verbose: false
```

监听地址、端口和上游变更后需要重启 DSH。默认请求体上限 8 MiB。

## Linux VPS

插件随 DSH 进程启动，不需要单独的 systemd unit。只需让现有 DSH 服务带上密钥：

```ini
# systemctl edit dsh-web
[Service]
Environment=AIR_OUTER_API_KEY=your-key
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl restart dsh-web
curl http://127.0.0.1:8788/v1/models \
  -H "Authorization: Bearer $AIR_OUTER_API_KEY"
```

若 DSH 运行在 Docker 中，插件和 `llm-pi-ai` 在同一容器内时继续使用 `127.0.0.1:8788`；将 `AIR_OUTER_API_KEY` 通过容器 secret 或环境变量注入，不要写进镜像。

## Windows

PowerShell 启动 DSH 前：

```powershell
$env:AIR_OUTER_API_KEY = 'your-key'
dsh web
```

也可以在 DSH Web 模型设置页管理凭据。插件本身没有 Python 依赖。

## 开发

需要 Node.js 22+：

```bash
npm install
npm test
npm run pack:check
```

测试使用本地模拟上游，不消耗 Air Outer 额度，也不需要真实 API key。

## 安全说明

- 默认只监听 `127.0.0.1`。
- 不记录或持久化 API key。
- `verbose` 只记录模型和指纹名称，不记录 Authorization。
- 如果必须跨容器/主机监听 `0.0.0.0`，应在反向代理或防火墙层限制来源，并启用 TLS。

## License

MIT
