const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

// Swagger Definition
const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "URL Shortener APIS",
    version: "1.0.0",
    description: "API documentation for URL Shortener service",
  },
  servers: [
    {
      url: "https://url-shortener-app-zv5u.onrender.com",
      description: "Deployed Staging Server link[Render]",
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header", // Token is passed in the headers
        name: "x-auth-token", // Name of the header where the token should be sent
        description: "Enter your authentication token",
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: ["./routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(options);

const setupSwagger = (app) => {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  console.log("Swagger Docs available at deployed link");
};

module.exports = setupSwagger;
