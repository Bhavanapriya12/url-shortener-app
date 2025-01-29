const mongoose = require("mongoose");
module.exports = () => {
  var connectionString = String(process.env.CRM_DBSTRING);

  mongoose
    .connect(connectionString, {
      autoIndex: true,
    })
    .then(() => {
      console.log("Connected to MongoDB...!");
    })
    .catch((err) => console.log(err));
};
