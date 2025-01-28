const express = require("express");
const analytics_routes = require("../routes/api");

const queue = require("express-queue");

module.exports = (app) => {
  // Middleware setup
  app.use(express.json());

  // Route handlers
  app.get("/", async (req, res) => {
    return res.status(200).send("Hello, Welcome to Home 🚀");
  });

  // API routes
  app.use(
    "/api",
    analytics_routes,
    queue({
      activeLimit: 1,
      queuedLimit: -1,
    })
  );
};
