# 16. Build Service, Job Protocol & Artifact Specification

<!-- i18n-meta
source: docs/zh/design/06-build-toolchain/02-build-service-job-protocol.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This document defines the architecture, job protocols, sandbox isolation, caching strategies, and artifact manifests for the Wink-AI embedded build service.

---

## 1. Design Goals

1. **Host Backend Orchestrates, Independent Workers Compile**: Heavy toolchains (ESP-IDF, GCC, Docker) execute on isolated build workers.
2. **Reproducible Builds**: Every build captures source bundle hashes, registry lock hashes, runtime versions, toolchain image digests, and artifact hashes.
3. **Sandbox Isolation**: User-generated code compiles in ephemeral containers without internet access, secrets, or root privileges.
4. **Asynchronous Jobs**: Frontend subscribes to build job progress streams asynchronously.
5. **Multi-Deployment Topologies**: Supports Cloud Workers, Private On-Prem Workers, and Local Desktop Workers.

---

## 2. Service Layering

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

---

## 3. Build Job Lifecycle

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

Failure States:
```text
failed_validation
failed_compile
failed_timeout
failed_resource_limit
failed_internal
cancelled
```

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

Diagnostics event:

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

## 8. Source Bundle Rules

Must contain:
1. Project Manifest.
2. Registry Lock.
3. App C or DSL + codegen output.
4. `device_tree.c/h`.
5. `app_config.h`.

Forbidden:
1. Arbitrary binary executables.
2. Custom scripts or external download directives.
3. Secrets, tokens, or absolute host paths.

---

## 9. Worker Security Policy

| Item | Requirement |
|---|---|
| Container Lifecycle | Ephemeral sandboxes per job |
| User Privileges | Non-root execution |
| Network | Outbound internet disabled by default |
| Filesystem | Read-only toolchain, temporary scratch workspace |
| Resource Limits | Enforced CPU, memory, and timeout cgroups |
| Secrets | No credentials mounted |

---

## 10. Caching Strategy

Cache Key:
```text
runtimeVersion + palTarget + toolchainImageDigest + buildProfile
```

---

## 11. Log Normalization

```text
Raw GCC / ESP-IDF Log
        │
        ▼
Log Parser
        │
        ▼
Diagnostic List
        │
        ▼
SourceMap to DSL Node
        │
        ▼
AI Fix Suggestion
```

Diagnostic Structure:

```json
{
  "id": "diag_001",
  "severity": "error",
  "category": "compile",
  "file": "src/app_main.c",
  "line": 42,
  "dslNodeId": "read_front_distance",
  "message": "Unknown device instance front_radar",
  "userMessage": "Sensor 'front_radar' does not exist. Verify device naming or regenerate device_tree.",
  "fixableByAI": true
}
```

---

## 12. API Draft

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

## 13. Pre-Flash Verification

Before flashing, verify:
1. Complete Build Manifest.
2. Artifact sha256 checksum match.
3. Target board match.
4. Web browser WebSerial capability.
5. User authorization for serial port access.

---

## 14. Deployment Topologies

| Topology | Use Case | Characteristics |
|---|---|---|
| Cloud Worker | SaaS | Elastic auto-scaling, centralized toolchains |
| Private Worker | Enterprise / School Intranet | Data locality, custom images |
| Desktop Local Worker | Advanced Local Dev | Offline Docker compilation |
| Mock Worker | Frontend Testing | Returns mock artifacts and logs |

---

## 15. MVP Implementation Scope

- **MVP-0**: Mock Build Job API, Build Manifest schema, artifact metadata display.
- **MVP-1**: ESP-IDF Docker worker, source bundle validation, log normalization.
- **MVP-2**: Multi-worker scheduling, caching, WebSerial pre-flash verification.
