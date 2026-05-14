export type AiEmbeddingResponse = {
  data?: number[][] | number[]
  embedding?: number[]
  result?: number[]
}

export type AiBinding = {
  run(model: string, inputs: string | { text: string }): Promise<AiEmbeddingResponse>
}