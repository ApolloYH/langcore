import { ProxyAgent, setGlobalDispatcher } from "undici";

export function configureNetworkProxy() {
  const proxyUrl = process.env.DEVSCOPE_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (!proxyUrl) {
    return;
  }

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.GIT_HTTP_PROXY = proxyUrl;
  process.env.GIT_HTTPS_PROXY = proxyUrl;
}
