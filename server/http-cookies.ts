import type { ServerResponse } from 'node:http';
export function appendCookie(res: ServerResponse, cookie: string) {
  const previous = res.getHeader?.('Set-Cookie');
  res.setHeader('Set-Cookie', previous ? [...(Array.isArray(previous) ? previous.map(String) : [String(previous)]), cookie] : cookie);
}
