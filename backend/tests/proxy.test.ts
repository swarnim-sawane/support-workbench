import { describe, expect, it } from 'vitest';
import { resolveProxyUrl } from '../src/proxy.js';

describe('proxy configuration', () => {
  it('prefers HTTPS proxy variables for Node fetch', () => {
    expect(
      resolveProxyUrl({
        HTTPS_PROXY: ' http://www-proxy-phx.oraclecorp.com:80 ',
        HTTP_PROXY: 'http://fallback-proxy.example.com:80'
      } as NodeJS.ProcessEnv)
    ).toBe('http://www-proxy-phx.oraclecorp.com:80');
  });

  it('falls back to lowercase and HTTP proxy variables', () => {
    expect(
      resolveProxyUrl({
        http_proxy: 'http://lowercase-proxy.example.com:80'
      } as NodeJS.ProcessEnv)
    ).toBe('http://lowercase-proxy.example.com:80');
  });
});
