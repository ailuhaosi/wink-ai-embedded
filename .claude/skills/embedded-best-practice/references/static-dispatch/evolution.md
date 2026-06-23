# 静态分发演化与迁移

> 两条路径：① 代码向 ADR 目标迁移（短期 delta）；② 静态→运行期多态的退出条件（长期）。

---

## 一、代码迁移 delta（bool/float → wink_status_t）

wink-micro-os 现有代码处于 ADR-0001 / ADR-0004 落地前。迁移清单：

| 现状 | 迁移到 | 动作 |
|------|--------|------|
| `bool dal_servo_set_angle(...)` | `wink_status_t dal_servo_set_angle(...)` | 改返回类型，失败返回负码 |
| `float dal_ultrasonic_get_distance(...)`（哨兵 `-1.0f`） | `wink_status_t dal_ultrasonic_read(dev, float *out)` | 拆成「状态 + 出参」，消除哨兵歧义 |
| `dal_*_get_distance` | `dal_*_read` | 按 Registry 改名 |
| `js_sim_*` 三种签名 | 以 Registry 为准的单一签名 | 统一，删除他处声明 |
| `#ifdef SIMULATION` 整函数重复 | 只旁路最低物理信号层 | 重构共享上层 |
| 无 `device_tree.c` | codegen 生成 | 实现 codegen（设计已就绪） |
| `if (status)` 检查 | `if (status < 0)` | 全局搜替换 + lint |

迁移**不得静默改变**物理引脚、默认电压、DAL API 语义（`07-platform-governance/01` §8）。

---

## 二、ADR-0004 局部多态化退出路径（何时 + 怎么回退运行期多态）

**触发条件**：一个**具体器件抽象**需要「多种硬件实现在运行期并存且切换」。
（例：距离传感器抽象同时挂 HC-SR04 与 VL53L0X，运行期按配置选实现。）

若不满足（拓扑编译期确定、单一实现），**保持静态分发**，不要为假想的灵活性引入虚表。

**回退时的约束（不可破坏）：**

1. **BAL 层静态 API 契约不变**——上层/AI 生成看到的仍是 `dal_ultrasonic_read(&dev, &d)`。
2. **多态封装在 DAL 该器件内部**，两种合法手法：
   - **微型 ops 虚表**：在 `dal_ultrasonic.c` 内部定义一张 `static const struct { ... } ops`，
     按实例配置字段（如 `sensor_type`）选择；**仅此一处**间接调用。
   - **静态 `switch-case`**：按 `dev->sensor_type` 在 API 实现内分发到具体硬件路径。

```c
/* 受控的局部多态：封装在 dal_ultrasonic.c 内部，BAL 无感知 */
wink_status_t dal_ultrasonic_read(dal_ultrasonic_t *dev, float *out)
{
    switch (dev->sensor_type) {
    case SENSOR_HC_SR04:  return read_hc_sr04(dev, out);
    case SENSOR_VL53L0X:  return read_vl53l0x(dev, out);
    default:              return WINK_ERR_INVALID_PARAM;
    }
}
```

> 关键：上层（BAL / AI 生成 / 仿真）**完全不知道**内部多态。这既保留了静态命名的生成
> 友好性，又在局部获得了运行时灵活性。器件抽象**整体**仍是 POD + 命名 API。

---

## 三、项目演化方向（ch18 「几座山」在静态分发下的落地）

运行期多态参考基线里讲的 HSM（层次状态机）、Active Object、事件驱动发布订阅，**在静态
分发范式下同样适用且推荐**——它们是「行为组织」与「模块解耦」，与「dispatch 机制」正交：

- 复杂逻辑 → **层次化状态机**（chigo-micro 的 safety 状态机雏形）。
- 跨模块协调 → **事件驱动 + 发布订阅**（不互调，只通过事件）。
- 这些**不依赖 vtable**——状态转移表、事件订阅表都可以是静态数据表。

> 即：本项目「偏离运行期多态」≠「不高级」。复杂业务照样上 HSM / 事件驱动，只是 dispatch
> 走静态分发、器件是 POD。这是本项目与运行期多态基线的**真正分野**。

---

## 演进检验

- [ ] 现有 `bool`/`float` 返回的 DAL API 已迁移到 `wink_status_t`？
- [ ] 无 `if (status)` 残留？
- [ ] `js_sim_*` 签名统一到 Registry？
- [ ] `#ifdef SIMULATION` 已收窄到最低物理信号层？
- [ ] 任何引入的 vtable 都封装在模块内部、BAL 无感知？
