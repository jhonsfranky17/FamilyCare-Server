const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const { sequelize, testConnection } = require("./config/database");
const authRoutes = require("./routes/authRoutes");
require("./models");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Test database connection
testConnection();

sequelize
  .sync({ alter: true })
  .then(() => {
    console.log("Database synced");
  })
  .catch((err) => {
    console.error("Sync error:", err);
  });

// Routes
app.use("/auth", authRoutes);

// Health check
app.get("/health", (_, res) => {
  res.json({
    status: "healthy",
    service: "auth-service",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Auth Service running on port ${PORT}`);
});
