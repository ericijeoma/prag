declare module 'mammoth/mammoth.browser' {
  interface ExtractRawTextResult {
    value: string;
    messages: Record<string, unkown>[];
  }

  export function extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<ExtractRawTextResult>;
}

declare module 'mammoth' {
  export * from 'mammoth/mammoth.browser';
}