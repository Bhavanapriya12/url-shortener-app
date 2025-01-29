const express = require("express");
const mongoFunctions = require("../helpers/mongo_functions");
const router = express.Router();

const functions = require("../helpers/functions");

const redisFunctions = require("../helpers/redis_functions");

const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const validations = require("../helpers/validations");
const { redisInsert } = require("../helpers/redis_functions");
const rateLimit = require("../helpers/rate_limiter");
const { Auth } = require("../middlewares/auth");
const user_agent_parser = require("ua-parser-js");

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "http://localhost:8001/api/oauth_callback"
);
//-------------------Google signin-----------
router.post("/social_login", async (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });
  return res.status(200).send({ data: authUrl });
});

router.get("/oauth_callback", async (req, res) => {
  console.log("query --->", req.query);
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  console.log("tokens--------->", tokens);
  if (tokens) {
    oauth2Client.setCredentials(tokens);

    // Now use the authenticated client to get user info
    const peopleService = google.people({ version: "v1", auth: oauth2Client });
    if (peopleService) {
      const g_response = await peopleService.people.get({
        resourceName: "people/me",
        personFields: "names,emailAddresses,photos",
      });
      if (g_response) {
        userInfo = g_response.data;
        // console.log("userinfo-->", userInfo);
        let user_data = {
          email: userInfo.emailAddresses[0].value,
          username: userInfo.names[0].givenName + userInfo.names[0].displayName,
          user_id: functions.get_random_string("U", 10),
        };
        console.log(user_data);
        let user = await mongoFunctions.find_one("URL_USERS", {
          email: user_data.email,
        });
        if (!user) {
          await mongoFunctions.create_new_record("URL_USERS", user_data);
        }

        const token = jwt.sign(
          {
            email: user_data.email,
            username: user_data.given_name,
            user_id: user_data.user_id,
          },
          process.env.jwtPrivateKey,
          { expiresIn: "7d" }
        );
        console.log("token--->", token);
        let fe_url = `http://localhost:8001/?token:${token}`;
        return res.redirect(fe_url);
      }
    }
  }

  return res.status(400).send("Try Again later..!");
});

//route to create short urls

router.post("/shorten", Auth, rateLimit(60, 60), async (req, res) => {
  let data = req.body;

  // Validate data
  const { error } = validations.create_shorten_url(data);
  if (error) return res.status(400).send(error.details[0].message);

  let analytics_object = {
    user_id: req.user.user_id,
    short_url: data.customAlias
      ? data.customAlias
      : functions.shortenUrl(data.longUrl),
    long_url: data.longUrl,
    topic: data.topic ? data.topic : "",
    createdAt: new Date(),
  };

  await mongoFunctions.create_new_record("ANALYTICS", analytics_object);
  //   await redisFunctions.redisInsert(analytics_object);
  return res.status(200).send({
    message: "Created Shorten Url Successfully",
    data: analytics_object,
  });
});

//route to redirect to the original long url through alias
router.get("/shorten/:alias", Auth, rateLimit(60, 60), async (req, res) => {
  console.log(req.headers);
  const data = req.params.alias;
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  const user_agent = req.headers["user-agent"];
  const parsed_user_agent = user_agent_parser(user_agent);
  const { user_id, username } = req.user;
  const current_date = new Date().toISOString().split("T")[0];

  // Find analytics data for the given short URL
  const findAnalytics = await mongoFunctions.find_one("ANALYTICS", {
    short_url: data,
  });

  let updateQuery = { $inc: { total_clicks: 1 } }; // Always increment total clicks
  let updateOsQuery = {};
  let updateDeviceQuery = {};
  let updateDateQuery = {};

  if (findAnalytics) {
    const userExists = findAnalytics.users.some((u) => u.user_id === user_id);

    if (!userExists) {
      // New user: increment unique clicks and add user
      updateQuery.$inc.unique_clicks = 1;
      updateQuery.$push = {
        users: {
          user_id,
          username,
          os_name: parsed_user_agent.os.name,
          device_name: parsed_user_agent.device.vendor,
        },
      };
    }

    // OS Handling
    const osIndex = findAnalytics.os_type.findIndex(
      (os) => os.os_name === parsed_user_agent.os.name
    );
    if (osIndex !== -1) {
      updateOsQuery = {
        $inc: {
          [`os_type.${osIndex}.unique_clicks`]: 1,
        },
      };
      if (!userExists) {
        updateOsQuery.$inc[`os_type.${osIndex}.unique_users`] = 1;
      }
    } else {
      updateOsQuery = {
        $push: {
          os_type: {
            os_name: parsed_user_agent.os.name,
            unique_clicks: 1,
            unique_users: userExists ? 0 : 1,
          },
        },
      };
    }

    // Device Handling
    const deviceIndex = findAnalytics.device_type.findIndex(
      (device) => device.device_name === parsed_user_agent.device.vendor
    );
    if (deviceIndex !== -1) {
      updateDeviceQuery = {
        $inc: {
          [`device_type.${deviceIndex}.unique_clicks`]: 1,
        },
      };
      if (!userExists) {
        updateDeviceQuery.$inc[`device_type.${deviceIndex}.unique_users`] = 1;
      }
    } else {
      updateDeviceQuery = {
        $push: {
          device_type: {
            device_name: parsed_user_agent.device.vendor,
            unique_clicks: 1,
            unique_users: userExists ? 0 : 1,
          },
        },
      };
    }

    // Clicks by Date Handling
    const dateIndex = findAnalytics.clicks_by_date.findIndex(
      (click) => click.date === current_date
    );
    if (dateIndex !== -1) {
      updateDateQuery = {
        $inc: { [`clicks_by_date.${dateIndex}.clicks`]: 1 },
      };
    } else {
      updateDateQuery = {
        $push: { clicks_by_date: { date: current_date, clicks: 1 } },
      };
    }
  } else {
    // First-time entry for this short URL
    updateQuery = {
      $inc: { total_clicks: 1, unique_clicks: 1 },
      $push: {
        users: {
          user_id,
          username,
          os_name: parsed_user_agent.os.name,
          device_name: parsed_user_agent.device.vendor,
        },
        os_type: {
          os_name: parsed_user_agent.os.name,
          unique_clicks: 1,
          unique_users: 1,
        },
        device_type: {
          device_name: parsed_user_agent.device.vendor,
          unique_clicks: 1,
          unique_users: 1,
        },
        clicks_by_date: { date: current_date, clicks: 1 },
      },
    };
  }

  // Merge all updates
  updateQuery = {
    ...updateQuery,
    ...updateOsQuery,
    ...updateDeviceQuery,
    ...updateDateQuery,
  };

  // Perform the update in MongoDB
  await mongoFunctions.find_one_and_update(
    "ANALYTICS",
    { short_url: data },
    updateQuery,
    { returnDocument: "after" }
  );

  // Fetch the updated URL data to redirect the user
  const url = await mongoFunctions.find_one("ANALYTICS", { short_url: data });
  if (!url) {
    return res.status(404).send("URL not found");
  }

  return res.status(200).redirect(url.long_url);
});

//get analytics based on topics
router.get("/analytics/:topic", rateLimit(60, 60), async (req, res) => {
  const data = req.params.topic;

  console.log(`Alias: ${data}`);

  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  let url = await mongoFunctions.find_one("ANALYTICS", {
    topic: data,
  });

  return res.status(200).send(url);
});
//get analytics based on alias
router.get("/analytics/:alias", rateLimit(60, 60), async (req, res) => {
  const data = req.params.alias;

  console.log(`Alias: ${data}`);

  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }
  let url = await mongoFunctions.find_one("ANALYTICS", {
    short_url: data,
  });

  if (!url) {
    return res.status(404).send("URL not found");
  }

  return res.status(200).send(url);
});

//get all analytics
router.get("/analytics/overall", rateLimit(60, 60), async (req, res) => {
  const data = req.params.topic;

  console.log(`Alias: ${data}`);

  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  let url = await mongoFunctions.find_one("ANALYTICS", {});

  if (!url) {
    return res.status(404).send("URL not found");
  }

  return res.status(200).send(url);
});

module.exports = router;
