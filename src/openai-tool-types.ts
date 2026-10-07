/** Minimal OpenAI tool shape so Logistix does not depend on the openai SDK. */
export type ChatCompletionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};
