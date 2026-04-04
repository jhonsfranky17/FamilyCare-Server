const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  console.log(`\n[GATEWAY] ${req.method} ${req.url}`);
  console.log(`[GATEWAY] Original URL: ${req.originalUrl}`);
  console.log(`[GATEWAY] Path: ${req.path}`);
  next();
});

// Health check endpoints
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "api-gateway" });
});

app.get("/gateway/health", (req, res) => {
  res.json({ status: "ok", service: "api-gateway" });
});

app.get("/", (req, res) => {
  res.json({ message: "FamilyCare API Gateway", status: "running" });
});

app.get("/gateway/status", async (req, res) => {
  const axios = require("axios");
  const status = { auth: "unknown", family: "unknown", health: "unknown" };

  try {
    await axios.get("http://localhost:3001/health");
    status.auth = "healthy";
  } catch {
    status.auth = "unhealthy";
  }

  try {
    await axios.get("http://localhost:3002/health");
    status.family = "healthy";
  } catch {
    status.family = "unhealthy";
  }

  try {
    await axios.get("http://localhost:3003/health");
    status.health = "healthy";
  } catch {
    status.health = "unhealthy";
  }

  res.json({ success: true, status });
});

// Auth Service Proxy
app.use(
  "/auth",
  createProxyMiddleware({
    target: "http://localhost:3001",
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `[AUTH] Forwarding to: http://localhost:3001${req.originalUrl}`,
      );
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
    },
  }),
);

// Family Service Proxy - Use originalUrl to preserve full path
app.use("/families", (req, res, next) => {
  const targetUrl = `http://localhost:3002${req.originalUrl}`;
  console.log(`[FAMILY] Forwarding to: ${targetUrl}`);

  // Create proxy with the full URL
  const proxy = createProxyMiddleware({
    target: "http://localhost:3002",
    changeOrigin: true,
    pathRewrite: () => req.originalUrl, // Use originalUrl as the path
    onProxyReq: (proxyReq, req, res) => {
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
    },
    onError: (err, req, res) => {
      console.error("[FAMILY PROXY ERROR]", err.message);
      res.status(503).json({ error: "Family service unavailable" });
    },
  });

  proxy(req, res, next);
});

// Health Service Proxy
app.use("/health", (req, res, next) => {
  console.log(
    `[HEALTH] Forwarding to: http://localhost:3003${req.originalUrl}`,
  );

  const proxy = createProxyMiddleware({
    target: "http://localhost:3003",
    changeOrigin: true,
    pathRewrite: () => req.originalUrl,
    onProxyReq: (proxyReq, req, res) => {
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
    },
    onError: (err, req, res) => {
      console.error("[HEALTH PROXY ERROR]", err.message);
      res.status(503).json({ error: "Health service unavailable" });
    },
  });

  proxy(req, res, next);
});

app.listen(PORT, () => {
  console.log(`Gateway on ${PORT}`);
});
