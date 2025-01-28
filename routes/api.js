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
          username: userInfo.names[0].givenName,
          user_id: functions.get_random_string("U", 10),
        };
        console.log(user_data);
        await mongoFunctions.create_new_record("URL_USERS", user_data);

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

router.post("/shorten", rateLimit(60, 60), async (req, res) => {
  let data = req.body;

  // Validate data
  const { error } = validations.create_shorten_url(data);
  if (error) return res.status(400).send(error.details[0].message);

  let analytics_object = {
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

  console.log(`Alias: ${data}`);

  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one("ANALYTICS", {
    short_url: data,
  });

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }
  // Parse user agent and IP
  const user_agent = req.headers["user-agent"];
  console.log(user_agent, "user agent");

  const parsed_user_agent = user_agent_parser(user_agent);
  console.log(parsed_user_agent);
  // Update analytics
  //update click count based on day
  const current_date = new Date().toISOString().split("T")[0];
  const existing_date_entry = url.clicks_by_date.find(
    (entry) => entry.date.toISOString().split("T")[0] === current_date
  );

  if (existing_date_entry) {
    existing_date_entry.click_count++;
  } else {
    url.clicks_by_date.push({ date: new Date(), click_count: 1 });
  }
  //update os array
  const existing_os_entry = url.os_type.find(
    (entry) => entry.os_name === parsed_user_agent.os.name
  );
  if (existing_os_entry) {
    existing_os_entry.unique_clicks++;
  } else {
    url.os_type.push({
      os_name: parsed_user_agent.os.name,
      unique_clicks: 1,
      unique_users: 1,
    });
  }
  //update device array

  const existing_device_entry = url.device_type.find(
    (entry) => entry.device_name === parsed_user_agent.device.type
  );
  if (existing_device_entry) {
    existing_device_entry.unique_clicks++;
  } else {
    url.device_type.push({
      device_name: parsed_user_agent.device.type,
      unique_clicks: 1,
      unique_users: 1,
    });
  }
  // Update unique users
  if (!url.users.find((user) => user.user_id === req.user.user_id)) {
    url.unique_users++;
  }

  // Log user visit
  url.users.push({ user_id: req.user.user_id, username: req.user.username });

  // Update total clicks
  url.total_clicks++;

  // Redirect to the original long URL
  return res.redirect(url.long_url);
});
//get analytics based on alias
router.get("/analytics/:alias", rateLimit(60, 60), async (req, res) => {
  const data = req.params.alias;

  // Log the short URL alias
  console.log(`Alias: ${data}`);

  // Check if alias is provided
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one("ANALYTICS", {
    short_url: data,
  });

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }

  // Redirect to the original long URL
  return res.status(200).send(url);
});

//get analytics based on topics
router.get("/analytics/:topic", rateLimit(60, 60), async (req, res) => {
  const data = req.params.topic;

  // Log the short URL alias
  console.log(`Alias: ${data}`);

  // Check if alias is provided
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one("ANALYTICS", {
    topic: data,
  });

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }

  // Redirect to the original long URL
  return res.status(200).send(url);
});

//get all analytics
router.get("/analytics/overall", rateLimit(60, 60), async (req, res) => {
  const data = req.params.topic;

  // Log the short URL alias
  console.log(`Alias: ${data}`);

  // Check if alias is provided
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one("ANALYTICS", {});

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }

  // Redirect to the original long URL
  return res.status(200).send(url);
});

module.exports = router;
