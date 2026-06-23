/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'yl-animated-caret' {
  import type { DefineComponent, Plugin } from 'vue'

  type YLAnyComponent = DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>

  export const YLAnimatedCaret: YLAnyComponent
  const DefaultComponent: YLAnyComponent
  export default DefaultComponent

  export const install: Plugin['install']
  export const YLAnimatedCaretPlugin: Plugin
}
