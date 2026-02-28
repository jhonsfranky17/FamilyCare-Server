const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const Redis = require("ioredis");
const { sequelize, testConnection } = require("./config/database");
const healthRoutes = require("./routes/healthRoutes");
require("./models");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

// Redis client for Pub/Sub
const redis = new Redis(process.env.REDIS_URL);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Test connections
testConnection();
redis.on("connect", () => console.log("Redis connected"));

// Sync database
sequelize
  .sync({ alter: false })
  .then(() => console.log("Database synced"))
  .catch((err) => console.error("Sync error:", err));

// Routes
app.use("/health", healthRoutes);

// Health check
app.get("/health", (_, res) => {
  res.json({
    status: "healthy",
    service: "health-service",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Health Service running on port ${PORT}`);
});
