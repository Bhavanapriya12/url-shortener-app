const mongoose = require("mongoose");

const users_schema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

users_schema.index({ user_id: 1 });

exports.URL_USERS = mongoose.model("URL_USERS", users_schema);
