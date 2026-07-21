declare module 'ws' {
  export default class WebSocket {
    constructor(url: string, options: { headers: Record<string, string>; followRedirects?: boolean });
  }
}
