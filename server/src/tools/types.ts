export interface Tool {
  readonly name: string;
  readonly description: string;
  /**
   * JSON Schema describing the tool input. Passed verbatim as OpenAI's
   * `function.parameters` and Anthropic's `input_schema`.
   */
  readonly inputSchema: Record<string, unknown>;
  /**
   * Run the tool with the model-provided input (already JSON-parsed into an
   * object) and resolve with a string result that is fed back to the model.
   */
  execute(input: unknown): Promise<string>;
}
