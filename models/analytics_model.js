const mongoose = require("mongoose");

const analytics_schema = new mongoose.Schema(
  {
    // user_id: { type: String, required: true, index: true },
    short_url: { type: String, required: true },
    topic: { type: String, index: true },
    long_url: { type: String, required: true },
    total_clicks: { type: Number, default: 0 },
    unique_users: { type: Number, default: 0 },
    clicks_by_date: [
      {
        date: Date,
        click_count: Number,
      },
    ],
    os_type: [
      {
        os_name: String,
        unique_clicks: Number,
        unique_users: Number,
      },
    ],
    device_type: [
      {
        device_name: String,
        unique_clicks: Number,
        unique_users: Number,
      },
    ],
    users: [
      {
        user_id: String,
        username: String,
        os_name: String,
        device_name: String,
      },
    ],
  },
  { timestamps: true }
);

analytics_schema.index({ user_id: 1, topic: 1, short_url: 1 });

exports.ANALYTICS = mongoose.model("ANALYTICS", analytics_schema);
