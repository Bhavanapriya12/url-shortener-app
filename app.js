require("dotenv").config();
const express = require("express");

app = express();
app.set("trust proxy", 1);

app.use(express.json({ limit: "10mb" }));

require("./helpers/production")(app);
require("./helpers/db")();
require("./helpers/redis_functions");

require("./helpers/route_config")(app);

app.listen(process.env.PORT, () => {
  console.log(`Listening on port http://localhost:${process.env.PORT}`);
});
