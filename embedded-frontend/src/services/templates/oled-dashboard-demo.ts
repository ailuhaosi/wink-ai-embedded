/**
 * @file oled-dashboard-demo.ts
 * @brief OLED Dashboard 演示模板：Manifest V2 + 画布组件 preset。
 *
 * 引脚 SSOT（与 oled_dashboard/app_callbacks.c 一致）：
 *   Button → GPIO 10  (active_low)
 *   LED    → GPIO 2   (active_high)
 *   OLED   → I2C port 0, addr 0x3C, SDA=21, SCL=22
 *
 * 本模板不含 hc-sr04 等 worldCoupling 器件，Simulate 门禁无 B-09 阻断。
 */
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { EmbeddedProjectManifest } from '@/types/manifest-v2';
import { DEFAULT_ROUTING } from '@/services/connection-normalize';

export const OLED_DASHBOARD_TEMPLATE_ID = 'tpl_oled_dashboard';

export const OLED_DASHBOARD_DEMO_MANIFEST: EmbeddedProjectManifest = {
  schemaVersion: 2,
  id: OLED_DASHBOARD_TEMPLATE_ID,
  name: 'OLED Dashboard Demo',
  target: { boardId: 'esp32-devkit-v1' },
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1', displayName: 'ESP32' },
    { componentId: 'btn1', modelId: 'push-button', displayName: 'User Button' },
    { componentId: 'led1', modelId: 'led', displayName: 'Status LED' },
    { componentId: 'oled1', modelId: 'ssd1306', displayName: 'Status OLED' },
  ],
  connections: [
    {
      id: 'conn_btn',
      from: { componentId: 'btn1', pin: '1.l' },
      to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO10' },
      routing: DEFAULT_ROUTING,
    },
    {
      id: 'conn_led',
      from: { componentId: 'led1', pin: 'A' },
      to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO2' },
      routing: DEFAULT_ROUTING,
    },
    {
      id: 'conn_oled_sda',
      from: { componentId: 'oled1', pin: 'DATA' },
      to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO21' },
      routing: DEFAULT_ROUTING,
    },
    {
      id: 'conn_oled_scl',
      from: { componentId: 'oled1', pin: 'CLK' },
      to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO22' },
      routing: DEFAULT_ROUTING,
    },
  ],
  mechanical: { parts: [], joints: [] },
  environment: {
    props: [],
    fields: [{ fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 }],
  },
  bindings: { actuators: [], sensors: [], displays: [] },
};

/**
 * 创建 OLED Dashboard 画布组件实例列表。
 * 引脚与 SSOT 对照表一致：Button→10, LED→2, OLED→21/22。
 */
export function createOledDashboardCanvasComponents(): CircuitComponentInstance[] {
  return [
    {
      id: 'btn1',
      type: 'button',
      name: 'User Button',
      pinConnections: { '1.l': 10, '2.l': 'VCC', '1.r': null, '2.r': null },
      props: { color: 'green', label: '', xray: false, activeLow: true },
      rotation: 0,
    },
    {
      id: 'led1',
      type: 'led',
      name: 'Status LED',
      pinConnections: { A: 2, C: 'GND' },
      props: { color: 'red', brightness: 1.0, label: '', flip: false },
      rotation: 0,
    },
    {
      id: 'oled1',
      type: 'oled',
      name: 'Status OLED',
      pinConnections: {
        DATA: 21, CLK: 22, DC: null, RST: null, CS: null,
        '3V3': '3V3', VIN: null, GND: 'GND',
      },
      props: {},
      rotation: 0,
    },
  ];
}

/**
 * Workbench UI 模板工厂：返回 OLED Dashboard 的 deep clone manifest。
 */
export function createOledDashboardWorkbenchManifest(): EmbeddedProjectManifest {
  return structuredClone(OLED_DASHBOARD_DEMO_MANIFEST);
}
