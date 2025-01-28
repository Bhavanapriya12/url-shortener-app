const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  max: 100,
  windowMs: 1 * 60 * 1000,
});

module.exports = (app) => {
  app.use(cors({ origin: "*", methods: "GET,HEAD,PUT,PATCH,POST,DELETE" }));
  console.log("allowed cors origins");
  app.use(helmet());
  console.log("Implemented helmet");
  app.use(compression());
  console.log("Enabled compression");
  app.use(limiter);
  console.log("Applied rate limiting");
};