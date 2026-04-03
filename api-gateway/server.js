const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Proxy with path rewrite - REMOVE /auth prefix when forwarding
app.use(
  "/auth",
  createProxyMiddleware({
    target: "http://localhost:3001",
    changeOrigin: true,
    pathRewrite: { "^/auth": "/auth" }, // Keep /auth
  }),
);

app.listen(PORT, () => {
  console.log(`Gateway on ${PORT}`);
});
