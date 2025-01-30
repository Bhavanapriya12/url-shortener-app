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
  const { user_id, email } = req.user;

  // Get the current date range (today)
  let today = new Date();
  let startDate = new Date(today.setHours(0, 0, 0, 0)); // Start of today (00:00:00)
  let endDate = new Date(today.setHours(23, 59, 59, 999)); // End of today (23:59:59.999)

  console.log("Start Date:", startDate);
  console.log("End Date:", endDate);

  // Find the analytics document with the alias and matching user clicks date
  const findDate = await mongoFunctions.find("ANALYTICS", {
    short_url: data,
    clicks_by_date: {
      $elemMatch: {
        date: { $gte: startDate, $lte: endDate },
      },
    },
  });
  console.log(findDate);

  if (findDate.length > 0) {
    // If the date exists, increment the clicks count
    await mongoFunctions.find_one_and_update(
      "ANALYTICS",
      {
        short_url: data,
        "clicks_by_date.date": { $gte: startDate, $lte: endDate },
      },
      {
        $inc: { "clicks_by_date.$.clicks_count": 1 },
      },
      { returnDocument: "after" }
    );
  } else {
    // Otherwise, push a new date object with 1 click
    await mongoFunctions.find_one_and_update(
      "ANALYTICS",
      { short_url: data },
      {
        $push: { clicks_by_date: { date: today, clicks_count: 1 } },
      },
      { returnDocument: "after" }
    );
  }

  // If the user already exists, update the unique clicks for OS and Device
  const findUser = await mongoFunctions.find("ANALYTICS", {
    short_url: data,
    users: { $elemMatch: { user_id: user_id } },
  });

  if (findUser.length > 0) {
    // Update OS and Device information if the user exists
    const findOs = await mongoFunctions.find("ANALYTICS", {
      short_url: data,
      os_type: { $elemMatch: { os_name: parsed_user_agent.os.name } },
    });

    const findDevice = await mongoFunctions.find("ANALYTICS", {
      short_url: data,
      device_type: {
        $elemMatch: { device_name: parsed_user_agent.device.name },
      },
    });

    // For OS update, use arrayFilters to ensure proper element update
    if (findOs.length > 0) {
      await mongoFunctions.find_one_and_update(
        "ANALYTICS",
        { short_url: data },
        {
          $inc: { "os_type.$[elem].unique_clicks": 1 },
          $set: { "os_type.$[elem].os_name": parsed_user_agent.os.name },
        },
        {
          arrayFilters: [{ "elem.os_name": parsed_user_agent.os.name }],
          returnDocument: "after",
        }
      );
    } else {
      // If OS doesn't exist, push a new object to the os_type array
      await mongoFunctions.find_one_and_update(
        "ANALYTICS",
        { short_url: data },
        {
          $push: {
            os_type: {
              os_name: parsed_user_agent.os.name,
              unique_clicks: 1,
              unique_users: 1,
            },
          },
        },
        { returnDocument: "after" }
      );
    }

    // For Device update, ensure unique clicks are incremented or new device is added
    if (findDevice.length > 0) {
      await mongoFunctions.find_one_and_update(
        "ANALYTICS",
        { short_url: data },
        {
          $inc: { "device_type.$[elem].unique_clicks": 1 },
          $set: {
            "device_type.$[elem].device_name": parsed_user_agent.device.name,
          },
        },
        {
          arrayFilters: [{ "elem.device_name": parsed_user_agent.device.name }],
          returnDocument: "after",
        }
      );
    } else {
      await mongoFunctions.find_one_and_update(
        "ANALYTICS",
        { short_url: data },
        {
          $push: {
            device_type: {
              device_name: parsed_user_agent.device.name,
              unique_clicks: 1,
              unique_users: 1,
            },
          },
        },
        { returnDocument: "after" }
      );
    }
  }

  // If the user does not exist, create a new user entry and increment unique users
  if (findUser.length < 1) {
    console.log("New user detected, adding details.");
    let s = await mongoFunctions.find_one_and_update(
      "ANALYTICS",
      { short_url: data },
      {
        $inc: { unique_users: 1 },
        $push: {
          users: {
            user_id: user_id,
            username: email,
            os_name: parsed_user_agent.os.name,
            device_name: parsed_user_agent.device.vendor,
          },
        },
        $push: {
          os_type: {
            os_name: parsed_user_agent.os.name,
            unique_clicks: 1,
            unique_users: 1,
          },
          device_type: {
            device_name: parsed_user_agent.device.name,
            unique_clicks: 1,
            unique_users: 1,
          },
        },
      },
      {},
      { returnDocument: "after" }
    );
    console.log(s);
  }

  // Find the updated analytics data for the given short URL
  const url = await mongoFunctions.find_one_and_update(
    "ANALYTICS",
    { short_url: data },
    { $inc: { total_clicks: 1 } },
    {},
    { returnDocument: "after" }
  );
  console.log(url);

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
  console.log(url);

  return res.status(200).send(url);
});

//get all analytics
router.get("/analytics/overall", rateLimit(60, 60), async (req, res) => {
  let url = await mongoFunctions.find_one("ANALYTICS", {});

  if (!url) {
    return res.status(404).send("URL not found");
  }

  return res.status(200).send(url);
});

module.exports = router;
