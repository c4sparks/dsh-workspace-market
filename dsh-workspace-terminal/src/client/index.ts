/**
 * dsh-workspace-terminal — client bundle entry（__ModuleLoader__.load 格式）。
 * factory 收到 dsh 种子模块的 require；react 在 factory 内 require（esbuild external）。
 */
import { createPlugin } from "./plugin";

interface ModuleLoaderOptions {
  id: string;
  factory: (require: (id: string) => unknown) => { exports?: unknown };
}
interface ModuleLoader {
  load(options: ModuleLoaderOptions): void;
}

const loader = (window as unknown as { __ModuleLoader__: ModuleLoader }).__ModuleLoader__;

loader.load({
  id: "dsh-workspace-terminal",
  factory: (require) => {
    const module: { exports: any } = { exports: {} };
    const React: any = require("react");
    const result = createPlugin({ React });
    module.exports.apply = result.apply;
    module.exports.inject = result.inject;
    return module.exports;
  }
});
