# 16. 编译服务、构建任务与 Artifact 协议规范

本文定义 Wink-AI 嵌入式平台的云端/本地编译服务架构、任务协议、安全隔离、缓存策略、构建产物 manifest 和未来并入 Wink-AI 主项目后的任务编排方式。

---

## 1. 设计目标

1. **主后端只编排，不直接编译**：ESP-IDF、GCC、Docker 等重任务由独立 build worker 执行。
2. **构建可复现**：每次构建记录 source bundle hash、registry lock hash、runtime version、toolchain image digest 和 artifact hash。
3. **安全隔离**：用户生成代码在短生命周期容器或 sandbox 中编译，默认无外网、无密钥、非 root。
4. **任务异步化**：前端通过 build job 状态订阅进度，不阻塞请求。
5. **多部署形态**：支持云端 worker、私有化 worker 和桌面端本地 worker。

---

## 2. 服务分层

```text
Embedded Frontend
        │
        ▼
Wink-AI Backend
  ├── Build Job API
  ├── Project Manifest Store
  ├── Artifact Metadata Store
  └── Job Scheduler
        │
        ▼
Embedded Build Worker
  ├── Source Bundle Validator
  ├── Toolchain Resolver
  ├── Isolated Build Runner
  ├── Log Normalizer
  └── Artifact Publisher
        │
        ▼
Object Storage / Local Artifact Store
```

主后端负责鉴权、任务状态、artifact metadata 和 AI 错误解释；build worker 负责真正执行编译。

---

## 3. 构建任务生命周期

```text
created
  ↓
queued
  ↓
preparing
  ↓
building
  ↓
packaging
  ↓
succeeded
```

失败状态：

```text
failed_validation
failed_compile
failed_timeout
failed_resource_limit
failed_internal
cancelled
```

状态机约束：

1. `succeeded`、`failed_*`、`cancelled` 是终态。
2. 用户可在 `queued/preparing/building` 阶段取消。
3. `failed_validation` 不应进入容器编译阶段。
4. 超时和资源限制必须记录为可诊断错误。

---

## 4. Build Job Request

```json
{
  "jobVersion": 1,
  "projectId": "proj_123",
  "workspaceId": "ws_001",
  "target": {
    "boardId": "esp32-devkit-v1",
    "palTarget": "targets/esp32",
    "toolchain": "esp-idf",
    "flashProtocol": "webserial-esptool"
  },
  "sourceBundle": {
    "type": "embedded-project-bundle",
    "manifestHash": "sha256:...",
    "registryLockHash": "sha256:...",
    "logicHash": "sha256:...",
    "deviceTreeHash": "sha256:...",
    "files": [
      { "path": "src/app_main.c", "sha256": "sha256:..." },
      { "path": "src/device_tree.c", "sha256": "sha256:..." },
      { "path": "src/device_tree.h", "sha256": "sha256:..." }
    ]
  },
  "buildProfile": {
    "name": "debug-trace",
    "optimization": "Os",
    "enableTrace": true,
    "enableRuntimeChecks": true
  },
  "safetyGate": {
    "requiredLevel": "S2",
    "currentLevel": "S2",
    "staticCheckHash": "sha256:...",
    "simulationRunId": "run_001"
  }
}
```

请求约束：

1. `currentLevel` 不满足 `requiredLevel` 时拒绝构建。
2. `manifestHash`、`registryLockHash` 和上传文件 hash 必须一致。
3. build worker 必须重新执行关键校验，不信任前端传入结果。
4. target 必须来自 Board Model，不允许任意 toolchain 字符串。

---

## 5. Build Job Response

```json
{
  "buildId": "build_20260622_000001",
  "status": "queued",
  "projectId": "proj_123",
  "createdAt": "2026-06-22T00:00:00Z",
  "estimatedStartDelayMs": 1000,
  "links": {
    "status": "/api/embedded/builds/build_20260622_000001",
    "logs": "/api/embedded/builds/build_20260622_000001/logs"
  }
}
```

---

## 6. Build Status Event

前端可通过 SSE、WebSocket 或轮询获取任务事件：

```json
{
  "buildId": "build_20260622_000001",
  "seq": 12,
  "timestamp": "2026-06-22T00:00:03Z",
  "status": "building",
  "phase": "compile-bal",
  "progress": 0.45,
  "message": "Compiling app_main.c",
  "diagnostics": []
}
```

诊断事件：

```json
{
  "severity": "error",
  "source": "compiler",
  "file": "src/app_main.c",
  "line": 42,
  "column": 9,
  "code": "WINK_UNUSED_STATUS",
  "message": "wink_status_t return value must be checked",
  "hint": "Store the return value and branch on WINK_OK before using output data."
}
```

---

## 7. Build Manifest

构建成功后必须输出 Build Manifest：

```json
{
  "manifestVersion": 1,
  "buildId": "build_20260622_000001",
  "projectId": "proj_123",
  "createdAt": "2026-06-22T00:00:04Z",
  "target": {
    "boardId": "esp32-devkit-v1",
    "palTarget": "targets/esp32",
    "toolchain": "esp-idf"
  },
  "inputs": {
    "projectManifestHash": "sha256:...",
    "registryLockHash": "sha256:...",
    "sourceBundleHash": "sha256:...",
    "runtimeVersion": "0.1.0"
  },
  "toolchain": {
    "image": "wink-esp-idf:0.1.0",
    "imageDigest": "sha256:...",
    "compilerVersion": "xtensa-esp32-elf-gcc ..."
  },
  "artifacts": [
    {
      "name": "firmware.bin",
      "type": "esp32-merged-bin",
      "size": 1048576,
      "sha256": "sha256:...",
      "downloadUrl": "/api/embedded/builds/build_20260622_000001/artifacts/firmware.bin"
    }
  ],
  "logs": {
    "normalizedLogHash": "sha256:...",
    "rawLogHash": "sha256:..."
  },
  "security": {
    "containerNetwork": "disabled",
    "nonRootUser": true,
    "secretMounted": false,
    "resourceLimits": {
      "cpuCores": 2,
      "memoryMb": 2048,
      "timeoutSec": 120
    }
  }
}
```

---

## 8. Source Bundle 规则

source bundle 必须包含：

1. Project Manifest。
2. Registry Lock。
3. App C 或 DSL + codegen 输出。
4. device_tree.c/h。
5. app_config.h。
6. required DAL/PAL/runtime version metadata。

source bundle 不允许包含：

1. 任意二进制可执行文件。
2. 用户自定义脚本。
3. 外部依赖下载指令。
4. secret、token、私钥。
5. 绝对路径引用。

---

## 9. Worker 安全策略

| 项目 | 要求 |
|---|---|
| 容器生命周期 | 每个任务独立或强隔离 sandbox |
| 用户权限 | 非 root |
| 网络 | 默认禁用 outbound network |
| 文件系统 | toolchain 只读，workspace 临时可写 |
| CPU | 限制核心数 |
| 内存 | cgroup 限制 |
| 磁盘 | workspace 大小限制 |
| 缓存 | 用户间隔离，公共缓存只读 |
| Secret | 不挂载任何云端密钥 |
| 日志 | 不输出环境变量和敏感路径 |

---

## 10. 缓存策略

为了降低 ESP-IDF 构建耗时，允许以下缓存：

1. toolchain image layer cache。
2. WinkMicroOS runtime 预编译库。
3. PAL target 预编译库。
4. 第三方 SDK 只读缓存。

禁止缓存：

1. 用户源码跨用户共享。
2. 用户 workspace 可写缓存复用。
3. 包含 secret 的环境。

缓存 key：

```text
runtimeVersion + palTarget + toolchainImageDigest + buildProfile
```

---

## 11. Log Normalization

原始编译日志需要归一化为用户可理解诊断：

```text
raw gcc/esp-idf log
        │
        ▼
log parser
        │
        ▼
diagnostic list
        │
        ▼
sourceMap to DSL node
        │
        ▼
AI fix suggestion
```

诊断结构：

```json
{
  "id": "diag_001",
  "severity": "error",
  "category": "compile",
  "file": "src/app_main.c",
  "line": 42,
  "dslNodeId": "read_front_distance",
  "message": "Unknown device instance front_radar",
  "userMessage": "项目中不存在名为 front_radar 的传感器，请检查设备命名或重新生成 device_tree。",
  "fixableByAI": true
}
```

---

## 12. API 草案

```text
POST   /api/embedded/builds
GET    /api/embedded/builds/:buildId
GET    /api/embedded/builds/:buildId/events
GET    /api/embedded/builds/:buildId/logs
GET    /api/embedded/builds/:buildId/manifest
GET    /api/embedded/builds/:buildId/artifacts/:name
POST   /api/embedded/builds/:buildId/cancel
```

---

## 13. Flash 前置校验

烧录前，前端必须确认：

1. Build Manifest 完整。
2. Artifact sha256 与下载内容一致。
3. target 与用户选择板卡一致。
4. browser capability 满足 flashProtocol。
5. 用户明确授权串口或下载固件。
6. 当前项目未在构建后发生影响固件的变更。

若 Manifest hash 与当前 Project Manifest 不一致，必须提示重新构建。

---

## 14. 部署形态

| 形态 | 适用场景 | 特点 |
|---|---|---|
| Cloud Worker | SaaS | 可弹性伸缩，统一工具链 |
| Private Worker | 企业/学校内网 | 数据不出域，需维护镜像 |
| Desktop Local Worker | 高级用户 | 可用本地 Docker，离线可编译 |
| Mock Worker | MVP/前端开发 | 返回固定 artifact 和日志 |

---

## 15. MVP 落地范围

MVP-0：

1. Build Job API mock。
2. Build Manifest schema。
3. 固件 artifact metadata 展示。
4. 编译状态机 UI。

MVP-1：

1. ESP-IDF Docker worker。
2. source bundle 校验。
3. log normalization。
4. artifact sha256 校验。

MVP-2：

1. 多 worker 调度。
2. 缓存策略。
3. WebSerial 烧录前置校验。
4. 硬件 trace 构建配置。
