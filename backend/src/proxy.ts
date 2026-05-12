import { ProxyAgent, setGlobalDispatcher } from 'undici';

let configuredProxy: string | null = null;

export function resolveProxyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    env.HTTPS_PROXY?.trim() ||
    env.https_proxy?.trim() ||
    env.HTTP_PROXY?.trim() ||
    env.http_proxy?.trim() ||
    null
  );
}

export function configureNodeFetchProxy(env: NodeJS.ProcessEnv = process.env): string | null {
  const proxyUrl = resolveProxyUrl(env);
  if (!proxyUrl || proxyUrl === configuredProxy) {
    return proxyUrl;
  }

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  configuredProxy = proxyUrl;
  return proxyUrl;
}
