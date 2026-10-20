/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

// 预览构建专用：Mock 开关（见 src/mock）
interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
}
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
    [key: string]: any;
  }
  interface QRCodeApi {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
    toCanvas(canvas: unknown, text: string, options?: QRCodeToDataURLOptions): Promise<unknown>;
  }
  const QRCode: QRCodeApi;
  export default QRCode;
}