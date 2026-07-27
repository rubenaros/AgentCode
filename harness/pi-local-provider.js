// Pi extension: register the local llama-server (Qwen3.6-35B-A3B, --n-cpu-moe) as an
// OpenAI-compatible provider so Pi can drive our on-machine model.
// Usage: LOCAL_KEY=dummy pi -e harness/pi-local-provider.js --provider local --model local/qwen3.6-35b-a3b ...
export default function (pi) {
  pi.registerProvider("local", {
    name: "Local llama-server",
    baseUrl: "http://127.0.0.1:8090/v1",
    apiKey: "LOCAL_KEY", // env var name; llama-server ignores it, but Pi wants one
    api: "openai-completions",
    models: [
      {
        id: "qwen3.6-35b-a3b",
        name: "Qwen3.6-35B-A3B (local, --n-cpu-moe)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
        compat: { maxTokensField: "max_tokens" },
      },
    ],
  });
}
