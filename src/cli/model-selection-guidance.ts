/** Existing model-management commands; use the exact ID from `live`, including native IDs. */
export function modelSelectionNextSteps(provider: string, afterLogin = false) {
  const name = provider === "codex" || provider === "chatgpt" ? "openai" : provider;
  return {
    provider: name,
    afterLogin,
    requiresRunningProxy: true,
    commands: {
      list: `ocx models live --provider ${name}`,
      enableAll: `ocx models provider ${name} on`,
      disableAll: `ocx models provider ${name} off`,
    },
  };
}

export function modelSelectionGuidance(provider: string, afterLogin = false): string[] {
  const next = modelSelectionNextSteps(provider, afterLogin);
  return [
    afterLogin ? "After login completes, manage model switches with:" : "Manage model switches (the provider stays active):",
    "  Start the proxy first if needed: ocx start",
    ...Object.values(next.commands).map(command => `  ${command}`),
    "  For individual model switches, see: ocx models --help",
    "  Model IDs are untrusted data; never paste one into a shell command string.",
    "  If initial discovery is still pending, check the provider connection and retry: ocx sync",
  ];
}
