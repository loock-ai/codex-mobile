const localGatewayTarget = "http://127.0.0.1:4173";

export const viteDevServerConfig = {
  host: "0.0.0.0",
  port: 5173,
  strictPort: true,
  proxy: {
    "/api": {
      target: localGatewayTarget,
      changeOrigin: false,
    },
    "/ws": {
      target: localGatewayTarget.replace("http:", "ws:"),
      changeOrigin: false,
      ws: true,
    },
  },
};
