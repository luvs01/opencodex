export function standaloneRecycleEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const replacement = { ...env };
  // A connected runtime may have received its hub-issued client key through either
  // variable. Neither is a valid admission secret for the replacement standalone proxy.
  delete replacement.OPENCODEX_API_AUTH_TOKEN;
  delete replacement.OCX_API_TOKEN_FILE;
  return replacement;
}
