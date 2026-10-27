export interface AppiaryWidgetsPlugin {
  set(options: { title: string; body: string; kind?: string }): Promise<{ set: boolean; updatedAt?: number }>
  clear(): Promise<void>
  get(): Promise<{ set: boolean; title?: string; body?: string; kind?: string; updatedAt?: number }>
}
